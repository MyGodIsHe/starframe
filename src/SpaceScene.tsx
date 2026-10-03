import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type MutableRefObject, type PointerEvent, type ReactNode, type WheelEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, type BufferGeometry, type Group, type LineBasicMaterial, type Mesh, type PerspectiveCamera, type PointsMaterial, QuadraticBezierCurve3, Quaternion, type ShaderMaterial, type SphereGeometry, Vector3 } from "three";
import { LOCAL_SYSTEM_SCENE_UNITS_PER_METER, projectLocalSystem, type LocalSystemProjection } from "./localSystemProjection";
import { calculateOrbitTrail, type OrbitTrailPlanet } from "./orbitTrails";
import { CelestialStarField } from "./CelestialStarField";
import { SkyBackground } from "./SkyBackground";
import { ConstellationGlyphs } from "./constellations/ConstellationGlyphs";
import { compileConstellationGlyphIndex, projectTravelConstellationGlyphs } from "./constellations/constellationGlyphModel";
import { GLYPH_STAR_SPIKE_COUNT, glyphStarDiameter } from "./constellations/glyphStarSpikes";
import type { SystemResource, UniverseIndex } from "./universe/generateUniverse";
import type { RenderQuality } from "./renderQuality";
import { projectCelestialMap } from "./celestialMap";
import { projectInterstellarPreview, projectTravelInterstellarProjection } from "./interstellarProjection";
import { localDetailOpacity, travelSystemOffset, type TravelFrame } from "./travelCoordinates";
import { FlightTrailLayer } from "./FlightTrailLayer";
import type { AmbientFlightTrailPoint } from "./ambientFlightTrails";
import { BattleFlareLayer } from "./BattleFlareLayer";
import { BattleBeaconOverlay } from "./BattleBeaconOverlay";
import { dampCameraState, orbitCameraPosition, type CameraState } from "./orbitCamera";
import { planetAppearance, SCENE_PALETTE } from "./scenePalette";

// Re-exported so the viewport's own camera stays one import for its callers.
export { dampCameraState, orbitCameraPosition, type CameraState };

export type ZoomBounds = {
  min: number;
  max: number;
};

type SceneViewportProps = {
  camera: CameraState;
  onCameraChange: (next: CameraState) => void;
  star: SystemResource["star"];
  planets: SystemResource["planets"];
  gates: { id: number; position: [number, number, number]; destinationName: string; destinationSystemId: number }[];
  activeGateId: number | null;
  onGateActiveChange: (gateId: number | null) => void;
  onGateActivate: (gateId: number) => void;
  travel: TravelFrame | null;
  previewGateId: number | null;
  previewSystems: { id: number; name: string }[];
  previewEdges: [number, number][];
  previewLeaving: boolean;
  systemName: string;
  snapshotTime: number | null;
  celestialSystems: UniverseIndex["systems"];
  activeSystemId: number;
  quality: RenderQuality;
  reducedMotion: boolean;
};

type DisplayGate = LocalSystemProjection["gates"][number] & { id: number; destinationName: string; destinationDirection: [number, number, number] | null; displayPosition: Vector3 };

// Keeps the farthest object comfortably inside the default 75deg vertical FOV even when it sits off-axis from the camera's bearing, not just dead ahead.
const FARTHEST_OBJECT_MARGIN = 1.65;
const FALLBACK_MIN_DISTANCE = 6;
const FALLBACK_MAX_DISTANCE = 18;
const ZOOM_STEP_RATIO = 1 / 1200;
const MARKER_SCALE_DIVISOR = 600;
// Bigger than a planet's markerSize (8) because the beacon glyph's own geometry (torus/cone)
// covers far less of its bounding sphere than a planet's solid marker dot does.
const GATE_MARKER_SIZE = 20;
// Matches the torus glyph's outer edge (radius 0.34 + tube 0.035) so overlap detection lines up with what's actually drawn.
const GATE_MARKER_OUTER_RADIUS = 0.375;
const PLANET_MARKER_BASE_OPACITY = 0.8;
// Decorative background stars must always read as dimmer than Minimum Map Brightness so every real
// Solar System stays distinguishable from procedural fill (see interstellarProjection.ts).
export const DECORATIVE_STAR_MAX_OPACITY = 0.4;
// Fixed screen-pixel sizes baked into each decorative star at creation time (see
// createDecorativeStarField below) - must be initialized before DECORATIVE_STARS calls that
// function at module load time.
const DECORATIVE_STAR_SIZE_NEAR_PX = 2.2;
const DECORATIVE_STAR_SIZE_FAR_PX = 1.1;
const DECORATIVE_STARS = createDecorativeStarField(520);
const MOBILE_DECORATIVE_STARS = createDecorativeStarField(180);

export function SceneViewport({ camera, onCameraChange, star, planets, gates, activeGateId, onGateActiveChange, onGateActivate, travel, previewGateId, previewSystems, previewEdges, previewLeaving, systemName, snapshotTime, celestialSystems, activeSystemId, quality, reducedMotion }: SceneViewportProps): ReactNode {
  const dragStart = useRef<{ pointerId: number; x: number; y: number; camera: CameraState } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; camera: CameraState } | null>(null);
  const gateLabelRefs = useRef(new Map<number, HTMLButtonElement>());
  const gateGroupRefs = useRef(new Map<number, Group>());
  const [hoveredMarkerGateId, setHoveredMarkerGateId] = useState<number | null>(null);
  const [hoveredLabelGateId, setHoveredLabelGateId] = useState<number | null>(null);
  const [focusedGateId, setFocusedGateId] = useState<number | null>(null);
  const localSystem = projectLocalSystem({ star, planets, gates }, LOCAL_SYSTEM_SCENE_UNITS_PER_METER);
  const zoomBounds = calculateZoomBounds(localSystem.planets, localSystem.gates);
  const celestialMap = useMemo(() => projectCelestialMap(celestialSystems, activeSystemId), [celestialSystems, activeSystemId]);
  const displayGates = projectGates(localSystem.gates, celestialMap);
  const previewGate = displayGates.find((gate) => gate.id === previewGateId);
  const previewDestination = celestialMap.find((marker) => marker.id === previewSystems[0]?.id);
  const constellationGlyphIndex = useMemo(() => compileConstellationGlyphIndex(celestialSystems), [celestialSystems]);
  const constellationGlyphs = useMemo(() => projectTravelConstellationGlyphs(constellationGlyphIndex, activeSystemId, travel, travel?.startedAt ?? 0), [constellationGlyphIndex, activeSystemId, travel]);
  const ambientFlightPoints: AmbientFlightTrailPoint[] = [
    ...(localSystem.star ? [{ id: `star:${localSystem.star.physical.id}`, position: [0, 0, 0] as [number, number, number] }] : []),
    ...localSystem.planets.map((planet) => ({ id: `planet:${planet.physical.id}`, position: planet.scenePosition })),
    ...displayGates.map((gate) => ({ id: `gate:${gate.id}`, position: gate.scenePosition })),
  ];
  const ambientFlightTrailsEnabled = ambientFlightPoints.length >= 2 && !travel && !reducedMotion && previewSystems.length === 0;
  const activeRegionId = celestialSystems.find((system) => system.id === activeSystemId)?.regionId ?? null;
  const battleGates = displayGates.map((gate) => ({ id: gate.id, scenePosition: gate.scenePosition }));
  const battlePlanets = localSystem.planets.map((planet) => ({ id: planet.physical.id, scenePosition: planet.scenePosition }));

  useEffect(() => {
    setHoveredMarkerGateId(null);
    setHoveredLabelGateId(null);
    setFocusedGateId(null);
  }, [activeSystemId, travel]);

  useEffect(() => {
    // Re-clamp only when the system's own zoom range changes (e.g. a stargate jump), not on every zoom/pan.
    const clamped = clamp(camera.distance, zoomBounds.min, zoomBounds.max);
    if (clamped !== camera.distance) onCameraChange({ ...camera, distance: clamped });
  }, [zoomBounds.min, zoomBounds.max]);

  useEffect(() => {
    if (travel) return;
    onGateActiveChange(focusedGateId ?? hoveredLabelGateId ?? hoveredMarkerGateId);
  }, [focusedGateId, hoveredLabelGateId, hoveredMarkerGateId, onGateActiveChange, travel]);

  function startDrag(event: PointerEvent<Element>): void {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events do not have an active browser pointer to capture.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      pinchStart.current = { distance: pointerDistance(pointers.current), camera };
      dragStart.current = null;
      return;
    }

    dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera };
  }

  function drag(event: PointerEvent<Element>): void {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = pinchStart.current;
    if (pinch && pointers.current.size === 2) {
      onCameraChange({ ...pinch.camera, distance: clamp((pinch.camera.distance * pinch.distance) / pointerDistance(pointers.current), zoomBounds.min, zoomBounds.max) });
      return;
    }

    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;

    onCameraChange({
      ...start.camera,
      azimuth: start.camera.azimuth - (event.clientX - start.x) * 0.012,
      elevation: clamp(start.camera.elevation + (event.clientY - start.y) * 0.008, -1.1, 1.1),
    });
  }

  function stopDrag(event: PointerEvent<Element>): void {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (dragStart.current?.pointerId === event.pointerId) dragStart.current = null;
  }

  function zoom(event: WheelEvent<Element>): void {
    event.preventDefault();
    const step = event.deltaY * ZOOM_STEP_RATIO * (zoomBounds.max - zoomBounds.min);
    onCameraChange({ ...camera, distance: clamp(camera.distance + step, zoomBounds.min, zoomBounds.max) });
  }

  return (
    <div
      aria-label={`Interactive star system centered on ${systemName}'s star`}
      className="scene-viewport"
      data-reduced-motion={reducedMotion || undefined}
      data-ambient-flight-trails={ambientFlightTrailsEnabled ? "enabled" : "disabled"}
      data-render-profile={quality.name}
      data-physical-scale={LOCAL_SYSTEM_SCENE_UNITS_PER_METER}
      data-orbit-context="sde-ellipses"
      data-orbit-count={localSystem.planets.length}
      data-celestial-map-system-count={celestialMap.length}
      data-celestial-map-active-system={activeSystemId}
       data-celestial-map-render-profile={quality.name}
           data-constellation-glyph-count={constellationGlyphs.length}
           data-constellation-glyph-ids={constellationGlyphs.map((glyph) => glyph.constellationId).join(",")}
           data-constellation-spike-star-count={constellationGlyphs.reduce((total, glyph) => total + glyph.nodes.filter((node) => node.opacity > 0.001).length, 0)}
           data-constellation-spikes-per-star={GLYPH_STAR_SPIKE_COUNT}
           data-constellation-star-diameters={glyphStarDiameterRange(constellationGlyphs, quality.name)}
           data-constellation-glyph-reach={glyphReachRange(constellationGlyphs)}
          data-celestial-preview-arc-count={previewEdges.length}
      data-jump-preview-system-ids={previewSystems.map((system) => system.id).join(",") || undefined}
         data-jump-preview-edges={previewEdges.map((edge) => edge.join(":" )).join(",") || undefined}
      data-travel-phase={travel?.phase ?? undefined}
      data-gate-hitbox-hovered={hoveredMarkerGateId !== null || undefined}
       data-local-system-detail={travel ? "transition" : "full"}
      onWheel={zoom}
      role="application"
    >
      <div
        aria-hidden="true"
        className="scene-input"
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onWheel={zoom}
      />
        <Canvas
          camera={{ near: 0.005 }}
          dpr={quality.dpr}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
      >
        <color attach="background" args={["#020307"]} />
        <CameraRig camera={camera} reducedMotion={reducedMotion} />
        <ambientLight intensity={0.04} />
        <SkyBackground quality={quality} />
        <BackgroundStars field={quality.starCount === 520 ? DECORATIVE_STARS : MOBILE_DECORATIVE_STARS} />
        <CelestialMap systems={celestialSystems} activeSystemId={activeSystemId} travel={travel} constellationGlyphIndex={constellationGlyphIndex} constellationGlyphs={constellationGlyphs} previewEdges={previewEdges} previewLeaving={previewLeaving} quality={quality} reducedMotion={reducedMotion} snapshotTime={snapshotTime} />
        <LocalSystemFrame travel={travel}>
          <SystemPoint travel={travel} />
          <LocalSystemDetails travel={travel}>
            <pointLight color="#ffd38a" intensity={20} distance={40} decay={2} />
            {ambientFlightTrailsEnabled && <FlightTrailLayer key={`flight-${activeSystemId}`} points={ambientFlightPoints} seed={activeSystemId} profile={quality.name} snapshotTime={snapshotTime} />}
            <BattleFlareLayer key={`battle-${activeSystemId}`} systemId={activeSystemId} regionId={activeRegionId} gates={battleGates} planets={battlePlanets} quality={quality} reducedMotion={reducedMotion} snapshotTime={snapshotTime} />
            <CalmStar star={localSystem.star} snapshotTime={snapshotTime} quality={quality} reducedMotion={reducedMotion} />
            <Planets planets={localSystem.planets} subdued={previewSystems.length > 0} quality={quality} travelling={travel !== null} />
            <GateMarkers gates={displayGates} activeGateId={activeGateId} onActivate={onGateActivate} onHoverChange={setHoveredMarkerGateId} segments={quality.gateSegments} groupRefs={gateGroupRefs} />
            {!travel && previewGate && previewDestination && <GatePreviewConnection gate={previewGate} destination={previewDestination.direction} leaving={previewLeaving} />}
          </LocalSystemDetails>
        </LocalSystemFrame>
        <GateLayout gates={displayGates} groupRefs={gateGroupRefs} labelRefs={gateLabelRefs} travel={travel} />
      </Canvas>
      <Stargates gates={displayGates} activeGateId={activeGateId} labelRefs={gateLabelRefs} onActivate={onGateActivate} onFocusChange={setFocusedGateId} onHoverChange={setHoveredLabelGateId} />
    </div>
  );
}

function Stargates({ gates, activeGateId, labelRefs, onActivate, onFocusChange, onHoverChange }: { gates: DisplayGate[]; activeGateId: number | null; labelRefs: MutableRefObject<Map<number, HTMLButtonElement>>; onActivate: (gateId: number) => void; onFocusChange: (gateId: number | null) => void; onHoverChange: (gateId: number | null) => void }): ReactNode {
  return (
    <div aria-label="System stargates" className="stargates">
      {gates.map((gate) => {
        return (
          <button
            aria-pressed={activeGateId === gate.id}
            className="stargate-marker"
            data-active={activeGateId === gate.id || undefined}
            data-physical-position={gate.physical.position.join(",")}
            data-scene-position={gate.scenePosition.join(",")}
            key={gate.id}
            onClick={(event) => {
              event.currentTarget.blur();
              onActivate(gate.id);
            }}
            onBlur={() => onFocusChange(null)}
            onFocus={() => onFocusChange(gate.id)}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={() => onHoverChange(gate.id)}
            onPointerLeave={() => onHoverChange(null)}
            ref={(element) => {
              if (element) labelRefs.current.set(gate.id, element);
              else labelRefs.current.delete(gate.id);
            }}
            type="button"
          >
            <span aria-hidden="true" className="stargate-marker__label">{gate.destinationName}</span>
            <span className="screen-reader-only">Stargate to {gate.destinationName}</span>
          </button>
        );
      })}
    </div>
  );
}

function GateMarkers({ gates, activeGateId, onActivate, onHoverChange, segments, groupRefs }: { gates: DisplayGate[]; activeGateId: number | null; onActivate: (gateId: number) => void; onHoverChange: (gateId: number | null) => void; segments: number; groupRefs: MutableRefObject<Map<number, Group>> }): ReactNode {
  return <>{gates.map((gate) => <GateMarker key={gate.id} gate={gate} active={activeGateId === gate.id} onActivate={onActivate} onHoverChange={onHoverChange} segments={segments} groupRefs={groupRefs} />)}</>;
}

function GateMarker({ gate, active, onActivate, onHoverChange, segments, groupRefs }: { gate: DisplayGate; active: boolean; onActivate: (gateId: number) => void; onHoverChange: (gateId: number | null) => void; segments: number; groupRefs: MutableRefObject<Map<number, Group>> }): ReactNode {
  const marker = useRef<Group>(null);
  const position = gate.displayPosition;
  const direction = useRef(new Vector3());
  const rotation = useRef(new Quaternion());
  const up = useRef(new Vector3(0, 1, 0));

  useFrame(({ camera }) => {
    const target = gate.destinationDirection
      ? direction.current.fromArray(gate.destinationDirection).multiplyScalar(24).add(camera.position).sub(position)
      : direction.current.copy(position);
    marker.current?.quaternion.copy(rotation.current.setFromUnitVectors(up.current, target.normalize()));
  });

  return (
    <group
      ref={(group) => {
        marker.current = group;
        if (group) groupRefs.current.set(gate.id, group);
        else groupRefs.current.delete(gate.id);
      }}
      position={position}
    >
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onActivate(gate.id);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={(event) => {
          event.stopPropagation();
          onHoverChange(gate.id);
        }}
        onPointerLeave={() => onHoverChange(null)}
      >
        <sphereGeometry args={[0.5, segments, Math.max(4, Math.floor(segments / 2))]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh raycast={() => null}>
        <coneGeometry args={[0.2, 0.72, Math.max(6, Math.floor(segments / 2))]} />
        <meshBasicMaterial color={active ? SCENE_PALETTE.gate.active : SCENE_PALETTE.gate.idle} transparent opacity={0.92} depthWrite={false} />
      </mesh>
      <mesh raycast={() => null} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.34, 0.035, Math.max(6, Math.floor(segments / 2)), segments]} />
        <meshBasicMaterial color={active ? SCENE_PALETTE.gate.active : SCENE_PALETTE.gate.idle} transparent opacity={0.72} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Drives both the 3D gate glyphs and their DOM destination-name labels from one resolved,
// decluttered screen position per gate, so a glyph and its label never drift apart.
function GateLayout({ gates, groupRefs, labelRefs, travel }: { gates: DisplayGate[]; groupRefs: MutableRefObject<Map<number, Group>>; labelRefs: MutableRefObject<Map<number, HTMLButtonElement>>; travel: TravelFrame | null }): null {
  const { camera, size } = useThree();
  const anchorPosition = useRef(new Vector3());
  const scratch = useRef(new Vector3());

  useFrame(() => {
    const systemOffset = travelSystemOffset(travel, performance.now(), new Vector3());
    const opacity = localDetailOpacity(systemOffset.length());
    const verticalFov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    const pixelsPerMarkerUnit = size.height / (MARKER_SCALE_DIVISOR * 2 * Math.tan(verticalFov / 2));
    const markerPixelRadius = GATE_MARKER_SIZE * GATE_MARKER_OUTER_RADIUS * pixelsPerMarkerUnit;

    const circles: OverlapCircle[] = [];
    const depths = new Map<number, number>();

    for (const gate of gates) {
      const group = groupRefs.current.get(gate.id);
      if (!group) continue;

      anchorPosition.current.copy(gate.displayPosition).add(systemOffset);
      const distance = anchorPosition.current.distanceTo(camera.position);
      group.scale.setScalar(markerScale(distance, GATE_MARKER_SIZE));

      const point = scratch.current.copy(anchorPosition.current).project(camera);
      circles.push({
        id: gate.id,
        x: ((point.x + 1) * size.width) / 2,
        y: ((1 - point.y) * size.height) / 2,
        radius: markerPixelRadius,
      });
      depths.set(gate.id, point.z);
    }

    const resolvedPositions = resolveMarkerOverlapByMoving(circles);
    const placedLabels: { x: number; y: number; width: number; height: number }[] = [];

    for (const gate of gates) {
      const group = groupRefs.current.get(gate.id);
      const resolved = resolvedPositions.get(gate.id);
      const depth = depths.get(gate.id);
      if (!group || !resolved || depth === undefined) continue;

      const ndcX = (resolved.x / size.width) * 2 - 1;
      const ndcY = 1 - (resolved.y / size.height) * 2;
      const worldTarget = scratch.current.set(ndcX, ndcY, depth).unproject(camera);
      group.position.copy(worldTarget).sub(systemOffset);

      const label = labelRefs.current.get(gate.id);
      if (!label) continue;

      label.style.opacity = String(opacity);
      label.style.pointerEvents = opacity > 0.05 ? "auto" : "none";
      label.tabIndex = opacity > 0.05 ? 0 : -1;
      {
        const width = label.offsetWidth;
        const height = label.offsetHeight;
        let x = clamp(resolved.x, width / 2 + 8, size.width - width / 2 - 8);
        let y = clamp(resolved.y, height / 2 + 8, size.height - height / 2 - 8);

        // Nearly collinear gates need separate, still projection-anchored DOM targets.
        for (let attempt = 0; attempt < gates.length; attempt += 1) {
          const collision = placedLabels.find((placed) => Math.abs(x - placed.x) < (width + placed.width) / 2 + 8 && Math.abs(y - placed.y) < (height + placed.height) / 2 + 8);
          if (!collision) break;
          y = collision.y + (height + collision.height) / 2 + 8;
          if (y > size.height - height / 2 - 8) {
            y = height / 2 + 8;
            x = clamp(x + width + 16, width / 2 + 8, size.width - width / 2 - 8);
          }
        }

        placedLabels.push({ x, y, width, height });
        label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      }
    }
  });

  return null;
}

function Planets({ planets, subdued, quality, travelling }: { planets: LocalSystemProjection["planets"]; subdued: boolean; quality: RenderQuality; travelling: boolean }): ReactNode {
  const trailPlanets = planets.map(toOrbitTrailPlanet);
  const markerRefs = useRef(new Map<number, Mesh>());
  return (
    <>
      {planets.map((planet) => <Planet key={planet.physical.id} planet={planet} trailPlanets={trailPlanets} subdued={subdued} quality={quality} markerRefs={markerRefs} />)}
      <PlanetMarkerLayout planets={planets} markerRefs={markerRefs} travelling={travelling} />
    </>
  );
}

function Planet({ planet, trailPlanets, subdued, quality, markerRefs }: { planet: LocalSystemProjection["planets"][number]; trailPlanets: OrbitTrailPlanet[]; subdued: boolean; quality: RenderQuality; markerRefs: MutableRefObject<Map<number, Mesh>> }): ReactNode {
  const position = new Vector3(...planet.scenePosition);
  const trail = calculateOrbitTrail(toOrbitTrailPlanet(planet), trailPlanets, quality.trailSegments);
  const appearance = planetAppearance(planet.physical.typeId);

  return (
    <>
      <group position={position}>
        {planet.sceneRadius > 0 && (
          <mesh scale={planet.sceneRadius}>
            <sphereGeometry args={[1, quality.planetSegments, quality.planetSegments]} />
            <meshStandardMaterial color={appearance.surface} emissive={appearance.emissive} emissiveIntensity={subdued ? 0.12 : 0.3} roughness={0.9} transparent opacity={subdued ? 0.45 : 1} />
          </mesh>
        )}
        <PlanetMarker id={planet.physical.id} color={appearance.marker} subdued={subdued} segments={quality.planetMarkerSegments} markerRefs={markerRefs} />
      </group>
      <OrbitTrail trail={trail} subdued={subdued} />
      <OrbitContext orbit={planet.orbit} segments={quality.orbitSegments} />
    </>
  );
}

function OrbitTrail({ trail, subdued }: { trail: ReturnType<typeof calculateOrbitTrail>; subdued: boolean }): ReactNode {
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(trail.points.flat()), 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={SCENE_PALETTE.orbit.trail} transparent opacity={subdued ? trail.opacity * 0.45 : trail.opacity} depthWrite={false} />
    </line>
  );
}

function OrbitContext({ orbit, segments }: { orbit: LocalSystemProjection["planets"][number]["orbit"]; segments: number }): ReactNode {
  const { semiMajorAxis, semiMinorAxis } = orbitAxes(orbit);
  return (
    <mesh quaternion={new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...orbit.sceneNormal))} scale={[semiMajorAxis, semiMinorAxis, 1]}>
      <ringGeometry args={[0.994, 1.006, segments]} />
      <meshBasicMaterial color={SCENE_PALETTE.orbit.context} transparent opacity={0.24} side={2} depthWrite={false} />
    </mesh>
  );
}

function PlanetMarker({ id, color, subdued, segments, markerRefs }: { id: number; color: string; subdued: boolean; segments: number; markerRefs: MutableRefObject<Map<number, Mesh>> }): ReactNode {
  return (
    <mesh
      ref={(mesh) => {
        if (mesh) markerRefs.current.set(id, mesh);
        else markerRefs.current.delete(id);
      }}
    >
      <sphereGeometry args={[1, segments, Math.max(4, Math.floor(segments / 2))]} />
      <meshBasicMaterial color={color} transparent opacity={PLANET_MARKER_BASE_OPACITY * (subdued ? 0.45 : 1)} depthWrite={false} />
    </mesh>
  );
}

// Resolves every planet marker's on-screen size in one pass (instead of each marker computing
// its own scale in isolation) so overlapping markers can be shrunk relative to each other.
function PlanetMarkerLayout({ planets, markerRefs, travelling }: { planets: LocalSystemProjection["planets"]; markerRefs: MutableRefObject<Map<number, Mesh>>; travelling: boolean }): null {
  const { camera, size } = useThree();
  const worldPosition = useRef(new Vector3());
  const scratch = useRef(new Vector3());

  useFrame(() => {
    const verticalFov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    const pixelsPerMarkerUnit = size.height / (MARKER_SCALE_DIVISOR * 2 * Math.tan(verticalFov / 2));

    const circles: OverlapCircle[] = [];
    const baseScales = new Map<number, number>();

    for (const planet of planets) {
      const mesh = markerRefs.current.get(planet.physical.id);
      if (!mesh) continue;

      mesh.getWorldPosition(worldPosition.current);
      const distance = worldPosition.current.distanceTo(camera.position);
      baseScales.set(planet.physical.id, markerScale(travelling ? 12 : distance, planet.markerSize));

      const point = scratch.current.copy(worldPosition.current).project(camera);
      circles.push({
        id: planet.physical.id,
        x: ((point.x + 1) * size.width) / 2,
        y: ((1 - point.y) * size.height) / 2,
        radius: planet.markerSize * pixelsPerMarkerUnit,
      });
    }

    const resolvedRadii = resolveMarkerOverlapByShrinking(circles);

    for (const circle of circles) {
      const mesh = markerRefs.current.get(circle.id);
      const baseScale = baseScales.get(circle.id);
      const resolvedRadius = resolvedRadii.get(circle.id);
      if (!mesh || baseScale === undefined || resolvedRadius === undefined) continue;
      mesh.scale.setScalar(baseScale * (resolvedRadius / circle.radius));
    }
  });

  return null;
}

export function markerScale(cameraDistance: number, markerSize: number): number {
  return (cameraDistance * markerSize) / MARKER_SCALE_DIVISOR;
}

export type OverlapCircle = { id: number; x: number; y: number; radius: number };

// Pushes overlapping circles apart (in screen-pixel space) until none of them overlap, without
// touching their radius. Used to keep gate glyphs distinct instead of letting them merge visually.
export function resolveMarkerOverlapByMoving(circles: OverlapCircle[], options: { gap?: number; iterations?: number } = {}): Map<number, { x: number; y: number }> {
  const gap = options.gap ?? 6;
  const iterations = options.iterations ?? 6;
  const positions = new Map(circles.map((circle) => [circle.id, { x: circle.x, y: circle.y }]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let moved = false;

    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const a = positions.get(circles[i].id)!;
        const b = positions.get(circles[j].id)!;
        const minDistance = circles[i].radius + circles[j].radius + gap;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;

        if (distance < 1e-6) {
          const angle = ((i + 1) * Math.PI * 2) / (circles.length + 1);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const push = (minDistance - distance) / 2;
        const unitX = dx / distance;
        const unitY = dy / distance;
        a.x -= unitX * push;
        a.y -= unitY * push;
        b.x += unitX * push;
        b.y += unitY * push;
        moved = true;
      }
    }

    if (!moved) break;
  }

  return positions;
}

// Shrinks overlapping circles' radii (never their position) until none of them overlap, down to
// a floor so a dense cluster of planets never shrinks all the way to invisible.
export function resolveMarkerOverlapByShrinking(circles: OverlapCircle[], options: { gap?: number; iterations?: number; minRadiusRatio?: number } = {}): Map<number, number> {
  const gap = options.gap ?? 2;
  const iterations = options.iterations ?? 6;
  const minRadiusRatio = options.minRadiusRatio ?? 0.4;
  const radii = new Map(circles.map((circle) => [circle.id, circle.radius]));
  const minRadii = new Map(circles.map((circle) => [circle.id, circle.radius * minRadiusRatio]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let shrunk = false;

    for (let i = 0; i < circles.length; i += 1) {
      for (let j = i + 1; j < circles.length; j += 1) {
        const idA = circles[i].id;
        const idB = circles[j].id;
        const radiusA = radii.get(idA)!;
        const radiusB = radii.get(idB)!;
        const distance = Math.hypot(circles[j].x - circles[i].x, circles[j].y - circles[i].y);
        const overlap = radiusA + radiusB + gap - distance;
        if (overlap <= 0) continue;

        const shrinkEach = overlap / 2;
        const nextA = Math.max(minRadii.get(idA)!, radiusA - shrinkEach);
        const nextB = Math.max(minRadii.get(idB)!, radiusB - shrinkEach);
        if (nextA !== radiusA || nextB !== radiusB) shrunk = true;
        radii.set(idA, nextA);
        radii.set(idB, nextB);
      }
    }

    if (!shrunk) break;
  }

  return radii;
}

function LocalSystemFrame({ travel, children }: { travel: TravelFrame | null; children: ReactNode }): ReactNode {
  const frame = useRef<Group>(null);

  useFrame(() => frame.current?.position.copy(travelSystemOffset(travel, performance.now())));

  return <group ref={frame}>{children}</group>;
}

function LocalSystemDetails({ travel, children }: { travel: TravelFrame | null; children: ReactNode }): ReactNode {
  const details = useRef<Group>(null);

  useFrame(() => {
    const distance = travelSystemOffset(travel, performance.now()).length();
    if (details.current) details.current.visible = localDetailOpacity(distance) > 0;
  });

  return <group ref={details}>{children}</group>;
}

function SystemPoint({ travel }: { travel: TravelFrame | null }): ReactNode {
  const point = useRef<Group>(null);
  const material = useRef<PointsMaterial>(null);

  useFrame(() => {
    const distance = travelSystemOffset(travel, performance.now()).length();
    if (point.current) point.current.visible = localDetailOpacity(distance) > 0;
    if (material.current) {
      material.current.opacity = 1 - localDetailOpacity(distance);
      material.current.size = 2 + (1 - distance / 480) * 4;
    }
  });

  return (
    <group ref={point}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0]), 3]} />
        </bufferGeometry>
        <pointsMaterial ref={material} color="#ffd38a" size={2} sizeAttenuation={false} transparent depthWrite={false} />
      </points>
    </group>
  );
}

function CameraRig({ camera, reducedMotion }: { camera: CameraState; reducedMotion: boolean }): null {
  const { camera: threeCamera } = useThree();
  const targetPosition = useRef(new Vector3());
  const displayedCamera = useRef({ ...camera });

  useLayoutEffect(() => {
    threeCamera.position.copy(orbitCameraPosition(displayedCamera.current, targetPosition.current));
    threeCamera.lookAt(0, 0, 0);
  }, [threeCamera]);

  useFrame((_, delta) => {
    displayedCamera.current = reducedMotion ? camera : dampCameraState(displayedCamera.current, camera, delta);
    threeCamera.position.copy(orbitCameraPosition(displayedCamera.current, targetPosition.current));
    threeCamera.lookAt(0, 0, 0);
  });

  return null;
}

function projectGates(gates: LocalSystemProjection["gates"], celestialMap: ReturnType<typeof projectCelestialMap>): DisplayGate[] {
  return gates.map((gate) => ({
    ...gate,
    id: gate.physical.id,
    destinationName: gate.physical.destinationName,
    destinationDirection: celestialMap.find((marker) => marker.id === gate.physical.destinationSystemId)?.direction ?? null,
    displayPosition: new Vector3(...gate.scenePosition),
  }));
}

function toOrbitTrailPlanet(planet: LocalSystemProjection["planets"][number]): OrbitTrailPlanet {
  return planet.orbit.kind === "sde-ellipse"
    ? { id: planet.physical.id, position: planet.scenePosition, orbit: { kind: "ellipse", ...orbitAxes(planet.orbit) } }
    : { id: planet.physical.id, position: planet.scenePosition, orbit: { kind: "circle", radius: planet.orbit.radius, normal: planet.orbit.sceneNormal } };
}

function orbitAxes(orbit: LocalSystemProjection["planets"][number]["orbit"]): { semiMajorAxis: number; semiMinorAxis: number } {
  return orbit.kind === "sde-ellipse"
    ? { semiMajorAxis: orbit.semiMajorAxis, semiMinorAxis: orbit.semiMinorAxis }
    : { semiMajorAxis: orbit.radius, semiMinorAxis: orbit.radius };
}

export function calculateZoomBounds(planets: { orbit: LocalSystemProjection["planets"][number]["orbit"] }[], gates: { scenePosition: [number, number, number] }[]): ZoomBounds {
  const orbitRadii = planets.map((planet) => orbitAxes(planet.orbit).semiMajorAxis);
  const gateDistances = gates.map((gate) => Math.hypot(...gate.scenePosition));

  if (orbitRadii.length === 0) {
    const max = gateDistances.length > 0 ? Math.max(FALLBACK_MAX_DISTANCE, Math.max(...gateDistances) * FARTHEST_OBJECT_MARGIN) : FALLBACK_MAX_DISTANCE;
    return { min: FALLBACK_MIN_DISTANCE, max };
  }

  const min = Math.min(...orbitRadii);
  const farthest = Math.max(...orbitRadii, ...gateDistances);
  return { min, max: farthest * FARTHEST_OBJECT_MARGIN };
}

type DecorativeStarField = { positions: Float32Array; colors: Float32Array; sizes: Float32Array };

// Deterministic (seeded, not Math.random) so the field is stable across renders and reproducible
// in visual regression snapshots. Kept separate from Celestial Map data: positions are an arbitrary
// decorative shell, not derived from any real Solar System.
function createDecorativeStarField(count: number): DecorativeStarField {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  let randomState = 0x9e3779b9;
  const next = (): number => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0xffffffff;
  };

  for (let index = 0; index < count; index += 1) {
    const radiusMin = 28;
    const radiusMax = 73;
    const radius = radiusMin + next() * (radiusMax - radiusMin);
    const theta = next() * Math.PI * 2;
    const y = next() * 2 - 1;
    const horizontal = Math.sqrt(1 - y * y);
    positions[index * 3] = Math.cos(theta) * horizontal * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] = Math.sin(theta) * horizontal * radius;

    // A small deterministic temperature variation (cool blue-white to faint warm white) so the
    // decorative fill reads as procedural starlight rather than one flat tinted dot pattern.
    const temperature = next();
    colors[index * 3] = 0.62 + temperature * 0.24;
    colors[index * 3 + 1] = 0.68 + temperature * 0.12;
    colors[index * 3 + 2] = 0.82 - temperature * 0.22;

    // Size is baked from this star's own fixed shell radius, not Three's built-in sizeAttenuation:
    // that scales by view-space depth (-mvPosition.z) rather than true camera distance, which is
    // only correct for points near the optical axis. Every decorative star sits at a fixed distance
    // from the camera by construction (this whole shell tracks camera position every frame), so as
    // the camera orbits in azimuth - sweeping through this wide-FOV canvas's *wider* horizontal
    // extent - a star drifting off-axis would keep shrinking and fading well before reaching the
    // screen edge, though never during elevation's narrower vertical sweep. Baking size from radius
    // once keeps every star's apparent size constant regardless of camera orientation.
    const t = (radius - radiusMin) / (radiusMax - radiusMin);
    sizes[index] = DECORATIVE_STAR_SIZE_NEAR_PX + (DECORATIVE_STAR_SIZE_FAR_PX - DECORATIVE_STAR_SIZE_NEAR_PX) * t;
  }

  return { positions, colors, sizes };
}

const DECORATIVE_STAR_VERTEX_SHADER = `
  uniform float uPixelRatio;
  attribute vec3 color;
  attribute float starSize;
  varying vec3 vColor;

  void main() {
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = starSize * uPixelRatio;
  }
`;

const DECORATIVE_STAR_FRAGMENT_SHADER = `
  varying vec3 vColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(vColor, uOpacity);
  }
`;

function BackgroundStars({ field }: { field: DecorativeStarField }): ReactNode {
  const sky = useRef<Group>(null);
  const material = useRef<ShaderMaterial>(null);
  const dpr = useThree((state) => state.viewport.dpr);

  useEffect(() => {
    if (material.current) material.current.uniforms.uPixelRatio.value = dpr;
  }, [dpr]);

  useFrame(({ camera }) => sky.current?.position.copy(camera.position));

  return (
    <group ref={sky}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[field.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[field.colors, 3]} />
          <bufferAttribute attach="attributes-starSize" args={[field.sizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={material}
          vertexShader={DECORATIVE_STAR_VERTEX_SHADER}
          fragmentShader={DECORATIVE_STAR_FRAGMENT_SHADER}
          uniforms={{ uPixelRatio: { value: 1 }, uOpacity: { value: DECORATIVE_STAR_MAX_OPACITY } }}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

// The narrowest and widest Glyph Star in the sky, in CSS pixels, so that a star growing as the
// observer comes closer is something a test can read rather than a difference between two
// screenshots. A sky holding one glyph at one distance legitimately reports the same twice.
function glyphStarDiameterRange(glyphs: ReturnType<typeof projectTravelConstellationGlyphs>, profile: RenderQuality["name"]): string {
  const diameters = glyphs.flatMap((glyph) => glyph.nodes.filter((node) => node.opacity > 0.001).map((node) => glyphStarDiameter(node.distance, profile)));
  return diameters.length === 0 ? "" : `${Math.min(...diameters).toFixed(1)}:${Math.max(...diameters).toFixed(1)}`;
}

// The smallest and largest figure in the sky, as multiples of their own constellation's radius, so
// that a figure drawn the size of its stars is something a test can read. Both halves report the
// same number, because that is the promise: a figure is framed out to one fixed multiple, whatever
// constellation it stands in and wherever the observer is.
function glyphReachRange(glyphs: ReturnType<typeof projectTravelConstellationGlyphs>): string {
  const reaches = glyphs.filter((glyph) => glyph.reach > 0).map((glyph) => glyph.reach);
  return reaches.length === 0 ? "" : `${Math.min(...reaches).toFixed(2)}:${Math.max(...reaches).toFixed(2)}`;
}

function CelestialMap({ systems, activeSystemId, travel, constellationGlyphIndex, constellationGlyphs, previewEdges, previewLeaving, quality, reducedMotion, snapshotTime }: { systems: UniverseIndex["systems"]; activeSystemId: number; travel: TravelFrame | null; constellationGlyphIndex: ReturnType<typeof compileConstellationGlyphIndex>; constellationGlyphs: ReturnType<typeof projectTravelConstellationGlyphs>; previewEdges: [number, number][]; previewLeaving: boolean; quality: RenderQuality; reducedMotion: boolean; snapshotTime: number | null }): ReactNode {
  const sphere = useRef<Group>(null);
  const projectedMarkers = useMemo(
    () => projectTravelInterstellarProjection(systems, activeSystemId, travel, travel?.startedAt ?? 0),
    [systems, activeSystemId, travel],
  );
  const previewArcs = useMemo(() => projectInterstellarPreview(projectedMarkers, previewEdges), [projectedMarkers, previewEdges]);

  useFrame(({ camera }) => sphere.current?.position.copy(camera.position));

  return (
    <group ref={sphere}>
      <ConstellationGlyphs index={constellationGlyphIndex} activeSystemId={activeSystemId} travel={travel} glyphs={constellationGlyphs} quality={quality} reducedMotion={reducedMotion} snapshotTime={snapshotTime} />
      <BattleBeaconOverlay systems={systems} activeSystemId={activeSystemId} travel={travel} quality={quality} reducedMotion={reducedMotion} snapshotTime={snapshotTime} />
      <CelestialStarField systems={systems} activeSystemId={activeSystemId} travel={travel} quality={quality} />
      {previewArcs.map(({ edge, from, to }) => <CelestialPreviewArc from={from} to={to} leaving={previewLeaving} key={edge.join(":")} />)}
    </group>
  );
}

function CelestialPreviewArc({ from, to, leaving }: { from: [number, number, number]; to: [number, number, number]; leaving: boolean }): ReactNode {
  const material = useRef<LineBasicMaterial>(null);
  const start = new Vector3(...from).multiplyScalar(24);
  const end = new Vector3(...to).multiplyScalar(24);
  const control = start.clone().add(end).normalize().multiplyScalar(27);
  const points = new QuadraticBezierCurve3(start, control, end).getPoints(24);

  useFrame((_, delta) => {
    if (!material.current) return;
    material.current.opacity = leaving ? Math.max(0, material.current.opacity - delta / 0.18 * 0.74) : 0.74;
  });

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(points.flatMap((point) => point.toArray())), 3]} />
      </bufferGeometry>
      <lineBasicMaterial ref={material} color={SCENE_PALETTE.route.arc} transparent opacity={0.74} depthWrite={false} />
    </line>
  );
}

function GatePreviewConnection({ gate, destination, leaving }: { gate: DisplayGate; destination: [number, number, number]; leaving: boolean }): ReactNode {
  const geometry = useRef<BufferGeometry>(null);
  const material = useRef<LineBasicMaterial>(null);
  const positions = useRef(new Float32Array(6));

  useFrame(({ camera }, delta) => {
    const target = new Vector3(...destination).multiplyScalar(24).add(camera.position);
    positions.current.set([...gate.displayPosition.toArray(), ...target.toArray()]);
    const attribute = geometry.current?.getAttribute("position");
    if (attribute) attribute.needsUpdate = true;
    if (material.current) material.current.opacity = leaving ? Math.max(0, material.current.opacity - delta / 0.18 * 0.92) : 0.92;
  });

  return (
    <line>
      <bufferGeometry ref={geometry}>
        <bufferAttribute attach="attributes-position" args={[positions.current, 3]} />
      </bufferGeometry>
      <lineBasicMaterial ref={material} color={SCENE_PALETTE.route.connection} transparent opacity={0.92} depthTest={false} depthWrite={false} />
    </line>
  );
}

function CalmStar({ star, snapshotTime, quality, reducedMotion }: { star: LocalSystemProjection["star"]; snapshotTime: number | null; quality: RenderQuality; reducedMotion: boolean }): ReactNode {
  const surface = useRef<Mesh>(null);
  const surfaceGeometry = useRef<SphereGeometry>(null);
  const corona = useRef<Mesh>(null);

  useEffect(() => {
    const geometry = surfaceGeometry.current;
    if (!geometry) return;

    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      const activity = 0.55 + 0.45 * Math.sin(x * 7 + y * 11 + z * 5);
      colors[index * 3] = 1;
      colors[index * 3 + 1] = 0.48 + activity * 0.32;
      colors[index * 3 + 2] = 0.08 + activity * 0.12;
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
  }, [quality.sphereSegments]);

  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const elapsed = snapshotTime ?? clock.getElapsedTime();
    if (surface.current) surface.current.rotation.y = elapsed * 0.08;
    if (corona.current) {
      const pulse = 1 + Math.sin(elapsed * 0.7) * 0.025;
      corona.current.scale.setScalar(pulse);
    }
  });

  const spectralColor = star?.physical.spectralClass.startsWith("K") ? "#ff9f4a" : "#ffd38a";

  return (
    <group>
      <group scale={(star?.sceneRadius ?? 0) * 1.42}>
        <mesh ref={corona}>
          <sphereGeometry args={[1, quality.sphereSegments, quality.sphereSegments]} />
          <meshBasicMaterial color={spectralColor} transparent opacity={0.08} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={surface} scale={star?.sceneRadius ?? 0}>
        <sphereGeometry ref={surfaceGeometry} args={[1, quality.sphereSegments, quality.sphereSegments]} />
        <meshStandardMaterial emissive="#ff5d16" emissiveIntensity={2.5} roughness={0.85} vertexColors />
      </mesh>
    </group>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointerDistance(pointers: Map<number, { x: number; y: number }>): number {
  const [first, second] = [...pointers.values()];
  return Math.hypot(first.x - second.x, first.y - second.y);
}
