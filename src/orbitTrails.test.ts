import { describe, expect, it } from "vitest";
import { calculateOrbitTrail } from "./orbitTrails";

describe("calculateOrbitTrail", () => {
  it("keeps a deterministic arc on its planet's orbit and shortens it near a compatible neighbor", () => {
    const isolated = calculateOrbitTrail({ id: 1, position: [4, 0, 0], orbit: { kind: "ellipse", semiMajorAxis: 4, semiMinorAxis: 3 } }, []);
    const crowded = calculateOrbitTrail(
      { id: 1, position: [4, 0, 0], orbit: { kind: "ellipse", semiMajorAxis: 4, semiMinorAxis: 3 } },
      [{ id: 2, position: [3.939, 0, 0.521], orbit: { kind: "ellipse", semiMajorAxis: 4.1, semiMinorAxis: 3.075 } }],
    );

    expect(isolated.points[0][2]).toBeLessThan(isolated.points.at(-1)?.[2] ?? 0);
    expect(isolated.length).toBeGreaterThan(crowded.length);
    expect(isolated.opacity).toBeGreaterThan(crowded.opacity);
    expect(crowded.length).toBeGreaterThanOrEqual(0.24);
    expect(crowded.opacity).toBeGreaterThanOrEqual(0.08);
    expect(isolated.length).toBeLessThanOrEqual(0.9);
    expect(isolated.opacity).toBeLessThanOrEqual(0.24);
    expect(crowded.points.at(-1)).toEqual([4, 0, 0]);
    for (const [x, y, z] of crowded.points) {
      expect(y).toBe(0);
      expect((x / 4) ** 2 + (z / 3) ** 2).toBeCloseTo(1, 8);
    }
  });

  it("keeps a fallback circle trail on its projected orbital plane", () => {
    const trail = calculateOrbitTrail({ id: 1, position: [0, 3, 4], orbit: { kind: "circle", radius: 5, normal: [1, 0, 0] } }, []);

    expect(trail.points.at(-1)).toEqual(expect.arrayContaining([expect.closeTo(0, 8), 3, 4]));
    for (const point of trail.points) {
      expect(point[0]).toBeCloseTo(0, 8);
      expect(Math.hypot(...point)).toBeCloseTo(5, 8);
    }
  });
});
