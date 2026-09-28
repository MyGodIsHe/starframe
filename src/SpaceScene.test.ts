import { describe, expect, it } from "vitest";
import { MINIMUM_MAP_BRIGHTNESS } from "./interstellarProjection";
import { calculateZoomBounds, DECORATIVE_STAR_MAX_OPACITY, dampCameraState, markerScale, orbitCameraPosition, resolveMarkerOverlapByMoving, resolveMarkerOverlapByShrinking } from "./SpaceScene";

function ellipseOrbit(semiMajorAxis: number): { kind: "sde-ellipse"; semiMajorAxis: number; semiMinorAxis: number; sceneNormal: [number, number, number] } {
  return { kind: "sde-ellipse", semiMajorAxis, semiMinorAxis: semiMajorAxis, sceneNormal: [0, -1, 0] };
}

describe("dampCameraState", () => {
  const initial = { azimuth: 0, elevation: 0, distance: 12 };
  const target = { azimuth: 1, elevation: 0.5, distance: 6 };

  it("moves toward the target without snapping or overshooting", () => {
    const next = dampCameraState(initial, target, 1 / 60);

    expect(next.azimuth).toBeGreaterThan(initial.azimuth);
    expect(next.azimuth).toBeLessThan(target.azimuth);
    expect(next.elevation).toBeGreaterThan(initial.elevation);
    expect(next.elevation).toBeLessThan(target.elevation);
    expect(next.distance).toBeLessThan(initial.distance);
    expect(next.distance).toBeGreaterThan(target.distance);
  });

  it("produces the same result for equal elapsed time at different frame rates", () => {
    const oneFrame = dampCameraState(initial, target, 0.1);
    let manyFrames = initial;

    for (let frame = 0; frame < 10; frame += 1) {
      manyFrames = dampCameraState(manyFrames, target, 0.01);
    }

    expect(manyFrames.azimuth).toBeCloseTo(oneFrame.azimuth, 10);
    expect(manyFrames.elevation).toBeCloseTo(oneFrame.elevation, 10);
    expect(manyFrames.distance).toBeCloseTo(oneFrame.distance, 10);
  });
});

describe("orbitCameraPosition", () => {
  it("places the camera at the requested distance for the supplied orbit angles", () => {
    const position = orbitCameraPosition({ azimuth: Math.PI / 2, elevation: Math.PI / 6, distance: 12 });

    expect(position.x).toBeCloseTo(10.3923, 4);
    expect(position.y).toBeCloseTo(6, 4);
    expect(position.z).toBeCloseTo(0, 4);
    expect(position.length()).toBeCloseTo(12, 8);
  });

  it("preserves the requested distance at the orbit origin", () => {
    const position = orbitCameraPosition({ azimuth: 0, elevation: 0, distance: 6 });

    expect(position.toArray()).toEqual([0, 0, 6]);
    expect(position.length()).toBe(6);
  });

  it("scales a marker with camera distance while keeping its schematic size", () => {
    expect(markerScale(6, 8)).toBeCloseTo(0.08);
    expect(markerScale(12, 8)).toBeCloseTo(0.16);
    expect(markerScale(18, 8)).toBeCloseTo(0.24);
  });
});

describe("resolveMarkerOverlapByMoving", () => {
  it("leaves circles untouched when they don't overlap", () => {
    const circles = [{ id: 1, x: 0, y: 0, radius: 10 }, { id: 2, x: 200, y: 0, radius: 10 }];

    const resolved = resolveMarkerOverlapByMoving(circles);

    expect(resolved.get(1)).toEqual({ x: 0, y: 0 });
    expect(resolved.get(2)).toEqual({ x: 200, y: 0 });
  });

  it("pushes two overlapping circles apart until they just clear each other", () => {
    const circles = [{ id: 1, x: -2, y: 0, radius: 10 }, { id: 2, x: 2, y: 0, radius: 10 }];

    const resolved = resolveMarkerOverlapByMoving(circles, { gap: 4 });
    const a = resolved.get(1)!;
    const b = resolved.get(2)!;

    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(24, 5);
    expect(a.y).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(0);
  });

  it("separates a fully coincident cluster of three without producing NaNs", () => {
    const circles = [{ id: 1, x: 5, y: 5, radius: 10 }, { id: 2, x: 5, y: 5, radius: 10 }, { id: 3, x: 5, y: 5, radius: 10 }];

    const resolved = resolveMarkerOverlapByMoving(circles);
    const positions = [...resolved.values()];

    for (const position of positions) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(Math.hypot(positions[j].x - positions[i].x, positions[j].y - positions[i].y)).toBeGreaterThan(19);
      }
    }
  });
});

describe("resolveMarkerOverlapByShrinking", () => {
  it("leaves circles at full size when they don't overlap", () => {
    const circles = [{ id: 1, x: 0, y: 0, radius: 10 }, { id: 2, x: 200, y: 0, radius: 10 }];

    const resolved = resolveMarkerOverlapByShrinking(circles);

    expect(resolved.get(1)).toBe(10);
    expect(resolved.get(2)).toBe(10);
  });

  it("shrinks two overlapping circles until they just clear each other", () => {
    const circles = [{ id: 1, x: -5, y: 0, radius: 10 }, { id: 2, x: 5, y: 0, radius: 10 }];

    const resolved = resolveMarkerOverlapByShrinking(circles, { gap: 0 });

    expect(resolved.get(1)! + resolved.get(2)!).toBeCloseTo(10, 5);
  });

  it("never shrinks a marker below its size floor even if overlap remains", () => {
    const circles = [{ id: 1, x: 0, y: 0, radius: 10 }, { id: 2, x: 0.1, y: 0, radius: 10 }];

    const resolved = resolveMarkerOverlapByShrinking(circles, { minRadiusRatio: 0.4 });

    expect(resolved.get(1)).toBeCloseTo(4, 5);
    expect(resolved.get(2)).toBeCloseTo(4, 5);
  });
});

describe("DECORATIVE_STAR_MAX_OPACITY", () => {
  it("stays below Minimum Map Brightness so every real Solar System remains distinguishable", () => {
    expect(DECORATIVE_STAR_MAX_OPACITY).toBeLessThan(MINIMUM_MAP_BRIGHTNESS);
  });
});

describe("calculateZoomBounds", () => {
  it("allows zooming in to the nearest orbit and out to the farthest object, with margin", () => {
    const planets = [{ orbit: ellipseOrbit(2) }, { orbit: ellipseOrbit(5) }, { orbit: ellipseOrbit(20) }];
    const gates = [{ scenePosition: [30, 0, 0] as [number, number, number] }];

    const bounds = calculateZoomBounds(planets, gates);

    expect(bounds.min).toBe(2);
    expect(bounds.max).toBeCloseTo(30 * 1.65);
  });

  it("bases the far bound on the farthest planet when it is farther than every gate", () => {
    const planets = [{ orbit: ellipseOrbit(2) }, { orbit: ellipseOrbit(20) }];
    const gates = [{ scenePosition: [5, 0, 0] as [number, number, number] }];

    const bounds = calculateZoomBounds(planets, gates);

    expect(bounds.max).toBeCloseTo(20 * 1.65);
  });

  it("keeps a usable zoom range even when a system has a single object", () => {
    const planets = [{ orbit: ellipseOrbit(10) }];
    const gates: { scenePosition: [number, number, number] }[] = [];

    const bounds = calculateZoomBounds(planets, gates);

    expect(bounds.min).toBe(10);
    expect(bounds.max).toBeCloseTo(10 * 1.65);
  });

  it("scales with the system instead of using one fixed range for every system", () => {
    const smallSystem = calculateZoomBounds([{ orbit: ellipseOrbit(0.05) }], [{ scenePosition: [0.6, 0, 0] }]);
    const largeSystem = calculateZoomBounds([{ orbit: ellipseOrbit(7) }], [{ scenePosition: [30, 0, 0] }]);

    expect(smallSystem.max).toBeLessThan(largeSystem.min);
  });

  it("falls back to a fixed range when a system has no planets or gates", () => {
    const bounds = calculateZoomBounds([], []);

    expect(bounds.min).toBe(6);
    expect(bounds.max).toBe(18);
  });

  it("still lets a planet-less system zoom out to its farthest stargate", () => {
    const bounds = calculateZoomBounds([], [{ scenePosition: [40, 0, 0] }]);

    expect(bounds.max).toBeCloseTo(40 * 1.65);
  });
});
