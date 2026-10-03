import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type PointerEvent, type ReactNode, type WheelEvent, useLayoutEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { ConstellationGlyphs } from "../constellations/ConstellationGlyphs";
import { compileConstellationGlyphIndex } from "../constellations/constellationGlyphModel";
import type { SolidPoint } from "../constellations/glyphSolid";
import type { SigilModel } from "../constellations/sigilModel";
import type { RenderQuality } from "../renderQuality";
import { dampCameraState, orbitCameraPosition, type CameraState } from "../orbitCamera";
import { viewSigilFigure } from "./sigilFigureView";

// The figure, drawn by the sky's own renderer.
//
// Nothing here draws a line itself: the strokes go to `ConstellationGlyphs`, the same component the
// Celestial Map hands its glyphs to, so the ladder, the halo, the depth ramp and the node glow are
// not a copy of the sky's and cannot drift from it. What the page adds is only a camera, a pointer,
// and the choice of where the observer stands.

const ZOOM_STEP_RATIO = 0.0012;
const ZOOM_MIN = 1.6;
const ZOOM_MAX = 9;

export function SigilFigureViewport({ model, camera, observer, onCameraChange, quality, reducedMotion }: {
  model: SigilModel;
  camera: CameraState;
  observer: SolidPoint;
  onCameraChange: (next: CameraState) => void;
  quality: RenderQuality;
  reducedMotion: boolean;
}): ReactNode {
  const dragStart = useRef<{ pointerId: number; x: number; y: number; camera: CameraState } | null>(null);
  const glyph = useMemo(() => viewSigilFigure(model, observer), [model, observer]);
  const glyphs = useMemo(() => [glyph], [glyph]);
  // The renderer wants an index to re-project from while travelling; nothing on this page travels,
  // so it is handed an empty one and never reads it.
  const index = useMemo(() => compileConstellationGlyphIndex([]), []);
  const outline = glyph.strokes.filter((stroke) => stroke.kind === "silhouette").length;
  // How much line the body leaves this observer, all of it added up. Counting strokes is too blunt
  // to tell two sides of a symmetrical figure apart - an atom can leave the same number of lines
  // from a quarter turn away - and this is the same measurement a viewer makes by eye: the drawing
  // got longer or shorter.
  const drawnLength = glyph.strokes.reduce((total, stroke) => total + Math.hypot(stroke.to[0] - stroke.from[0], stroke.to[1] - stroke.from[1], stroke.to[2] - stroke.from[2]), 0);

  function startDrag(event: PointerEvent<Element>): void {
    dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  function drag(event: PointerEvent<Element>): void {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;

    onCameraChange({
      ...start.camera,
      azimuth: start.camera.azimuth - (event.clientX - start.x) * 0.012,
      elevation: clamp(start.camera.elevation + (event.clientY - start.y) * 0.008, -1.2, 1.2),
    });
  }

  function stopDrag(event: PointerEvent<Element>): void {
    if (dragStart.current?.pointerId === event.pointerId) dragStart.current = null;
  }

  // Zoom moves the camera and nothing else. Which lines exist was decided from the observer, so
  // coming closer shows the same drawing larger - never a different one.
  function zoom(event: WheelEvent<Element>): void {
    onCameraChange({ ...camera, distance: clamp(camera.distance + event.deltaY * ZOOM_STEP_RATIO * (ZOOM_MAX - ZOOM_MIN), ZOOM_MIN, ZOOM_MAX) });
  }

  return (
    <div
      aria-label={`Sigil figure ${model.name}, seen from an observer you can walk round it`}
      className="scene-viewport"
      data-reduced-motion={reducedMotion || undefined}
      data-render-profile={quality.name}
      data-sigil-figure={model.name}
      data-sigil-stroke-count={glyph.strokes.length}
      data-sigil-outline-count={outline}
      data-sigil-line-length={drawnLength.toFixed(3)}
      data-sigil-anchors-in-sight={glyph.nodes.length}
      data-sigil-observer={observer.map((value) => value.toFixed(3)).join(",")}
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
        camera={{ near: 0.01, far: 200 }}
        dpr={quality.dpr}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <color attach="background" args={["#020307"]} />
        <CameraRig camera={camera} reducedMotion={reducedMotion} />
        <ConstellationGlyphs index={index} activeSystemId={0} travel={null} glyphs={glyphs} quality={quality} />
      </Canvas>
    </div>
  );
}

function CameraRig({ camera, reducedMotion }: { camera: CameraState; reducedMotion: boolean }): null {
  const { camera: threeCamera } = useThree();
  const position = useRef(new Vector3());
  const displayed = useRef({ ...camera });

  useLayoutEffect(() => {
    threeCamera.position.copy(orbitCameraPosition(displayed.current, position.current));
    threeCamera.lookAt(0, 0, 0);
  }, [threeCamera]);

  useFrame((_, delta) => {
    displayed.current = reducedMotion ? camera : dampCameraState(displayed.current, camera, delta);
    threeCamera.position.copy(orbitCameraPosition(displayed.current, position.current));
    threeCamera.lookAt(0, 0, 0);
  });

  return null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
