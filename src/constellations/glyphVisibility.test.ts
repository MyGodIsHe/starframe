import { describe, expect, it } from "vitest";
import {
  boundsOf,
  clearsFootprint,
  computeGlyphFootprint,
  GLYPH_SEPARATION_RADIANS,
  LEGIBILITY_FLOOR_RADIANS,
  selectVisibleConstellationIds,
  type GlyphBounds,
} from "./glyphVisibility";
import type { Vector3 } from "../universe/generateUniverse";

const ORIGIN: Vector3 = [0, 0, 0];
const NONE = new Set<number>();

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function ballAt(constellationId: number, centre: Vector3, radius: number): GlyphBounds {
  return { constellationId, centre, radius };
}

describe("boundsOf", () => {
  it("encloses every point it is given, artwork as well as stars", () => {
    const bounds = boundsOf(1, [[10, 0, 0], [10, 4, 0], [10, -4, 0], [14, 0, 3]])!;

    for (const point of [[10, 0, 0], [10, 4, 0], [10, -4, 0], [14, 0, 3]] as Vector3[]) {
      const offset = Math.hypot(point[0] - bounds.centre[0], point[1] - bounds.centre[1], point[2] - bounds.centre[2]);
      expect(offset).toBeLessThanOrEqual(bounds.radius + 1e-9);
    }
  });

  it("has nothing to bound when given nothing", () => {
    expect(boundsOf(1, [])).toBeNull();
  });
});

describe("Glyph Footprint", () => {
  it("covers the whole sphere the glyph occupies, not just its stars", () => {
    const footprint = computeGlyphFootprint(ballAt(1, [100, 0, 0], 10), ORIGIN)!;

    expect(footprint.center[0]).toBeCloseTo(1);
    expect(degrees(footprint.radius)).toBeCloseTo(degrees(Math.asin(0.1)));
  });

  it("shrinks as the observer moves away and grows as they close in", () => {
    const near = computeGlyphFootprint(ballAt(1, [50, 0, 0], 10), ORIGIN)!;
    const far = computeGlyphFootprint(ballAt(1, [500, 0, 0], 10), ORIGIN)!;

    expect(near.radius).toBeGreaterThan(far.radius);
    expect(near.nearestDistance).toBeLessThan(far.nearestDistance);
  });

  it("gives no footprint to a glyph the observer is standing inside", () => {
    expect(computeGlyphFootprint(ballAt(1, [5, 0, 0], 10), ORIGIN)).toBeNull();
    expect(computeGlyphFootprint(ballAt(1, [0, 0, 0], 1), ORIGIN)).toBeNull();
  });
});

describe("selectVisibleConstellationIds", () => {
  // Three equal glyphs on the same line of sight, at increasing distance.
  const stacked = new Map<number, GlyphBounds>([
    [1, ballAt(1, [50, 0, 0], 10)],
    [2, ballAt(2, [100, 0, 0], 20)],
    [3, ballAt(3, [150, 0, 0], 30)],
  ]);

  it("keeps the nearest of a stack and removes the ones behind it whole", () => {
    expect(selectVisibleConstellationIds(stacked, ORIGIN, NONE)).toEqual([1]);
  });

  it("prefers the nearer glyph no matter what order the map was built in", () => {
    expect(selectVisibleConstellationIds(new Map([...stacked].reverse()), ORIGIN, NONE)).toEqual([1]);
  });

  it("keeps glyphs that sit far enough apart on the sky", () => {
    const spread = new Map<number, GlyphBounds>([
      [1, ballAt(1, [50, 0, 0], 10)],
      [2, ballAt(2, [-50, 0, 0], 10)],
      [3, ballAt(3, [0, 0, 50], 10)],
    ]);

    expect(selectVisibleConstellationIds(spread, ORIGIN, NONE)).toEqual([1, 2, 3]);
  });

  it("never returns an overlapping pair", () => {
    const ids = selectVisibleConstellationIds(stacked, ORIGIN, NONE);
    const footprints = ids.map((id) => computeGlyphFootprint(stacked.get(id)!, ORIGIN)!);

    for (let left = 0; left < footprints.length; left += 1) {
      for (let right = left + 1; right < footprints.length; right += 1) {
        expect(clearsFootprint(footprints[left], footprints[right])).toBe(true);
      }
    }
  });

  it("drops anything below the Legibility Floor before occlusion is even considered", () => {
    const tiny = new Map<number, GlyphBounds>([[1, ballAt(1, [10_000, 0, 0], 10)]]);

    expect(computeGlyphFootprint(tiny.get(1)!, ORIGIN)!.radius).toBeLessThan(LEGIBILITY_FLOOR_RADIANS);
    expect(selectVisibleConstellationIds(tiny, ORIGIN, NONE)).toEqual([]);
  });

  it("leaves excluded constellations out entirely, so the home constellation claims no sky", () => {
    expect(selectVisibleConstellationIds(stacked, ORIGIN, new Set([1]))).toEqual([2]);
  });
});

describe("clearsFootprint", () => {
  it("requires both radii plus the separation gap", () => {
    const left = { constellationId: 1, center: [1, 0, 0] as Vector3, radius: 0.1, nearestDistance: 1 };
    const right = { constellationId: 2, center: [Math.cos(0.4), Math.sin(0.4), 0] as Vector3, radius: 0.1, nearestDistance: 2 };

    expect(0.4).toBeGreaterThan(0.2 + GLYPH_SEPARATION_RADIANS);
    expect(clearsFootprint(left, right)).toBe(true);
    expect(clearsFootprint(left, { ...right, radius: 0.32 })).toBe(false);
  });
});
