import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Points, type Quaternion, RingGeometry, ShaderMaterial } from "three";
import { eventsAliveAt, explosionPhaseAt } from "./battleExplosions";
import { battleClockNow, type BattleTier } from "./battleSimulation";
import { findBattleBeaconCandidates, projectBattleBeaconCandidates, type BattleBeaconCandidate, type BattleBeaconMarker, type BattleBeaconSystem } from "./battleBeaconProjection";
import { resolveObserverPosition } from "./interstellarProjection";
import type { RenderQuality } from "./renderQuality";
import type { TravelFrame } from "./travelCoordinates";

const CELESTIAL_MAP_RADIUS = 24;
const POLL_INTERVAL_MS = 500;
const TIERS: readonly BattleTier[] = [1, 2, 3];
const TIER_BASE_COLOR: Record<BattleTier, [number, number, number]> = {
  1: [1, 0.55, 0.32],
  2: [1, 0.4, 0.22],
  3: [1, 0.28, 0.14],
};
// Fixed CSS-pixel diameters (DPR-scaled at draw time, like the star field's own core/halo
// sprites - see CelestialStarField.tsx) rather than Three's built-in sizeAttenuation: that scales by
// view-space depth, which is only correct for points near the optical axis and otherwise makes a
// beacon silently shrink and fade as it drifts toward the edge of a wide-FOV view during a camera
// orbit. A beacon should read as an anomalous, oversized point among ordinary stars, not blend in.
const TIER_POINT_SIZE_PX: Record<BattleTier, number> = { 1: 12, 2: 18, 3: 26 };
// Faint warm idle tint between events (confirmed default) — a system never goes fully dark,
// but the dominant signal is the discrete flash/ring on each event, not a continuous glow.
const IDLE_BASELINE = 0.35;
const REDUCED_MOTION_BASELINE = 0.55;
const RING_MIN_SCALE = 0.15;
const RING_MAX_SCALE = 1.1;

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

type Bucket = { points: Points; positionAttribute: BufferAttribute; colorAttribute: BufferAttribute };
type Buckets = Record<BattleTier, Bucket>;
type RingSlot = { mesh: Mesh; material: MeshBasicMaterial };
type TierEntry = { marker: BattleBeaconMarker; spike: number };
type RingCandidate = { tier: BattleTier; direction: readonly [number, number, number]; progress: number; priority: number };

// A sibling layer inside the Celestial Map's own camera-tracking group, never mutating
// the base star cloud's buffer. Composes with that cloud's existing Distance Cue
// brightness/opacity (see battleBeaconProjection.ts) rather than a second distance metric.
// Flash/ring/afterglow are driven by the same battleExplosions event stream the in-system
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
  const [rings, setRings] = useState<RingSlot[] | null>(null);
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
    const created = Array.from({ length: quality.maxSkyRingEffects }, () => createRingSlot());
    setRings(created);
    return () => {
      for (const slot of created) disposeRingSlot(slot);
    };
  }, [quality.maxSkyRingEffects]);

  useFrame(({ camera }) => {
    if (!buckets || !rings) return;

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
    const ringCandidates: RingCandidate[] = [];

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
            ringCandidates.push({
              tier: marker.tier,
              direction: marker.direction,
              progress: phaseInfo.progress,
              priority: marker.brightness * marker.opacity,
            });
          } else if (phaseInfo.progress < 0.15) {
            spike = Math.max(spike, (1 - phaseInfo.progress / 0.15) * 0.4);
          }
        }
      }
      markersByTier[marker.tier].push({ marker, spike });
    }

    for (const tier of TIERS) writeBucket(buckets[tier], tier, markersByTier[tier], reducedMotion, quality.maxBattleBeacons, dpr);

    ringCandidates.sort((left, right) => right.priority - left.priority);
    writeRings(rings, ringCandidates.slice(0, rings.length), camera.quaternion);
  });

  if (!buckets) return null;
  return (
    <>
      {TIERS.map((tier) => <primitive key={tier} object={buckets[tier].points} />)}
      {rings?.map((slot, index) => <primitive key={index} object={slot.mesh} />)}
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
  const [r, g, b] = TIER_BASE_COLOR[tier];
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

function createRingSlot(): RingSlot {
  const geometry = new RingGeometry(0.72, 1, 32);
  const material = new MeshBasicMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
    opacity: 0,
  });
  material.toneMapped = false;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;

  return { mesh, material };
}

function writeRings(rings: readonly RingSlot[], candidates: readonly RingCandidate[], cameraQuaternion: Quaternion): void {
  for (let index = 0; index < rings.length; index += 1) {
    const slot = rings[index];
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
    slot.mesh.scale.setScalar(lerp(RING_MIN_SCALE, RING_MAX_SCALE, candidate.progress));
    slot.material.opacity = (1 - candidate.progress) * 0.85;
    const [r, g, b] = TIER_BASE_COLOR[candidate.tier];
    slot.material.color.setRGB(r, g, b);
  }
}

function disposeRingSlot(slot: RingSlot): void {
  slot.mesh.geometry.dispose();
  slot.material.dispose();
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}
