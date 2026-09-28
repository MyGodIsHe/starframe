import { describe, expect, it } from "vitest";
import { getBattleWindow, regionHotspotWeight } from "./battleSimulation";
import { projectBattleBeacons, type BattleBeaconSystem } from "./battleBeaconProjection";

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

function findRagingWindowTime(systemId: number, regionId: number): number {
  for (let epochIndex = 0; epochIndex < 5_000; epochIndex += 1) {
    const probeTime = epochIndex * 1_200_000 + 1;
    const window = getBattleWindow(systemId, regionId, probeTime);
    if (!window) continue;
    const ragingTime = window.startedAt + window.riseDuration + window.plateauDuration / 2;
    if (getBattleWindow(systemId, regionId, ragingTime)?.startedAt === window.startedAt) return ragingTime;
  }
  throw new Error("no raging battle window found in sampled range");
}

describe("projectBattleBeacons", () => {
  const hotRegionId = findHotRegionId();
  const systems: BattleBeaconSystem[] = [
    { id: 1, regionId: hotRegionId, position: [0, 0, 0] },
    { id: 2, regionId: hotRegionId, position: [9_460_000_000_000_000, 0, 0] },
    { id: 3, regionId: hotRegionId, position: [0, 9_460_000_000_000_000, 0] },
  ];

  it("emits a beacon only for systems currently inside a Battle Window", () => {
    const time = findRagingWindowTime(2, hotRegionId);
    const beacons = projectBattleBeacons(systems, systems[0].position, time);

    expect(beacons.every((beacon) => beacon.systemId === 2)).toBe(true);
  });

  it("carries the observer's existing Distance Cue brightness/opacity rather than a second distance metric", () => {
    const time = findRagingWindowTime(2, hotRegionId);
    const beacons = projectBattleBeacons(systems, systems[0].position, time);
    const beacon = beacons.find((entry) => entry.systemId === 2);

    expect(beacon).toBeDefined();
    expect(beacon!.brightness).toBeGreaterThan(0);
    expect(beacon!.opacity).toBeGreaterThan(0);
    expect(Math.hypot(...beacon!.direction)).toBeCloseTo(1);
    expect(beacon!.intensity).toBeCloseTo(1);
    expect(beacon!.phase).toBe("raging");
  });

  it("returns nothing when no system in view is mid-battle", () => {
    const quietTime = 0;
    const activeAtQuietTime = [1, 2, 3].some((systemId) => getBattleWindow(systemId, hotRegionId, quietTime) !== null);
    if (!activeAtQuietTime) {
      expect(projectBattleBeacons(systems, systems[0].position, quietTime)).toEqual([]);
    }
  });
});
