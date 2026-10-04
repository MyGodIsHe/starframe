import { describe, expect, it } from "vitest";
import { drawnEdges, type SolidPoint } from "./glyphSolid";
import { buildMillet } from "./sigilMillet";
import { readSigilModel } from "./sigilModel";
import { length, subtract } from "./sigilVectors";

const raw = buildMillet();
const millet = readSigilModel(raw)!;

function same(left: SolidPoint, right: SolidPoint): boolean {
  return length(subtract(left, right)) < 1e-9;
}

function drawing(observer: SolidPoint): string {
  return drawnEdges(millet.solid, observer)
    .map((line) => length(subtract(line.from, line.to)).toFixed(8))
    .sort()
    .join(",");
}

describe("buildMillet", () => {
  it("is a millet Sigil Figure accepted through the same model seam as imported sculpture", () => {
    expect(millet).not.toBeNull();
    expect(millet.name).toBe("millet");
    expect(millet.solid.faces.length).toBeGreaterThan(0);
  });

  it("is a closed coarse surface with a real far side", () => {
    expect(millet.solid.faces.length).toBeLessThanOrEqual(512);
    expect(millet.solid.edges).toHaveLength((millet.solid.faces.length * 3) / 2);
    for (const edge of millet.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);

    const depths = millet.solid.vertices.map((vertex) => vertex[2]);
    expect(Math.min(...depths)).toBeLessThan(-0.04);
    expect(Math.max(...depths)).toBeGreaterThan(0.04);
  });

  it("arrives centred on the unit sphere", () => {
    expect(Math.max(...millet.solid.vertices.map(length))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const spread = millet.solid.vertices.map((vertex) => vertex[axis]);
      expect(Math.min(...spread) + Math.max(...spread)).toBeCloseTo(0);
    }
  });

  it("has one upright head and three mirrored pairs reaching upward and outward", () => {
    const anchors = millet.anchors.map((anchor) => anchor.position);

    expect(anchors).toHaveLength(7);
    const head = anchors[0];
    expect(head[0]).toBeCloseTo(0);
    expect(head[2]).toBeCloseTo(0);
    expect(head[1]).toBe(Math.max(...anchors.map((anchor) => anchor[1])));

    for (let pair = 0; pair < 3; pair += 1) {
      const left = anchors[1 + 2 * pair];
      const right = anchors[2 + 2 * pair];

      expect(left[0]).toBeLessThan(-0.2);
      expect(right[0]).toBeGreaterThan(0.2);
      expect(left[1]).toBeCloseTo(right[1]);
      expect(left[2]).toBeCloseTo(0);
      expect(right[2]).toBeCloseTo(0);
      expect(same([-left[0], left[1], -left[2]], right)).toBe(true);
    }

    // The three whorls climb the stem, while every blade climbs from its own attachment to its tip.
    expect(anchors[1][1]).toBeLessThan(anchors[3][1]);
    expect(anchors[3][1]).toBeLessThan(anchors[5][1]);
  });

  it("keeps the central stem visibly thinner than the six large grain-like blades", () => {
    const lowerStem = raw.vertices.filter((vertex) => vertex[1] < -0.5);
    const blades = raw.vertices.filter((vertex) => Math.abs(vertex[0]) > 0.16);
    const stemRadius = Math.max(...lowerStem.flatMap((vertex) => [Math.abs(vertex[0]), Math.abs(vertex[2])]));

    expect(stemRadius).toBeLessThan(0.04);
    expect(Math.max(...blades.map((vertex) => Math.abs(vertex[2])))).toBeGreaterThan(2.5 * stemRadius);
    expect(Math.max(...raw.vertices.map((vertex) => vertex[1])) - Math.min(...raw.vertices.map((vertex) => vertex[1]))).toBeGreaterThan(1.5);
  });

  it("marks sculptural ridges while leaving triangulation out of the drawing", () => {
    expect(raw.drawn.length).toBeGreaterThanOrEqual(16);
    expect(raw.drawn.length).toBeLessThan(millet.solid.edges.length / 3);
    for (const [from, to] of raw.drawn) expect(from).not.toBe(to);
  });

  it("builds every grain with a symmetric taper around its widest station", () => {
    const stemVertices = 18;
    const verticesPerGrain = 26;
    for (let grain = 0; grain < 7; grain += 1) {
      const first = stemVertices + grain * verticesPerGrain;
      const rings = [1, 9, 17].map((offset) => raw.vertices.slice(first + offset, first + offset + 8));
      const depths = rings.map((ring) => Math.max(...ring.map((vertex) => Math.abs(vertex[2]))));

      expect(depths[0]).toBeCloseTo(depths[2]);
      expect(depths[1]).toBeGreaterThan(depths[0]);
    }
  });
});

describe("the millet as an observer sees it", () => {
  it("hides its far ridges face-on instead of drawing the bodies on glass", () => {
    const seen = drawnEdges(millet.solid, [0, 0, 12]);
    const farRidges = raw.drawn.filter(([from, to]) => raw.vertices[from][2] < -0.04 && raw.vertices[to][2] < -0.04);

    expect(seen.length).toBeGreaterThan(7);
    expect(farRidges.length).toBeGreaterThan(0);
    for (const [from, to] of farRidges) {
      expect(seen.some((line) => same(line.from, raw.vertices[from]) && same(line.to, raw.vertices[to])
        || same(line.from, raw.vertices[to]) && same(line.to, raw.vertices[from]))).toBe(false);
    }
  });

  it("shows equal ridge detail from the front and back", () => {
    expect(drawing([0, 0, -12])).toBe(drawing([0, 0, 12]));
  });

  it("changes its drawing when travel reveals its side and upper surfaces", () => {
    const front: SolidPoint = [0, 0, 12];

    expect(drawing([10, 1, 7])).not.toBe(drawing(front));
    expect(drawing([0, 9, 7])).not.toBe(drawing(front));
  });
});
