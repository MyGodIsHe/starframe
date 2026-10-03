import { describe, expect, it } from "vitest";
import { buildGlyphShape, type GlyphShape } from "./glyphShape";
import { FIGURE_EXTENT } from "./sigilFit";
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

// How far the drawing reaches across the constellation's own plane and where it is centred in it,
// both as multiples of the constellation's radius. Measured from the absolute vertices rather than
// read off `shape.reach`, so the figure is being asked rather than the number it reports.
function inThePlane(shape: GlyphShape): { reach: number; offset: number } {
  const right: Vector3 = [
    shape.up[1] * shape.normal[2] - shape.up[2] * shape.normal[1],
    shape.up[2] * shape.normal[0] - shape.up[0] * shape.normal[2],
    shape.up[0] * shape.normal[1] - shape.up[1] * shape.normal[0],
  ];
  const flat = shape.solids.flatMap((solid) =>
    solid.vertices.map((vertex): [number, number] => {
      const offset = [0, 1, 2].map((axis) => vertex[axis] - shape.centre[axis]);
      return [
        (offset[0] * right[0] + offset[1] * right[1] + offset[2] * right[2]) / shape.radius,
        (offset[0] * shape.up[0] + offset[1] * shape.up[1] + offset[2] * shape.up[2]) / shape.radius,
      ];
    }));

  const middle = (axis: 0 | 1): number =>
    (Math.min(...flat.map((point) => point[axis])) + Math.max(...flat.map((point) => point[axis]))) / 2;

  return {
    reach: Math.max(...flat.map((point) => Math.hypot(point[0], point[1]))),
    offset: Math.hypot(middle(0), middle(1)),
  };
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

  it("draws every figure out to the same share of its constellation's radius", () => {
    // What the eye was complaining about before the framing rule: a figure came out at a median of
    // 0.74 of its constellation's radius and as little as 0.27, so the stars held the patch of sky
    // and the artwork sat inside it. Now one multiple, every constellation.
    const lopsided = [...FLAT.slice(0, 3), { id: 9, position: [-2.4e16, -1.9e16, 0] as Vector3 }];

    for (const members of [FLAT, DEEP, lopsided]) {
      const shape = buildGlyphShape(members, FIGURE)!;
      const { reach } = inThePlane(shape);

      expect(reach).toBeCloseTo(FIGURE_EXTENT, 6);
      expect(shape.reach).toBeCloseTo(reach, 6);
    }
  });

  it("stands a figure on its constellation's own centre, not beside it", () => {
    // The other half of the same complaint: the retired fit landed the centre of whichever stars its
    // anchors happened to match, which stood a figure off to one side by up to half the radius.
    for (const members of [FLAT, DEEP, [...FLAT.slice(0, 3), { id: 9, position: [-2.4e16, -1.9e16, 0] as Vector3 }]]) {
      expect(inThePlane(buildGlyphShape(members, FIGURE)!).offset).toBeCloseTo(0, 6);
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

  it("starts every tie at the real three-dimensional Solar System", () => {
    const shape = buildGlyphShape(DEEP, FIGURE)!;

    expect(shape.leads.length).toBeGreaterThan(0);
    for (const lead of shape.leads) {
      const system = DEEP.find((entry) => entry.id === lead.systemId)!;
      expect(lead.from).toEqual(system.position);
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
    // The framing rule reaches out to a fixed multiple of the constellation's radius and no further,
    // which is a tighter promise than the loose ceiling this test used to settle for. The leads a
    // stray system earns run from the system itself, so they are allowed past it.
    expect(inThePlane(shape).reach).toBeCloseTo(FIGURE_EXTENT, 6);
    expect(radius).toBeLessThan(2e17);
  });

  it("gives up rather than inventing a shape it cannot build", () => {
    expect(buildGlyphShape([FLAT[0]], FIGURE)).toBeNull();
    expect(buildGlyphShape([], FIGURE)).toBeNull();
    expect(buildGlyphShape(FLAT.map((system) => ({ ...system, position: [0, 0, 0] as Vector3 })), FIGURE)).toBeNull();
  });
});
