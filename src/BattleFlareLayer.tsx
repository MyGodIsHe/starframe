import { useFrame } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, type Mesh, type MeshBasicMaterial, Points, PointsMaterial } from "three";
import { eventOffset, eventsAliveAt, explosionPhaseAt } from "./battleExplosions";
import { SHOCKWAVE_FADE_EXPONENT, battleShockwaveFront } from "./battleShockwave";
import { battleClockNow, getBattleState, getBattleWindow, selectBattleAnchors, type BattleAnchor, type BattleTier, type BattleWindow } from "./battleSimulation";
import { glowSpriteTexture } from "./glowSprite";
import type { RenderQuality } from "./renderQuality";

type AnchorPoint = { id: number; scenePosition: [number, number, number] };
type ResolvedAnchor = BattleAnchor & { scenePosition: [number, number, number] };
type GlowContribution = { position: [number, number, number]; brightness: number };

const POLL_INTERVAL_MS = 1_000;
const TIER_SPREAD_FACTOR: Record<BattleTier, number> = { 1: 0.025, 2: 0.045, 3: 0.075 };
const MIN_SPREAD_UNITS = 0.15;
const TIER_COLOR: Record<BattleTier, string> = { 1: "#ff9a5a", 2: "#ff6a3d", 3: "#ff4520" };
// A location stays faintly warm-tinted even between explosions (a fallback for sparse tier-1
// skirmishes where gaps between events can run many seconds), separate from the discrete bursts.
const AMBIENT_TINT_OPACITY: Record<BattleTier, number> = { 1: 0.03, 2: 0.05, 3: 0.07 };
const WAVE_PEAK_OPACITY: Record<BattleTier, number> = { 1: 0.22, 2: 0.28, 3: 0.34 };
const SCAR_BASE_BRIGHTNESS = 0.35;

// Owns its own poll loop rather than trusting a parent-computed window: nothing else
// forces a re-render purely because wall-clock time passed, so a battle that starts
// while the player is simply sitting in-system (no camera input, no travel) would
// otherwise never appear until some unrelated state change.
export function BattleFlareLayer({ systemId, regionId, gates, planets, quality, reducedMotion, snapshotTime }: {
  systemId: number;
  regionId: number | null;
  gates: readonly AnchorPoint[];
  planets: readonly AnchorPoint[];
  quality: RenderQuality;
  reducedMotion: boolean;
  snapshotTime: number | null;
}): ReactNode {
  const [window, setWindow] = useState<BattleWindow | null>(null);
  const lastPollAt = useRef(-Infinity);

  useFrame(() => {
    const now = battleClockNow(snapshotTime);
    if (now - lastPollAt.current < POLL_INTERVAL_MS) return;
    lastPollAt.current = now;

    const next = regionId === null ? null : getBattleWindow(systemId, regionId, now);
    setWindow((previous) => (sameWindow(previous, next) ? previous : next));
  });

  if (!window) return null;

  const anchors = selectBattleAnchors(window, gates.map((gate) => gate.id), planets.map((planet) => planet.id))
    .map((anchor): ResolvedAnchor | null => {
      const source = anchor.kind === "gate" ? gates : planets;
      const match = source.find((point) => point.id === anchor.id);
      return match ? { ...anchor, scenePosition: match.scenePosition } : null;
    })
    .filter((anchor): anchor is ResolvedAnchor => anchor !== null)
    .slice(0, quality.maxFlareAnchors);

  return (
    <>
      {anchors.map((anchor, anchorIndex) => (
        <BattleAnchorFlare
          key={`${anchor.kind}:${anchor.id}`}
          window={window}
          anchor={anchor}
          anchorIndex={anchorIndex}
          quality={quality}
          reducedMotion={reducedMotion}
          snapshotTime={snapshotTime}
        />
      ))}
    </>
  );
}

function BattleAnchorFlare({ window, anchor, anchorIndex, quality, reducedMotion, snapshotTime }: {
  window: BattleWindow;
  anchor: ResolvedAnchor;
  anchorIndex: number;
  quality: RenderQuality;
  reducedMotion: boolean;
  snapshotTime: number | null;
}): ReactNode {
  const streamSalt = mix32(anchor.id, anchorIndex, anchor.kind === "gate" ? 1 : 2);
  const distance = Math.max(1, Math.hypot(...anchor.scenePosition));
  const spreadRadius = Math.max(MIN_SPREAD_UNITS, distance * TIER_SPREAD_FACTOR[window.tier]);
  const color = TIER_COLOR[window.tier];

  const ambientTint = useRef<Mesh>(null);
  const waveRefs = useRef<(Mesh | null)[]>([]);
  const [glowBucket, setGlowBucket] = useState<GlowBucket | null>(null);

  useLayoutEffect(() => {
    const bucket = createGlowBucket(quality.maxGlowPointsPerAnchor, color);
    setGlowBucket(bucket);
    return () => disposeGlowBucket(bucket);
  }, [quality.maxGlowPointsPerAnchor, color]);

  useFrame(() => {
    const now = battleClockNow(snapshotTime);
    const state = getBattleState(window, now);
    const overallIntensity = state?.intensity ?? 0;

    if (ambientTint.current) {
      (ambientTint.current.material as MeshBasicMaterial).opacity = reducedMotion
        ? AMBIENT_TINT_OPACITY[window.tier] * overallIntensity * 1.4
        : AMBIENT_TINT_OPACITY[window.tier] * overallIntensity;
    }

    const events = reducedMotion ? [] : eventsAliveAt(window, now, streamSalt);
    const waveEvents: { position: [number, number, number]; progress: number; magnitude: number }[] = [];
    const glowContributions: GlowContribution[] = [];

    for (const event of events) {
      const phaseInfo = explosionPhaseAt(event, now);
      if (!phaseInfo) continue;
      const position = eventOffset(window, event, streamSalt, spreadRadius);

      if (phaseInfo.phase === "flash") {
        glowContributions.push({ position, brightness: 1 });
      } else if (phaseInfo.phase === "wave") {
        waveEvents.push({ position, progress: phaseInfo.progress, magnitude: event.magnitude });
      } else {
        const fade = 1 - phaseInfo.progress;
        glowContributions.push({ position, brightness: fade * SCAR_BASE_BRIGHTNESS * (0.5 + event.magnitude * 0.5) });
      }
    }

    waveEvents.sort((left, right) => left.progress - right.progress);
    for (let index = 0; index < quality.maxWaveShellsPerAnchor; index += 1) {
      const mesh = waveRefs.current[index];
      if (!mesh) continue;
      const assigned = waveEvents[index];
      if (!assigned) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(...assigned.position);
      const maxRadius = spreadRadius * (0.6 + assigned.magnitude * 0.9);
      // The same decelerating front and the same fade the sky's Battle Shockwave expands on (see
      // battleShockwave.ts), so one ship's death unfolds at one speed whether it is watched from
      // inside the system or from a Battle Beacon light years away.
      const front = battleShockwaveFront(assigned.progress);
      mesh.scale.setScalar(maxRadius * front.radius);
      (mesh.material as MeshBasicMaterial).opacity = Math.pow(1 - assigned.progress, SHOCKWAVE_FADE_EXPONENT) * WAVE_PEAK_OPACITY[window.tier];
    }

    if (glowBucket) {
      glowContributions.sort((left, right) => right.brightness - left.brightness);
      writeGlowBucket(glowBucket, glowContributions.slice(0, quality.maxGlowPointsPerAnchor), spreadRadius);
    }
  });

  return (
    <group position={anchor.scenePosition}>
      <mesh ref={ambientTint} scale={spreadRadius * 0.5}>
        <sphereGeometry args={[1, quality.sphereSegments, quality.sphereSegments]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      {Array.from({ length: quality.maxWaveShellsPerAnchor }, (_, index) => (
        <mesh key={index} ref={(mesh) => { waveRefs.current[index] = mesh; }} visible={false}>
          <sphereGeometry args={[1, quality.sphereSegments, quality.sphereSegments]} />
          <meshBasicMaterial color={color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {glowBucket && <primitive object={glowBucket.points} />}
    </group>
  );
}

type GlowBucket = { points: Points; positionAttribute: BufferAttribute; colorAttribute: BufferAttribute; baseColor: Color };

function createGlowBucket(capacity: number, color: string): GlowBucket {
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
  const colorAttribute = new BufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", colorAttribute);

  const material = new PointsMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    map: glowSpriteTexture(),
    sizeAttenuation: true,
    transparent: true,
    vertexColors: true,
  });
  material.toneMapped = false;

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 8;

  return { points, positionAttribute, colorAttribute, baseColor: new Color(color) };
}

function writeGlowBucket(bucket: GlowBucket, contributions: readonly GlowContribution[], spreadRadius: number): void {
  const material = bucket.points.material as PointsMaterial;
  material.size = spreadRadius * 0.16;
  const capacity = bucket.colorAttribute.count;
  const { r, g, b } = bucket.baseColor;

  for (let index = 0; index < capacity; index += 1) {
    const contribution = contributions[index];
    if (!contribution) {
      bucket.colorAttribute.setXYZ(index, 0, 0, 0);
      continue;
    }
    bucket.positionAttribute.setXYZ(index, ...contribution.position);
    bucket.colorAttribute.setXYZ(index, r * contribution.brightness, g * contribution.brightness, b * contribution.brightness);
  }

  bucket.positionAttribute.needsUpdate = true;
  bucket.colorAttribute.needsUpdate = true;
}

function disposeGlowBucket(bucket: GlowBucket): void {
  bucket.points.geometry.dispose();
  (bucket.points.material as PointsMaterial).dispose();
}

function sameWindow(left: BattleWindow | null, right: BattleWindow | null): boolean {
  return left === right || (left !== null && right !== null && left.systemId === right.systemId && left.startedAt === right.startedAt);
}

function mix32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Math.trunc(value) >>> 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}
