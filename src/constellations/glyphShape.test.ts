import { describe, expect, it } from "vitest";
import { buildGlyphShape } from "./glyphShape";
import type { SigilFigure } from "./sigilFigure";
import type { Vector3 } from "../universe/generateUniverse";

const FIGURE: SigilFigure = {
  name: "arrow",
  strokes: [[[0, -1], [0, 1]], [[-0.4, 0.5], [0, 1], [0.4, 0.5]]],
  anchors: [[0, 1], [0, -1], [-0.4, 0.5], [0.4, 0.5]],
};

// A constellation lying almost exactly in the x/y plane.
const FLAT = [
  { id: 1, position: [0, 0, 0] as Vector3 },
  { id: 2, position: [8e15, 1e15, 0] as Vector3 },
  { id: 3, position: [2e15, 9e15, 0] as Vector3 },
  { id: 4, position: [-6e15, 5e15, 0] as Vector3 },
  { id: 5, position: [-3e15, -7e15, 0] as Vector3 },
];

// The same cloud pulled out of any one plane.
const DEEP = FLAT.map((system, index) => ({
  id: system.id,
  position: [system.position[0], system.position[1], (index % 2 === 0 ? 1 : -1) * 5e15] as Vector3,
}));

function allPoints(shape: { strokes: readonly { points: readonly Vector3[] }[] }): Vector3[] {
  return shape.strokes.flatMap((stroke) => [...stroke.points]);
}

function planeResiduals(points: readonly Vector3[]): number {
  // Spread along the least-populated axis of the point cloud, as a share of its overall size.
  const centre: Vector3 = [0, 0, 0];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) centre[axis] += point[axis] / points.length;
  const spreads = [0, 1, 2].map((axis) => Math.sqrt(points.reduce((total, point) => total + (point[axis] - centre[axis]) ** 2, 0) / points.length));
  return Math.min(...spreads) / Math.max(...spreads, 1e-9);
}

describe("buildGlyphShape", () => {
  it("places the figure on the constellation's own systems, in absolute space", () => {
    const shape = buildGlyphShape(FLAT, FIGURE)!;
    const points = allPoints(shape);

    expect(points.length).toBeGreaterThan(0);
    for (const point of points) expect(point.every(Number.isFinite)).toBe(true);

    // The artwork sits around the constellation, not off at the origin of the universe.
    const centre: Vector3 = [0, 0, 0];
    for (const member of FLAT) for (let axis = 0; axis < 3; axis += 1) centre[axis] += member.position[axis] / FLAT.length;
    for (const point of points) {
      expect(Math.hypot(point[0] - centre[0], point[1] - centre[1], point[2] - centre[2])).toBeLessThan(3e16);
    }
  });

  it("does not depend on the observer, because it never sees one", () => {
    expect(buildGlyphShape(FLAT, FIGURE)).toEqual(buildGlyphShape(FLAT, FIGURE));
  });

  it("is deterministic when the systems arrive in a different order", () => {
    const forward = allPoints(buildGlyphShape(FLAT, FIGURE)!);
    const reversed = allPoints(buildGlyphShape([...FLAT].reverse(), FIGURE)!);

    expect(reversed.length).toBe(forward.length);
    for (const [index, point] of reversed.entries()) {
      for (let axis = 0; axis < 3; axis += 1) expect(point[axis] / 1e15).toBeCloseTo(forward[index][axis] / 1e15, 6);
    }
  });

  it("takes its relief from the constellation: a flat one stays flat, a deep one gains volume", () => {
    const flat = planeResiduals(allPoints(buildGlyphShape(FLAT, FIGURE)!));
    const deep = planeResiduals(allPoints(buildGlyphShape(DEEP, FIGURE)!));

    expect(flat).toBeLessThan(0.02);
    expect(deep).toBeGreaterThan(0.1);
  });

  it("never lets one far-flung system spike the artwork into a needle", () => {
    const spiked = [...FLAT.slice(0, 4), { id: 5, position: [-3e15, -7e15, 9e16] as Vector3 }];
    const shape = buildGlyphShape(spiked, FIGURE)!;

    let radius = 0;
    const centre: Vector3 = [0, 0, 0];
    for (const member of spiked) for (let axis = 0; axis < 3; axis += 1) centre[axis] += member.position[axis] / spiked.length;
    for (const point of allPoints(shape)) {
      radius = Math.max(radius, Math.hypot(point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]));
    }
    expect(Number.isFinite(radius)).toBe(true);
    expect(radius).toBeLessThan(2e17);
  });

  it("gives up rather than inventing a shape it cannot build", () => {
    expect(buildGlyphShape([FLAT[0]], FIGURE)).toBeNull();
    expect(buildGlyphShape([], FIGURE)).toBeNull();
    expect(buildGlyphShape(FLAT.map((system) => ({ ...system, position: [0, 0, 0] as Vector3 })), FIGURE)).toBeNull();
  });
});
