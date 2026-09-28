export type BattleTier = 1 | 2 | 3;
export type BattlePhase = "rising" | "raging" | "decaying";

export type BattleWindow = {
  systemId: number;
  seed: number;
  startedAt: number;
  tier: BattleTier;
  riseDuration: number;
  plateauDuration: number;
  decayDuration: number;
  anchorCount: number;
};

export type BattleState = {
  window: BattleWindow;
  phase: BattlePhase;
  intensity: number;
};

export type BattleAnchor = { kind: "gate" | "planet"; id: number };

const EPOCH_DURATION_MS = 1_200_000;
// Chance a system's epoch hosts a battle at maximum regional Conflict Hotspot weight.
// Combined with the cubic hotspot skew below, this keeps on the order of a hundred
// battles active across New Eden's ~8000 systems at any moment, so somewhere is always
// fighting and a nearby one is easy to stumble into, while quiet regions stay comparatively rare.
const BASE_EPOCH_CHANCE = 0.35;
const HOTSPOT_FLOOR = 0.15;

const HOTSPOT_SALT = 0x9e3779b1;
const EPOCH_SALT = 0x85ebca77;
const TIER_SALT = 0xc2b2ae3d;
const START_SALT = 0x27d4eb2f;
const JITTER_SALT = 0x165667b1;
const ANCHOR_SALT = 0x1b873593;
const PHASE_SALT = 0x68e31da4;

type TierEnvelope = {
  riseRange: [number, number];
  plateauRange: [number, number];
  decayRange: [number, number];
  anchorRange: [number, number];
};

const TIER_ENVELOPES: Record<BattleTier, TierEnvelope> = {
  1: { riseRange: [8_000, 8_000], plateauRange: [15_000, 35_000], decayRange: [12_000, 12_000], anchorRange: [1, 1] },
  2: { riseRange: [20_000, 20_000], plateauRange: [60_000, 140_000], decayRange: [35_000, 35_000], anchorRange: [1, 2] },
  3: { riseRange: [35_000, 35_000], plateauRange: [240_000, 480_000], decayRange: [90_000, 90_000], anchorRange: [1, 3] },
};

// Real wall-clock milliseconds, deliberately not an R3F clock's elapsed-since-mount time:
// the same battle must read identically whether checked from the Celestial Map of a
// system never visited, or from inside the system itself after several gate jumps.
export function battleClockNow(snapshotTime: number | null): number {
  return snapshotTime !== null ? snapshotTime * 1_000 : Date.now();
}

export function regionHotspotWeight(regionId: number): number {
  const unit = hash32(regionId, HOTSPOT_SALT) / 0x1_0000_0000;
  return unit ** 3;
}

export function getBattleWindow(systemId: number, regionId: number, time: number): BattleWindow | null {
  if (!Number.isFinite(time)) return null;

  // Each system's epoch grid is shifted by its own stable phase so battle starts spread
  // evenly across time instead of every system rolling the same global 20-minute tick in
  // lockstep, which would make the whole galaxy pulse between "many battles" and "none".
  const phaseShift = (hash32(systemId, PHASE_SALT) / 0x1_0000_0000) * EPOCH_DURATION_MS;
  const epochIndex = Math.floor((time + phaseShift) / EPOCH_DURATION_MS);
  const hostChance = BASE_EPOCH_CHANCE * (HOTSPOT_FLOOR + (1 - HOTSPOT_FLOOR) * regionHotspotWeight(regionId));
  const hostRoll = hash32(systemId, epochIndex, EPOCH_SALT) / 0x1_0000_0000;
  if (hostRoll >= hostChance) return null;

  const tierRoll = hash32(systemId, epochIndex, TIER_SALT) / 0x1_0000_0000;
  const tier: BattleTier = tierRoll < 0.6 ? 1 : tierRoll < 0.9 ? 2 : 3;
  const envelope = TIER_ENVELOPES[tier];

  const epochStart = epochIndex * EPOCH_DURATION_MS - phaseShift;
  const startJitter = (hash32(systemId, epochIndex, START_SALT) / 0x1_0000_0000) * EPOCH_DURATION_MS * 0.3;
  const startedAt = epochStart + startJitter;

  const seed = hash32(systemId, epochIndex, JITTER_SALT);
  const riseDuration = rangeValue(envelope.riseRange, hash32(seed, 1));
  const plateauDuration = rangeValue(envelope.plateauRange, hash32(seed, 2));
  const decayDuration = rangeValue(envelope.decayRange, hash32(seed, 3));
  const anchorCount = Math.round(rangeValue(envelope.anchorRange, hash32(seed, 4)));

  return { systemId, seed, startedAt, tier, riseDuration, plateauDuration, decayDuration, anchorCount };
}

export function getBattleState(window: BattleWindow, time: number): BattleState | null {
  const elapsed = time - window.startedAt;
  const total = window.riseDuration + window.plateauDuration + window.decayDuration;
  if (elapsed < 0 || elapsed > total) return null;

  if (elapsed < window.riseDuration) {
    return { window, phase: "rising", intensity: smoothstep(elapsed / window.riseDuration) };
  }
  if (elapsed < window.riseDuration + window.plateauDuration) {
    return { window, phase: "raging", intensity: 1 };
  }

  const decayElapsed = elapsed - window.riseDuration - window.plateauDuration;
  return { window, phase: "decaying", intensity: 1 - smoothstep(decayElapsed / window.decayDuration) };
}

export function getBattleAtSystem(systemId: number, regionId: number, time: number): BattleState | null {
  const window = getBattleWindow(systemId, regionId, time);
  return window ? getBattleState(window, time) : null;
}

export function findActiveBattles(systems: readonly { id: number; regionId: number }[], time: number): BattleState[] {
  const active: BattleState[] = [];
  for (const system of systems) {
    const state = getBattleAtSystem(system.id, system.regionId, time);
    if (state) active.push(state);
  }
  return active;
}

export function selectBattleAnchors(window: BattleWindow, gateIds: readonly number[], planetIds: readonly number[]): BattleAnchor[] {
  const candidates: BattleAnchor[] = [
    ...gateIds.map((id): BattleAnchor => ({ kind: "gate", id })),
    ...planetIds.map((id): BattleAnchor => ({ kind: "planet", id })),
  ];
  if (candidates.length === 0) return [];

  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = hash32(window.seed, ANCHOR_SALT, index) % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.slice(0, Math.min(window.anchorCount, candidates.length));
}

function rangeValue([min, max]: [number, number], hashValue: number): number {
  const unit = (hashValue >>> 0) / 0x1_0000_0000;
  return min + (max - min) * unit;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function hash32(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= Math.trunc(value) >>> 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2545f491);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
