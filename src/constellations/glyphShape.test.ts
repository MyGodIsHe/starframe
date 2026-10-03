import { describe, expect, it } from "vitest";
import { buildGlyphShape, type GlyphShape } from "./glyphShape";
import { readSigilModel } from "./sigilModel";
import { buildRing } from "./sigilRing";
import type { Vector3 } from "../universe/generateUniverse";

// The one figure a fresh clone has: generated, not imported, and the same body `/sigil.html` turns.
const FIGURE = readSigilModel(buildRing())!;

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

function allPoints(shape: GlyphShape): Vector3[] {
  return [
    ...shape.leads.flatMap((lead) => [lead.from, lead.to]),
    ...shape.solids.flatMap((solid) => solid.vertices.map((vertex) => [...vertex] as Vector3)),
  ];
}

// How thick the body stands through the plane it was placed in, against how wide it is across it,
// measured about the body's own centre: where in the constellation the fit put it is a different
// question from what shape it is.
function bodyThickness(shape: GlyphShape): number {
  const vertices = shape.solids.flatMap((solid) => solid.vertices);
  const centre = [0, 1, 2].map((axis) => vertices.reduce((total, vertex) => total + vertex[axis] / vertices.length, 0));
  let least = Infinity;
  let most = -Infinity;
  let across = 0;
  for (const vertex of vertices) {
    const offset = [0, 1, 2].map((axis) => vertex[axis] - centre[axis]);
    const along = offset[0] * shape.normal[0] + offset[1] * shape.normal[1] + offset[2] * shape.normal[2];
    least = Math.min(least, along);
    most = Math.max(most, along);
    across = Math.max(across, Math.hypot(offset[0] - shape.normal[0] * along, offset[1] - shape.normal[1] * along, offset[2] - shape.normal[2] * along));
  }
  return Number.isFinite(least) && across > 0 ? (most - least) / (2 * across) : 0;
}

// The same measurement taken of the model itself, in its own space, where its centre is the origin.
function modelThickness(): number {
  let least = Infinity;
  let most = -Infinity;
  let across = 0;
  for (const vertex of FIGURE.solid.vertices) {
    least = Math.min(least, vertex[2]);
    most = Math.max(most, vertex[2]);
    across = Math.max(across, Math.hypot(vertex[0], vertex[1]));
  }
  return (most - least) / (2 * across);
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

  it("keeps the body the shape it was sculpted as, whatever the constellation is like", () => {
    // The depth used to be taken from how far the Solar Systems sat off their own plane, because a
    // drawing has no depth of its own to take it from. A model does, and it is the artwork: a flat
    // constellation and a deep one wear the same figure, at the same proportions it was sculpted in.
    expect(bodyThickness(buildGlyphShape(FLAT, FIGURE)!)).toBeCloseTo(modelThickness(), 6);
    expect(bodyThickness(buildGlyphShape(DEEP, FIGURE)!)).toBeCloseTo(modelThickness(), 6);
  });

  it("ties a Solar System the figure never reached, and leaves the rest alone", () => {
    // One system pulled well outside the ring, where no part of the body can be near it.
    const stray = [...FLAT.slice(0, 4), { id: 5, position: [-9e15, -2.4e16, 0] as Vector3 }];
    const shape = buildGlyphShape(stray, FIGURE)!;

    expect(shape.leads.length).toBeGreaterThan(0);
    expect(shape.leads.length).toBeLessThan(stray.length);
    for (const lead of shape.leads) {
      expect(Math.hypot(lead.from[0] - lead.to[0], lead.from[1] - lead.to[1], lead.from[2] - lead.to[2])).toBeGreaterThan(0);
    }
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
