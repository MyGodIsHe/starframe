import { describe, expect, it } from "vitest";
import { type SolidPoint } from "./glyphSolid";
import { buildHorseshoe, HORSESHOE } from "./sigilHorseshoe";
import { readSigilModel } from "./sigilModel";

const raw = buildHorseshoe();
const horseshoe = readSigilModel(raw)!;

function radius(point: SolidPoint): number {
  return Math.hypot(point[0], point[1], point[2]);
}

describe("buildHorseshoe", () => {
  it("is a coarse, closed Sigil Figure named in the singular", () => {
    expect(horseshoe).not.toBeNull();
    expect(horseshoe.name).toBe("horseshoe");
    expect(horseshoe.solid.faces.length).toBeGreaterThan(0);
    expect(horseshoe.solid.faces.length).toBeLessThanOrEqual(512);
    expect(horseshoe.solid.edges).toHaveLength((horseshoe.solid.faces.length * 3) / 2);
    for (const edge of horseshoe.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("is a recognisable U: two raised tips, an open top, and an inner opening", () => {
    const vertices = horseshoe.solid.vertices;
    const high = Math.max(...vertices.map((point) => point[1]));
    const low = Math.min(...vertices.map((point) => point[1]));
    const tips = vertices.filter((point) => point[1] > high - 0.08);

    expect(low).toBeLessThan(-0.7);
    expect(tips.some((point) => point[0] < -0.45)).toBe(true);
    expect(tips.some((point) => point[0] > 0.45)).toBe(true);
    expect(tips.every((point) => Math.abs(point[0]) > 0.35)).toBe(true);
    expect(vertices.some((point) => Math.abs(point[0]) < 0.12 && point[1] < -0.35)).toBe(true);
    expect(vertices.some((point) => Math.abs(point[0]) < 0.12 && point[1] > 0.35)).toBe(false);
  });

  it("pierces the shoe with six nail holes rather than merely painting circles on it", () => {
    // One closed body has Euler characteristic 2. Every through-hole lowers it by two.
    const characteristic = horseshoe.solid.vertices.length - horseshoe.solid.edges.length + horseshoe.solid.faces.length;

    expect(HORSESHOE.holes).toHaveLength(6);
    expect(characteristic).toBe(2 - 2 * HORSESHOE.holes.length);
  });

  it("marks structural edges and both rims of every nail hole as drawn lines", () => {
    expect(raw.drawn.length).toBeGreaterThan(HORSESHOE.holes.length * 8);
    for (const [from, to] of raw.drawn) {
      expect(horseshoe.solid.edges.some((edge) =>
        (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))).toBe(true);
    }
  });

  it("fits the unit sphere and anchors both tips, both shoulders, and the heel", () => {
    expect(Math.max(...horseshoe.solid.vertices.map(radius))).toBeCloseTo(1);
    for (const vertex of horseshoe.solid.vertices) expect(radius(vertex)).toBeLessThanOrEqual(1 + 1e-9);

    const anchors = horseshoe.anchors.map((anchor) => anchor.position);
    expect(anchors).toHaveLength(5);
    expect(anchors.filter((point) => point[1] > 0.35)).toHaveLength(2);
    expect(anchors.filter((point) => point[1] < -0.65)).toHaveLength(1);
    expect(anchors.some((point) => point[0] < -0.7)).toBe(true);
    expect(anchors.some((point) => point[0] > 0.7)).toBe(true);
  });
});
