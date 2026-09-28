import { describe, expect, it } from "vitest";
import { TRAVEL_DURATION } from "./travelCoordinates";
import {
  findActiveBattles,
  getBattleState,
  getBattleWindow,
  regionHotspotWeight,
  selectBattleAnchors,
  type BattleWindow,
} from "./battleSimulation";

function findHotRegionId(): number {
  let bestId = 1;
  let bestWeight = -1;
  for (let id = 1; id <= 5_000; id += 1) {
    const weight = regionHotspotWeight(id);
    if (weight > bestWeight) {
      bestWeight = weight;
      bestId = id;
    }
  }
  return bestId;
}

function findColdRegionId(): number {
  let bestId = 1;
  let bestWeight = Number.POSITIVE_INFINITY;
  for (let id = 1; id <= 5_000; id += 1) {
    const weight = regionHotspotWeight(id);
    if (weight < bestWeight) {
      bestWeight = weight;
      bestId = id;
    }
  }
  return bestId;
}

function collectWindows(regionId: number, systemCount: number, epochCount: number): BattleWindow[] {
  const windows: BattleWindow[] = [];
  const epochDuration = 1_200_000;
  for (let systemId = 1; systemId <= systemCount; systemId += 1) {
    for (let epochIndex = 0; epochIndex < epochCount; epochIndex += 1) {
      const window = getBattleWindow(systemId, regionId, epochIndex * epochDuration + 1);
      if (window) windows.push(window);
    }
  }
  return windows;
}

describe("battle simulation", () => {
  it("is a pure function: identical inputs always produce identical windows", () => {
    for (let systemId = 1; systemId <= 200; systemId += 1) {
      const first = getBattleWindow(systemId, 42, 123_456_789);
      const second = getBattleWindow(systemId, 42, 123_456_789);
      expect(second).toEqual(first);
    }
  });

  it("skews regional hotspot weight so most regions are near-zero and a minority are violent", () => {
    const weights = Array.from({ length: 2_000 }, (_, id) => regionHotspotWeight(id + 1));
    const average = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
    const highCount = weights.filter((weight) => weight > 0.5).length;

    for (const weight of weights) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
    expect(average).toBeGreaterThan(0.1);
    expect(average).toBeLessThan(0.4);
    expect(highCount / weights.length).toBeLessThan(0.3);
  });

  it("gives systems in a hot region far more battle windows than systems in a cold region", () => {
    const hotRegionId = findHotRegionId();
    const coldRegionId = findColdRegionId();

    const hotWindows = collectWindows(hotRegionId, 40, 400);
    const coldWindows = collectWindows(coldRegionId, 40, 400);

    expect(hotWindows.length).toBeGreaterThan(coldWindows.length);
    expect(hotWindows.length).toBeGreaterThan(0);
  });

  it("jitters battles per-system within a hot region rather than firing every system at once", () => {
    const hotRegionId = findHotRegionId();
    const epochIndex = 10;
    const epochStart = epochIndex * 1_200_000 + 1;

    const results = Array.from({ length: 500 }, (_, index) => getBattleWindow(index + 1, hotRegionId, epochStart));
    const withWindow = results.filter((window): window is BattleWindow => window !== null);

    expect(withWindow.length).toBeGreaterThan(0);
    expect(withWindow.length).toBeLessThan(results.length);
  });

  it("keeps tier durations long enough to reach by travelling through several gates", () => {
    const hotRegionId = findHotRegionId();
    const windows = collectWindows(hotRegionId, 60, 1_500);
    const byTier = { 1: [] as BattleWindow[], 2: [] as BattleWindow[], 3: [] as BattleWindow[] };
    for (const window of windows) byTier[window.tier].push(window);

    expect(byTier[1].length + byTier[2].length + byTier[3].length).toBe(windows.length);
    expect(byTier[1].length).toBeGreaterThan(0);
    expect(byTier[2].length).toBeGreaterThan(0);
    expect(byTier[3].length).toBeGreaterThan(0);

    for (const window of byTier[1]) {
      const total = window.riseDuration + window.plateauDuration + window.decayDuration;
      expect(total).toBeGreaterThanOrEqual(35_000);
      expect(total).toBeLessThanOrEqual(55_000);
    }
    for (const window of byTier[2]) {
      const total = window.riseDuration + window.plateauDuration + window.decayDuration;
      expect(total).toBeGreaterThan(TRAVEL_DURATION * 10);
    }
    for (const window of byTier[3]) {
      const total = window.riseDuration + window.plateauDuration + window.decayDuration;
      expect(total).toBeGreaterThan(TRAVEL_DURATION * 40);
    }

    // Rough proportions: skirmishes are the most common, fleet battles the rarest.
    expect(byTier[1].length).toBeGreaterThan(byTier[2].length);
    expect(byTier[2].length).toBeGreaterThan(byTier[3].length);
  });

  it("shapes intensity as a continuous rise, plateau, and decay", () => {
    const window: BattleWindow = {
      systemId: 1,
      seed: 7,
      startedAt: 1_000,
      tier: 2,
      riseDuration: 20_000,
      plateauDuration: 100_000,
      decayDuration: 35_000,
      anchorCount: 2,
    };

    expect(getBattleState(window, 500)).toBeNull();
    expect(getBattleState(window, window.startedAt + 200_000)).toBeNull();

    let previousIntensity = -1;
    for (let elapsed = 0; elapsed < window.riseDuration; elapsed += 2_000) {
      const state = getBattleState(window, window.startedAt + elapsed);
      expect(state?.phase).toBe("rising");
      expect(state!.intensity).toBeGreaterThanOrEqual(previousIntensity);
      previousIntensity = state!.intensity;
    }

    const midPlateau = getBattleState(window, window.startedAt + window.riseDuration + window.plateauDuration / 2);
    expect(midPlateau).toEqual({ window, phase: "raging", intensity: 1 });

    previousIntensity = 2;
    for (let decayElapsed = 0; decayElapsed <= window.decayDuration; decayElapsed += 2_000) {
      const state = getBattleState(window, window.startedAt + window.riseDuration + window.plateauDuration + decayElapsed);
      expect(state?.phase).toBe("decaying");
      expect(state!.intensity).toBeLessThanOrEqual(previousIntensity);
      previousIntensity = state!.intensity;
    }
  });

  it("selects distinct anchors bounded by the window's anchor count and available gates/planets", () => {
    const window: BattleWindow = {
      systemId: 1,
      seed: 99,
      startedAt: 0,
      tier: 3,
      riseDuration: 35_000,
      plateauDuration: 300_000,
      decayDuration: 90_000,
      anchorCount: 3,
    };

    const anchors = selectBattleAnchors(window, [1, 2, 3, 4], [10, 11]);
    expect(anchors).toHaveLength(3);
    const keys = anchors.map((anchor) => `${anchor.kind}:${anchor.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(selectBattleAnchors(window, [1, 2, 3, 4], [10, 11])).toEqual(anchors);

    expect(selectBattleAnchors(window, [], [])).toEqual([]);
    expect(selectBattleAnchors(window, [1], [])).toHaveLength(1);
  });

  it("keeps the number of simultaneously active battles bounded relative to the whole universe", () => {
    const systems = Array.from({ length: 8_089 }, (_, index) => ({ id: index + 1, regionId: (index % 114) + 1 }));
    const active = findActiveBattles(systems, 987_654_321);

    expect(active.length).toBeLessThan(500);
  });

  it("keeps at least one battle active everywhere, at every point in the epoch cycle, so somewhere is always fighting", () => {
    const systems = Array.from({ length: 8_089 }, (_, index) => ({ id: index + 1, regionId: (index % 114) + 1 }));
    const epochDuration = 1_200_000;

    for (let epochIndex = 0; epochIndex < 3; epochIndex += 1) {
      for (let offset = 0; offset < epochDuration; offset += 60_000) {
        const active = findActiveBattles(systems, epochIndex * epochDuration + offset);
        expect(active.length).toBeGreaterThan(0);
      }
    }
  });
});
