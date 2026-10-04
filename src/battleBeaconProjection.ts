import { getBattleState, getBattleWindow, type BattlePhase, type BattleTier, type BattleWindow } from "./battleSimulation";
import { projectInterstellarProjection, type InterstellarSystem } from "./interstellarProjection";
import type { Vector3 } from "./universe/generateUniverse";

export type BattleBeaconSystem = InterstellarSystem & { regionId: number };

export type BattleBeaconMarker = {
  systemId: number;
  direction: Vector3;
  // The same physical observer-to-system distance the Distance Cue above is computed from, carried
  // through rather than re-measured, so that what scales a Battle Shockwave's size (see
  // battleShockwave.ts) is this one metre count and not a second notion of distance.
  distance: number;
  window: BattleWindow;
  tier: BattleTier;
  phase: BattlePhase;
  intensity: number;
  brightness: number;
  opacity: number;
};

// A system's Battle Window itself (whether/how it is currently fighting) only ever changes on
// an epoch boundary, so scanning every system for one is safe to throttle. Splitting it out from
// projectBattleBeaconCandidates lets the observer-position projection below run every frame
// (cheap: only as many candidates as are actually mid-battle) instead of being throttled with it,
// which is what let a beacon's sky direction lag and jump during travel instead of gliding the
// way the Celestial Map's own stars and constellation glyphs do.
export function findBattleBeaconCandidates(systems: readonly BattleBeaconSystem[], time: number): BattleBeaconCandidate[] {
  const candidates: BattleBeaconCandidate[] = [];
  for (const system of systems) {
    const window = getBattleWindow(system.id, system.regionId, time);
    if (window) candidates.push({ system, window });
  }
  return candidates;
}

export type BattleBeaconCandidate = { system: BattleBeaconSystem; window: BattleWindow };

// Composes with projectInterstellarProjection's Distance Cue (brightness/opacity) rather
// than introducing a second distance metric: a beacon multiplies its warm flicker on top
// of the same physical-distance falloff every Celestial Map star already uses.
export function projectBattleBeaconCandidates(candidates: readonly BattleBeaconCandidate[], observerPosition: Vector3, time: number): BattleBeaconMarker[] {
  const active = candidates.flatMap((candidate) => {
    const state = getBattleState(candidate.window, time);
    return state ? [{ system: candidate.system, window: candidate.window, state }] : [];
  });
  if (active.length === 0) return [];

  const activeBySystemId = new Map(active.map((entry) => [entry.system.id, entry]));
  const markers = projectInterstellarProjection(active.map((entry) => entry.system), observerPosition);

  const beacons = markers.flatMap((marker): BattleBeaconMarker[] => {
    const entry = activeBySystemId.get(marker.id);
    if (!entry) return [];

    return [{
      systemId: marker.id,
      direction: marker.direction,
      distance: marker.distance,
      window: entry.window,
      tier: entry.window.tier,
      phase: entry.state.phase,
      intensity: entry.state.intensity,
      brightness: marker.brightness,
      opacity: marker.opacity,
    }];
  });

  // Nearer/brighter battles sort first, so a renderer with a fixed beacon budget drops the
  // faintest, most distant ones first rather than an arbitrary subset picked by system id.
  return beacons.sort((left, right) => right.brightness * right.opacity - left.brightness * left.opacity);
}

export function projectBattleBeacons(systems: readonly BattleBeaconSystem[], observerPosition: Vector3, time: number): BattleBeaconMarker[] {
  return projectBattleBeaconCandidates(findBattleBeaconCandidates(systems, time), observerPosition, time);
}
