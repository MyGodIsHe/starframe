import { getBattleState, type BattleTier, type BattleWindow } from "./battleSimulation";

export type ExplosionEvent = {
  tickIndex: number;
  startedAt: number; // ms, wall-clock
  magnitude: number; // 0..1, stands in for "how big a ship" — scales wave/scar size and duration
};

export type ExplosionPhase = "flash" | "wave" | "scar";

const TICK_DURATION_MS = 150;
const FLASH_MS = 140;
const WAVE_MIN_MS = 700;
const WAVE_MAX_MS = 2_200;
const SCAR_MIN_MS = 10_000;
const SCAR_MAX_MS = 28_000;
const MAX_LIFECYCLE_MS = FLASH_MS + WAVE_MAX_MS + SCAR_MAX_MS;

// Events per minute at envelope intensity 1.0 (a window's plateau). Scaled down through rise/decay
// by the window's own getBattleState(...).intensity, so the explosion rate ramps with the fight
// itself rather than switching on/off abruptly.
const TIER_PEAK_RATE_PER_MINUTE: Record<BattleTier, number> = { 1: 5, 2: 22, 3: 100 };

const EVENT_SALT = 0x2f0a2cc9;
const MAGNITUDE_SALT = 0x0392c22e;
const OFFSET_AZIMUTH_SALT = 0x27220a95;
const OFFSET_ELEVATION_SALT = 0x1a1e8541;
const OFFSET_RADIUS_SALT = 0x6f4c2b17;

// Every currently-alive explosion event (flash, wave, or scar phase) for one independent stream.
// `streamSalt` lets the same window drive independent streams — one per in-system anchor, plus a
// single shared one for the sky beacon — so anchors don't flash in lockstep, while whatever the
// sky beacon shows is drawn from the same events a player would find on arrival.
export function eventsAliveAt(window: BattleWindow, time: number, streamSalt: number): ExplosionEvent[] {
  const events: ExplosionEvent[] = [];
  const firstTick = Math.floor((time - MAX_LIFECYCLE_MS) / TICK_DURATION_MS);
  const lastTick = Math.floor(time / TICK_DURATION_MS);

  for (let tickIndex = firstTick; tickIndex <= lastTick; tickIndex += 1) {
    const tickTime = tickIndex * TICK_DURATION_MS;
    if (tickTime < window.startedAt) continue;

    const state = getBattleState(window, tickTime);
    if (!state) continue;

    const rate = TIER_PEAK_RATE_PER_MINUTE[window.tier] * state.intensity;
    const perTickChance = Math.min(1, (rate / 60_000) * TICK_DURATION_MS);
    const roll = hash32(window.seed, streamSalt, tickIndex, EVENT_SALT) / 0x1_0000_0000;
    if (roll >= perTickChance) continue;

    const magnitude = hash32(window.seed, streamSalt, tickIndex, MAGNITUDE_SALT) / 0x1_0000_0000;
    if (time - tickTime >= lifecycleDuration(magnitude)) continue;

    events.push({ tickIndex, startedAt: tickTime, magnitude });
  }

  return events;
}

// Pure per-event phase lookup: flash (bright core) -> wave (expanding shell) -> scar (fading
// debris) -> null once its lifecycle (scaled by magnitude) has fully elapsed.
export function explosionPhaseAt(event: ExplosionEvent, time: number): { phase: ExplosionPhase; progress: number } | null {
  const elapsed = time - event.startedAt;
  if (elapsed < 0) return null;

  if (elapsed < FLASH_MS) return { phase: "flash", progress: elapsed / FLASH_MS };

  const wave = waveMs(event.magnitude);
  if (elapsed < FLASH_MS + wave) return { phase: "wave", progress: (elapsed - FLASH_MS) / wave };

  const scar = scarMs(event.magnitude);
  if (elapsed < FLASH_MS + wave + scar) return { phase: "scar", progress: (elapsed - FLASH_MS - wave) / scar };

  return null;
}

// Deterministic jittered offset for where, around an anchor, a given event's ship died — distinct
// events land at distinct points rather than all exploding on top of each other.
export function eventOffset(window: BattleWindow, event: ExplosionEvent, streamSalt: number, spreadRadius: number): [number, number, number] {
  const azimuth = (hash32(window.seed, streamSalt, event.tickIndex, OFFSET_AZIMUTH_SALT) / 0x1_0000_0000) * Math.PI * 2;
  const elevation = ((hash32(window.seed, streamSalt, event.tickIndex, OFFSET_ELEVATION_SALT) / 0x1_0000_0000) - 0.5) * Math.PI * 0.6;
  const radius = spreadRadius * (0.25 + (hash32(window.seed, streamSalt, event.tickIndex, OFFSET_RADIUS_SALT) / 0x1_0000_0000) * 0.75);
  const horizontal = Math.cos(elevation) * radius;

  return [Math.cos(azimuth) * horizontal, Math.sin(elevation) * radius, Math.sin(azimuth) * horizontal];
}

function waveMs(magnitude: number): number {
  return lerp(WAVE_MIN_MS, WAVE_MAX_MS, magnitude);
}

function scarMs(magnitude: number): number {
  return lerp(SCAR_MIN_MS, SCAR_MAX_MS, magnitude);
}

function lifecycleDuration(magnitude: number): number {
  return FLASH_MS + waveMs(magnitude) + scarMs(magnitude);
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
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
