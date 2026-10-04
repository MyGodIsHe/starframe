import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, type PerspectiveCamera, PlaneGeometry, Points, type Quaternion, ShaderMaterial } from "three";
import { eventsAliveAt, explosionPhaseAt } from "./battleExplosions";
import { battleClockNow, type BattleTier } from "./battleSimulation";
import {
  BATTLE_TIER_COLOR,
  SHOCKWAVE_BODY_RAMP,
  SHOCKWAVE_CHROMATIC_SPREAD,
  SHOCKWAVE_COOLING,
  SHOCKWAVE_CORE_COLOR,
  SHOCKWAVE_CORE_FALLOFF,
  SHOCKWAVE_CORE_GAIN,
  SHOCKWAVE_CORE_RAMP,
  SHOCKWAVE_DISSIPATION_FLOOR,
  SHOCKWAVE_DISSIPATION_GAIN,
  SHOCKWAVE_FADE_EXPONENT,
  SHOCKWAVE_FRONT_EASE,
  SHOCKWAVE_FRONT_MAX,
  SHOCKWAVE_FRONT_MIN,
  SHOCKWAVE_INNER_SOFTNESS,
  SHOCKWAVE_OUTER_SHARPNESS,
  SHOCKWAVE_PROXIMITY_FALLOFF,
  SHOCKWAVE_RIM_GAIN,
  SHOCKWAVE_RIM_SHARPNESS,
  SHOCKWAVE_SHELL_GAIN,
  SHOCKWAVE_TAIL_COLOR,
  SHOCKWAVE_THICKNESS_MAX,
  SHOCKWAVE_THICKNESS_MIN,
  SHOCKWAVE_WHITE_LIFE,
  battleShockwaveLumps,
  battleShockwaveSpan,
  battleShockwaveWorldRadius,
} from "./battleShockwave";
import { findBattleBeaconCandidates, projectBattleBeaconCandidates, type BattleBeaconCandidate, type BattleBeaconMarker, type BattleBeaconSystem } from "./battleBeaconProjection";
import { resolveObserverPosition } from "./interstellarProjection";
import type { RenderQuality } from "./renderQuality";
import type { TravelFrame } from "./travelCoordinates";

const CELESTIAL_MAP_RADIUS = 24;
const POLL_INTERVAL_MS = 500;
const TIERS: readonly BattleTier[] = [1, 2, 3];
// Fixed CSS-pixel diameters (DPR-scaled at draw time, like the star field's own core/halo
// sprites - see CelestialStarField.tsx) rather than Three's built-in sizeAttenuation: that scales by
// view-space depth, which is only correct for points near the optical axis and otherwise makes a
// beacon silently shrink and fade as it drifts toward the edge of a wide-FOV view during a camera
// orbit. A beacon should read as an anomalous, oversized point among ordinary stars, not blend in.
const TIER_POINT_SIZE_PX: Record<BattleTier, number> = { 1: 12, 2: 18, 3: 26 };
// Faint warm idle tint between events (confirmed default) — a system never goes fully dark,
// but the dominant signal is the discrete flash/shockwave on each event, not a continuous glow.
const IDLE_BASELINE = 0.35;
const REDUCED_MOTION_BASELINE = 0.55;
// How much of the light a Battle Shockwave's own profile calls for actually reaches the sky, before
// the Beacon's Distance Cue weighs it. The wave is additive over a patch of sky that can be half
// the view across, so the whole shell is authored a notch under what its leading edge would burn at.
const SHOCKWAVE_SKY_STRENGTH = 0.85;

// gl_PointSize is set directly from a fixed CSS-pixel diameter (uSize, DPR-scaled below) rather than
// Three's built-in sizeAttenuation - see TIER_POINT_SIZE_PX. The soft radial falloff replaces the
// glowSpriteTexture bitmap that PointsMaterial needed for a round sprite; vColor already carries the
// marker's full brightness (baseline/spike/tier colour), so the falloff only shapes the sprite.
const BEACON_VERTEX_SHADER = `
  uniform float uSize;
  attribute vec3 color;
  varying vec3 vColor;

  void main() {
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`;

const BEACON_FRAGMENT_SHADER = `
  varying vec3 vColor;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (radius >= 1.0) discard;
    float falloff = pow(1.0 - radius, 2.4);
    gl_FragColor = vec4(vColor * falloff, falloff);
  }
`;

// A Battle Shockwave is drawn on a camera-facing quad rather than as a ring mesh: the shell, its
// white-hot leading edge, the ember trail behind it and the fireball at its centre are one radial
// gradient, and a gradient is something a fragment shader draws and a ring of triangles cannot.
// battleShockwave.ts mirrors every ramp below for tests and for the in-system Battle Flare.
const SHOCKWAVE_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Light is gathered first and given a colour only afterwards, the way the Glyph Star flare is: the
// front burns white while the wave is young, the body of the shell carries the Tier colour, and the
// trail behind it cools into ember. Brightness rides in the alpha this additive pass weighs the
// colour by, so what the mix below decides is only the hue of the light at that point of the wave.
const SHOCKWAVE_FRAGMENT_SHADER = `
  uniform float uProgress;
  uniform float uStrength;
  uniform vec4 uLumps;
  uniform vec3 uEdgeColor;
  uniform vec3 uTailColor;
  uniform vec3 uCoreColor;
  varying vec2 vUv;

  const float FRONT_MIN = ${SHOCKWAVE_FRONT_MIN.toFixed(4)};
  const float FRONT_MAX = ${SHOCKWAVE_FRONT_MAX.toFixed(4)};
  const float FRONT_EASE = ${SHOCKWAVE_FRONT_EASE.toFixed(4)};
  const float THICKNESS_MIN = ${SHOCKWAVE_THICKNESS_MIN.toFixed(4)};
  const float THICKNESS_MAX = ${SHOCKWAVE_THICKNESS_MAX.toFixed(4)};
  const float OUTER_SHARPNESS = ${SHOCKWAVE_OUTER_SHARPNESS.toFixed(4)};
  const float INNER_SOFTNESS = ${SHOCKWAVE_INNER_SOFTNESS.toFixed(4)};
  const float RIM_SHARPNESS = ${SHOCKWAVE_RIM_SHARPNESS.toFixed(4)};
  const float SHELL_GAIN = ${SHOCKWAVE_SHELL_GAIN.toFixed(4)};
  const float RIM_GAIN = ${SHOCKWAVE_RIM_GAIN.toFixed(4)};
  const float CORE_FALLOFF = ${SHOCKWAVE_CORE_FALLOFF.toFixed(4)};
  const float CORE_GAIN = ${SHOCKWAVE_CORE_GAIN.toFixed(4)};
  const float DISSIPATION_FLOOR = ${SHOCKWAVE_DISSIPATION_FLOOR.toFixed(4)};
  const float DISSIPATION_GAIN = ${SHOCKWAVE_DISSIPATION_GAIN.toFixed(4)};
  const float FADE_EXPONENT = ${SHOCKWAVE_FADE_EXPONENT.toFixed(4)};
  const float PROXIMITY_FALLOFF = ${SHOCKWAVE_PROXIMITY_FALLOFF.toFixed(4)};
  const float BODY_RAMP = ${SHOCKWAVE_BODY_RAMP.toFixed(4)};
  const float CORE_RAMP = ${SHOCKWAVE_CORE_RAMP.toFixed(4)};
  const float COOLING = ${SHOCKWAVE_COOLING.toFixed(4)};
  const float WHITE_LIFE = ${SHOCKWAVE_WHITE_LIFE.toFixed(4)};
  const vec3 CHROMATIC_SPREAD = vec3(${SHOCKWAVE_CHROMATIC_SPREAD.map((value) => value.toFixed(4)).join(", ")});

  // A shell this wide crosses hundreds of pixels with less than one framebuffer level between them,
  // which shows up as concentric bands. A fraction of a level of noise, fixed to the pixel grid,
  // turns that step into grain the eye reads as smooth light.
  float dither(vec2 fragment) {
    return fract(sin(dot(fragment, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }

  void main() {
    vec2 centered = (vUv - vec2(0.5)) * 2.0;
    float radius = length(centered);
    if (radius >= 1.0) discard;

    // Where the front stands this frame, and how far this pixel sits outside (positive) or behind
    // (negative) it, in shell thicknesses. battleShockwave.battleShockwaveFront mirrors both.
    float front = FRONT_MIN + (FRONT_MAX - FRONT_MIN) * pow(uProgress, FRONT_EASE);
    float thickness = mix(THICKNESS_MIN, THICKNESS_MAX, uProgress);
    // Two angular harmonics lean the front out of round, so one battle's waves are shells thrown
    // through wreckage rather than a target drawn on the sky. Doubling a unit direction once gives
    // cos/sin of twice the angle, and one more rotation gives three times it, which is the whole of
    // what battleShockwave.battleShockwaveLumpFactor says - without an atan under every pixel.
    vec2 unit = centered / max(radius, 1e-6);
    vec2 doubled = vec2(unit.x * unit.x - unit.y * unit.y, 2.0 * unit.x * unit.y);
    vec2 tripled = vec2(unit.x * doubled.x - unit.y * doubled.y, unit.y * doubled.x + unit.x * doubled.y);
    front *= 1.0 + dot(uLumps.xy, doubled) + dot(uLumps.zw, tripled);
    float offset = (radius - front) / thickness;
    float squared = offset * offset;

    // Gas piles up against a near vertical outer edge and drains away over several thicknesses
    // behind it, so the shell has a direction: a ring with a symmetric profile could as easily be
    // closing in as expanding.
    float shell = exp(-squared * (offset > 0.0 ? OUTER_SHARPNESS : INNER_SOFTNESS));
    float rim = exp(-squared * RIM_SHARPNESS);
    float core = exp(-radius * radius * CORE_FALLOFF) * (1.0 - uProgress) * (1.0 - uProgress);
    // One detonation's light spread over an ever larger shell, then the fade that retires the wave.
    float dissipation = 1.0 / (DISSIPATION_FLOOR + DISSIPATION_GAIN * front);
    float light = (shell * SHELL_GAIN + rim * RIM_GAIN + core * CORE_GAIN)
      * dissipation
      * pow(1.0 - uProgress, FADE_EXPONENT)
      * uStrength;
    float intensity = light + dither(gl_FragCoord.xy) * 0.004;
    if (intensity <= 0.002) discard;

    // One proximity to the front per channel, red read furthest out and blue tightest in, so the
    // front carries a warm fringe ahead of its own white line. battleShockwave.battleShockwaveTint
    // mirrors the ramp, chromatic spread included.
    vec3 reach = pow(vec3(exp(-squared * PROXIMITY_FALLOFF)), CHROMATIC_SPREAD);
    vec3 cooled = mix(uEdgeColor, uTailColor, uProgress * COOLING);
    vec3 body = mix(uTailColor, cooled, pow(reach, vec3(BODY_RAMP)));
    vec3 tint = mix(body, uCoreColor, pow(reach, vec3(CORE_RAMP)) * (1.0 - uProgress * WHITE_LIFE));

    gl_FragColor = vec4(tint, clamp(intensity, 0.0, 1.0));
  }
`;

type Bucket = { points: Points; positionAttribute: BufferAttribute; colorAttribute: BufferAttribute };
type Buckets = Record<BattleTier, Bucket>;
type ShockwaveSlot = { mesh: Mesh; material: ShaderMaterial };
type TierEntry = { marker: BattleBeaconMarker; spike: number };
type ShockwaveCandidate = {
  tier: BattleTier;
  direction: readonly [number, number, number];
  progress: number;
  // How much of the viewport height the wave spans, from the distance to the system hosting it; it
  // doubles as the priority a fixed budget of slots is handed out by, so the nearest, largest waves
  // are the ones that survive a crowded sky.
  span: number;
  strength: number;
  lumps: readonly [number, number, number, number];
};

// A sibling layer inside the Celestial Map's own camera-tracking group, never mutating
// the base star cloud's buffer. Composes with that cloud's existing Distance Cue
// brightness/opacity (see battleBeaconProjection.ts) rather than a second distance metric.
// Flash/shockwave/afterglow are driven by the same battleExplosions event stream the in-system
// view uses (streamSalt 0), so what pulses on the sky is what a traveller would find on arrival.
export function BattleBeaconOverlay({ systems, activeSystemId, travel, quality, reducedMotion, snapshotTime }: {
  systems: readonly BattleBeaconSystem[];
  activeSystemId: number;
  travel: TravelFrame | null;
  quality: RenderQuality;
  reducedMotion: boolean;
  snapshotTime: number | null;
}): ReactNode {
  const [buckets, setBuckets] = useState<Buckets | null>(null);
  const [shockwaves, setShockwaves] = useState<ShockwaveSlot[] | null>(null);
  const candidatesRef = useRef<BattleBeaconCandidate[]>([]);
  const lastPollAt = useRef(-Infinity);
  const dpr = useThree((state) => state.viewport.dpr);

  useLayoutEffect(() => {
    const created = Object.fromEntries(TIERS.map((tier) => [tier, createBucket(quality.maxBattleBeacons)])) as Buckets;
    setBuckets(created);
    return () => {
      for (const tier of TIERS) disposeBucket(created[tier]);
    };
  }, [quality.maxBattleBeacons]);

  useLayoutEffect(() => {
    const created = Array.from({ length: quality.maxSkyShockwaves }, () => createShockwaveSlot());
    setShockwaves(created);
    return () => {
      for (const slot of created) disposeShockwaveSlot(slot);
    };
  }, [quality.maxSkyShockwaves]);

  useFrame(({ camera }) => {
    if (!buckets || !shockwaves) return;

    const now = battleClockNow(snapshotTime);
    if (now - lastPollAt.current >= POLL_INTERVAL_MS) {
      lastPollAt.current = now;
      // Which systems are mid-battle changes only on an epoch boundary, so this full scan is
      // safe to throttle. The observer-relative projection below still runs every frame (using
      // this cached candidate list), so a beacon's sky direction glides continuously during
      // travel instead of snapping every poll.
      candidatesRef.current = findBattleBeaconCandidates(systems, now);
    }

    // travel.startedAt is a performance.now() timestamp (see App.tsx), not the battle
    // simulation's real-wall-clock time above — mixing the two here made travelSkyProgress
    // clamp to 1 from the first frame of a jump, snapping the beacon straight to its
    // destination-relative direction instead of gliding there like the star field does.
    const observerPosition = resolveObserverPosition(systems, activeSystemId, travel, performance.now());
    const markers = observerPosition ? projectBattleBeaconCandidates(candidatesRef.current, observerPosition, now) : [];

    const markersByTier: Record<BattleTier, TierEntry[]> = { 1: [], 2: [], 3: [] };
    const shockwaveCandidates: ShockwaveCandidate[] = [];

    for (const marker of markers) {
      let spike = 0;
      if (!reducedMotion) {
        for (const event of eventsAliveAt(marker.window, now, 0)) {
          const phaseInfo = explosionPhaseAt(event, now);
          if (!phaseInfo) continue;

          if (phaseInfo.phase === "flash") {
            spike = Math.max(spike, 1);
          } else if (phaseInfo.phase === "wave") {
            spike = Math.max(spike, 1 - phaseInfo.progress * 0.5);
            shockwaveCandidates.push({
              tier: marker.tier,
              direction: marker.direction,
              progress: phaseInfo.progress,
              span: battleShockwaveSpan(marker.distance, event.magnitude),
              strength: marker.brightness * marker.opacity * marker.intensity * SHOCKWAVE_SKY_STRENGTH,
              lumps: battleShockwaveLumps(marker.window.seed + event.tickIndex),
            });
          } else if (phaseInfo.progress < 0.15) {
            spike = Math.max(spike, (1 - phaseInfo.progress / 0.15) * 0.4);
          }
        }
      }
      markersByTier[marker.tier].push({ marker, spike });
    }

    for (const tier of TIERS) writeBucket(buckets[tier], tier, markersByTier[tier], reducedMotion, quality.maxBattleBeacons, dpr);

    // A Battle Shockwave is sized as a fraction of the viewport height, so turning that into the
    // half-width of a quad on the Celestial Map's sphere is the one place the camera's own field of
    // view comes in - and the one thing that keeps "half the sky" true whatever the view is set to.
    const verticalFov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    shockwaveCandidates.sort((left, right) => right.span - left.span);
    writeShockwaves(shockwaves, shockwaveCandidates.slice(0, shockwaves.length), camera.quaternion, verticalFov);
  });

  if (!buckets) return null;
  return (
    <>
      {TIERS.map((tier) => <primitive key={tier} object={buckets[tier].points} />)}
      {shockwaves?.map((slot, index) => <primitive key={index} object={slot.mesh} />)}
    </>
  );
}

function createBucket(capacity: number): Bucket {
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
  const colorAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", colorAttribute);

  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    fragmentShader: BEACON_FRAGMENT_SHADER,
    transparent: true,
    vertexShader: BEACON_VERTEX_SHADER,
    uniforms: { uSize: { value: 1 } },
  });
  material.toneMapped = false;

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -5;

  return { points, positionAttribute, colorAttribute };
}

function writeBucket(bucket: Bucket, tier: BattleTier, entries: readonly TierEntry[], reducedMotion: boolean, capacity: number, pixelRatio: number): void {
  const material = bucket.points.material as ShaderMaterial;
  material.uniforms.uSize.value = TIER_POINT_SIZE_PX[tier] * pixelRatio;
  const [r, g, b] = BATTLE_TIER_COLOR[tier];
  const baseline = reducedMotion ? REDUCED_MOTION_BASELINE : IDLE_BASELINE;
  const count = Math.min(entries.length, capacity);

  for (let index = 0; index < count; index += 1) {
    const { marker, spike } = entries[index];
    const factor = marker.brightness * marker.opacity * marker.intensity * (baseline + spike * (1 - baseline));
    bucket.positionAttribute.setXYZ(index, marker.direction[0] * CELESTIAL_MAP_RADIUS, marker.direction[1] * CELESTIAL_MAP_RADIUS, marker.direction[2] * CELESTIAL_MAP_RADIUS);
    bucket.colorAttribute.setXYZ(index, r * factor, g * factor, b * factor);
  }
  for (let index = count; index < capacity; index += 1) {
    bucket.colorAttribute.setXYZ(index, 0, 0, 0);
  }

  bucket.positionAttribute.needsUpdate = true;
  bucket.colorAttribute.needsUpdate = true;
}

function disposeBucket(bucket: Bucket): void {
  bucket.points.geometry.dispose();
  (bucket.points.material as ShaderMaterial).dispose();
}

// One quad per slot, reused by whichever wave the budget hands it this frame: a fresh geometry per
// Explosion Event would allocate during the busiest moment of the busiest battle. The quad spans
// [-1,1] so the shader can measure the wave in billboard units and the mesh scale alone carries
// however much of the sky this particular wave takes.
function createShockwaveSlot(): ShockwaveSlot {
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    fragmentShader: SHOCKWAVE_FRAGMENT_SHADER,
    side: DoubleSide,
    transparent: true,
    vertexShader: SHOCKWAVE_VERTEX_SHADER,
    uniforms: {
      uProgress: { value: 0 },
      uStrength: { value: 0 },
      uLumps: { value: [0, 0, 0, 0] },
      uEdgeColor: { value: [1, 1, 1] },
      uTailColor: { value: [1, 1, 1] },
      uCoreColor: { value: [1, 1, 1] },
    },
  });
  material.toneMapped = false;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;

  return { mesh, material };
}

function writeShockwaves(slots: readonly ShockwaveSlot[], candidates: readonly ShockwaveCandidate[], cameraQuaternion: Quaternion, verticalFov: number): void {
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const candidate = candidates[index];
    if (!candidate) {
      slot.mesh.visible = false;
      continue;
    }

    slot.mesh.visible = true;
    slot.mesh.position.set(
      candidate.direction[0] * CELESTIAL_MAP_RADIUS,
      candidate.direction[1] * CELESTIAL_MAP_RADIUS,
      candidate.direction[2] * CELESTIAL_MAP_RADIUS,
    );
    slot.mesh.quaternion.copy(cameraQuaternion);
    slot.mesh.scale.setScalar(battleShockwaveWorldRadius(candidate.span, CELESTIAL_MAP_RADIUS, verticalFov));

    const uniforms = slot.material.uniforms;
    uniforms.uProgress.value = candidate.progress;
    uniforms.uStrength.value = candidate.strength;
    uniforms.uLumps.value = candidate.lumps;
    uniforms.uEdgeColor.value = BATTLE_TIER_COLOR[candidate.tier];
    uniforms.uTailColor.value = SHOCKWAVE_TAIL_COLOR[candidate.tier];
    uniforms.uCoreColor.value = SHOCKWAVE_CORE_COLOR[candidate.tier];
  }
}

function disposeShockwaveSlot(slot: ShockwaveSlot): void {
  slot.mesh.geometry.dispose();
  slot.material.dispose();
}
