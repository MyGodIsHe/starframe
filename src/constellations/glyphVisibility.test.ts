import { describe, expect, it } from "vitest";
import {
  clearsFootprint,
  computeGlyphFootprint,
  GLYPH_SEPARATION_RADIANS,
  LEGIBILITY_FLOOR_RADIANS,
  selectVisibleConstellationIds,
} from "./glyphVisibility";

type System = { id: number; position: [number, number, number] };

const ORIGIN: [number, number, number] = [0, 0, 0];
const NONE = new Set<number>();

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

describe("Glyph Footprint", () => {
  it("centres on the mean direction of its Solar Systems and reaches the farthest of them", () => {
    const footprint = computeGlyphFootprint(1, [
      { id: 1, position: [10, -10, 0] },
      { id: 2, position: [10, 10, 0] },
    ], ORIGIN, NONE)!;

    expect(footprint.center[0]).toBeCloseTo(1);
    expect(footprint.center[1]).toBeCloseTo(0);
    expect(degrees(footprint.radius)).toBeCloseTo(45);
  });

  it("measures depth by the nearest member, so a constellation reaching towards the observer counts as near", () => {
    const footprint = computeGlyphFootprint(1, [
      { id: 1, position: [5, -5, 0] },
      { id: 2, position: [100, 100, 0] },
    ], ORIGIN, NONE)!;

    expect(footprint.nearestDistance).toBeCloseTo(Math.hypot(5, 5));
  });

  it("ignores excluded systems and gives up when fewer than two directions remain", () => {
    const systems: System[] = [
      { id: 1, position: [10, -10, 0] },
      { id: 2, position: [10, 10, 0] },
      { id: 3, position: [10, 0, 0] },
    ];

    expect(degrees(computeGlyphFootprint(1, systems, ORIGIN, new Set([1]))!.radius)).toBeCloseTo(22.5);
    expect(computeGlyphFootprint(1, systems, ORIGIN, new Set([1, 2]))).toBeNull();
  });

  it("has no cap when the observer stands inside the only other member", () => {
    expect(computeGlyphFootprint(1, [{ id: 1, position: [0, 0, 0] }, { id: 2, position: [10, 0, 0] }], ORIGIN, NONE)).toBeNull();
  });
});

describe("selectVisibleConstellationIds", () => {
  // Three equal constellations on the same line of sight, at increasing distance.
  const stacked = new Map<number, System[]>([
    [1, [{ id: 1, position: [10, -3, 0] }, { id: 2, position: [10, 3, 0] }]],
    [2, [{ id: 3, position: [20, -6, 0] }, { id: 4, position: [20, 6, 0] }]],
    [3, [{ id: 5, position: [30, -9, 0] }, { id: 6, position: [30, 9, 0] }]],
  ]);

  it("keeps the nearest of a stack and removes the ones behind it whole", () => {
    expect(selectVisibleConstellationIds(stacked, ORIGIN, NONE, NONE)).toEqual([1]);
  });

  it("prefers the nearer constellation no matter what order the map is built in", () => {
    const reversed = new Map([...stacked].reverse());

    expect(selectVisibleConstellationIds(reversed, ORIGIN, NONE, NONE)).toEqual([1]);
  });

  it("keeps constellations that sit far enough apart on the sky", () => {
    const spread = new Map<number, System[]>([
      [1, [{ id: 1, position: [10, -3, 0] }, { id: 2, position: [10, 3, 0] }]],
      [2, [{ id: 3, position: [-10, -3, 0] }, { id: 4, position: [-10, 3, 0] }]],
      [3, [{ id: 5, position: [0, -3, 10] }, { id: 6, position: [0, 3, 10] }]],
    ]);

    expect(selectVisibleConstellationIds(spread, ORIGIN, NONE, NONE)).toEqual([1, 2, 3]);
  });

  it("never returns an overlapping pair", () => {
    const ids = selectVisibleConstellationIds(stacked, ORIGIN, NONE, NONE);
    const footprints = ids.map((id) => computeGlyphFootprint(id, stacked.get(id)!, ORIGIN, NONE)!);

    for (let left = 0; left < footprints.length; left += 1) {
      for (let right = left + 1; right < footprints.length; right += 1) {
        expect(clearsFootprint(footprints[left], footprints[right])).toBe(true);
      }
    }
  });

  it("drops anything below the Legibility Floor before occlusion is even considered", () => {
    const tiny = new Map<number, System[]>([
      [1, [{ id: 1, position: [1_000, -1, 0] }, { id: 2, position: [1_000, 1, 0] }]],
    ]);

    expect(degrees(computeGlyphFootprint(1, tiny.get(1)!, ORIGIN, NONE)!.radius)).toBeLessThan(degrees(LEGIBILITY_FLOOR_RADIANS));
    expect(selectVisibleConstellationIds(tiny, ORIGIN, NONE, NONE)).toEqual([]);
  });

  it("leaves excluded constellations out entirely, so the home constellation claims no sky", () => {
    expect(selectVisibleConstellationIds(stacked, ORIGIN, new Set([1]), NONE)).toEqual([2]);
  });
});

describe("clearsFootprint", () => {
  it("requires both drawn extents plus the separation gap", () => {
    const left = { constellationId: 1, center: [1, 0, 0] as [number, number, number], radius: 0.1, nearestDistance: 1 };
    const right = { constellationId: 2, center: [Math.cos(0.4), Math.sin(0.4), 0] as [number, number, number], radius: 0.1, nearestDistance: 2 };

    // 0.4 rad apart, each drawn out to 0.135 rad: 0.27 of extent plus the gap still fits.
    expect(0.4).toBeGreaterThan(0.27 + GLYPH_SEPARATION_RADIANS);
    expect(clearsFootprint(left, right)).toBe(true);

    expect(clearsFootprint(left, { ...right, radius: 0.25 })).toBe(false);
  });
});
