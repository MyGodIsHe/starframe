import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type SolidPoint } from "./glyphSolid";
import { readSigilModel } from "./sigilModel";
import { buildRing, RING } from "./sigilRing";

const ring = readSigilModel(buildRing())!;
const raw = buildRing();

// Distance from the tube's own centre line, which is the circle of radius `major` in the z = 0
// plane: zero on the line, the tube radius on the surface.
function offTheLine(point: SolidPoint): number {
  const major = 1 - RING.thickness;
  const angle = Math.atan2(point[1], point[0]);
  return Math.hypot(point[0] - major * Math.cos(angle), point[1] - major * Math.sin(angle), point[2]);
}

describe("buildRing", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(ring).not.toBeNull();
    expect(ring.name).toBe("ring");
    expect(ring.solid.faces.length).toBeGreaterThan(0);
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face.
    expect(ring.solid.edges).toHaveLength((ring.solid.faces.length * 3) / 2);
    for (const edge of ring.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    expect(ring.solid.faces).toHaveLength(2 * RING.around * RING.through);
    expect(ring.solid.faces.length).toBeLessThanOrEqual(256);
  });

  it("puts its outer edge on the unit sphere, where a figure's farthest point goes", () => {
    const reach = Math.max(...ring.solid.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1], vertex[2])));

    expect(reach).toBeCloseTo(1);
  });

  it("is a ring and not a disc: every point is the tube's own radius off its centre line", () => {
    for (const vertex of ring.solid.vertices) expect(offTheLine(vertex)).toBeCloseTo(RING.thickness);
    // Which leaves a hole of this radius in the middle.
    expect(Math.min(...ring.solid.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1])))).toBeCloseTo(1 - 2 * RING.thickness);
  });

  it("is wound outward, which is what lets the facing test read it at all", () => {
    const major = 1 - RING.thickness;
    for (const face of ring.solid.faces) {
      const angle = Math.atan2(face.centre[1], face.centre[0]);
      const outward = [face.centre[0] - major * Math.cos(angle), face.centre[1] - major * Math.sin(angle), face.centre[2]];
      expect(face.normal[0] * outward[0] + face.normal[1] * outward[1] + face.normal[2] * outward[2]).toBeGreaterThan(0);
    }
  });

  it("marks the rails that run the whole way round, and nothing holding the surface together", () => {
    expect(raw.drawn).toHaveLength(RING.around * Math.ceil(RING.through / RING.railStep));
    // A rail joins neighbouring steps around the ring at one place on the tube, so its two ends sit
    // the same distance off the centre line.
    for (const [from, to] of raw.drawn) {
      expect(offTheLine(raw.vertices[from])).toBeCloseTo(offTheLine(raw.vertices[to]));
      expect(raw.vertices[from][2]).toBeCloseTo(raw.vertices[to][2]);
    }
  });

  it("spreads its anchors round the outer edge rather than bunching them", () => {
    const anchors = ring.anchors.map((anchor) => anchor.position);

    expect(anchors.length).toBeGreaterThanOrEqual(4);
    for (const anchor of anchors) expect(Math.hypot(anchor[0], anchor[1], anchor[2])).toBeCloseTo(1);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(Math.hypot(anchors[left][0] - anchors[right][0], anchors[left][1] - anchors[right][1])).toBeGreaterThan(0.5);
      }
    }
  });
});

describe("the ring as an observer sees it", () => {
  it("shows its hole: the far side of the tube is drawn through the middle", () => {
    // Face on, down the ring's own axis. Both rims are outlines - the outer one because the body
    // ends there, the inner one because the hole does.
    const lines = drawnEdges(ring.solid, [0, 0, 12]);
    const radii = lines.flatMap((line) => [Math.hypot(line.from[0], line.from[1]), Math.hypot(line.to[0], line.to[1])]);

    expect(Math.max(...radii)).toBeCloseTo(1, 1);
    expect(Math.min(...radii)).toBeCloseTo(1 - 2 * RING.thickness, 1);
  });

  it("collapses to a bar seen edge on, which is the honest view of a thing with volume", () => {
    // Along the upright, at a ring standing in the x-y plane: it is as wide as the ring and only as
    // deep as the tube is thick.
    const lines = drawnEdges(ring.solid, [0, 12, 0]);
    const depth = Math.max(...lines.flatMap((line) => [Math.abs(line.from[2]), Math.abs(line.to[2])]));
    const width = Math.max(...lines.flatMap((line) => [Math.abs(line.from[0]), Math.abs(line.to[0])]));

    expect(depth).toBeLessThanOrEqual(RING.thickness + 1e-9);
    expect(width).toBeCloseTo(1, 1);
  });

  it("hides its own far side rather than drawing through itself", () => {
    const observer: SolidPoint = [0, 0, 12];
    // Two points at the same place round the ring, one on the near face of the tube and one
    // directly behind it. An opaque body shows the first and not the second.
    const near = ring.solid.vertices.findIndex((vertex) => vertex[1] === 0 && vertex[0] > 0 && vertex[2] > 0);
    const far = ring.solid.vertices.findIndex((vertex) => vertex[1] === 0 && vertex[0] > 0 && vertex[2] < 0);

    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(isVertexVisible(ring.solid, near, observer)).toBe(true);
    expect(isVertexVisible(ring.solid, far, observer)).toBe(false);
  });

  it("draws nothing from the back half of the tube", () => {
    const drawn = drawnEdges(ring.solid, [0, 0, 12]);
    const deepest = -RING.thickness * Math.sin(Math.PI / 3);

    expect(drawn.length).toBeGreaterThan(0);
    for (const line of drawn) expect(Math.min(line.from[2], line.to[2])).toBeGreaterThan(deepest / 2);
  });
});
