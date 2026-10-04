import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type SolidPoint } from "./glyphSolid";
import { buildRadiation, RADIATION } from "./sigilRadiation";
import { readSigilModel } from "./sigilModel";

const raw = buildRadiation();
const radiation = readSigilModel(raw)!;

function radius([x, y]: SolidPoint): number {
  return Math.hypot(x, y);
}

function bodyOf(vertex: number): number {
  const discVertices = RADIATION.discSegments * 2;
  if (vertex < discVertices) return 0;
  return 1 + Math.floor((vertex - discVertices) / ((RADIATION.lobeSegments + 1) * 4));
}

describe("buildRadiation", () => {
  it("is accepted as the radiation Sigil Figure", () => {
    expect(radiation).not.toBeNull();
    expect(radiation.name).toBe("radiation");
    expect(radiation.solid.faces.length).toBeGreaterThan(0);
  });

  it("closes every body, so each can hide its own far side", () => {
    expect(radiation.solid.edges).toHaveLength((radiation.solid.faces.length * 3) / 2);
    for (const edge of radiation.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays within the figure budget", () => {
    expect(radiation.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("is a central disc and three separate sector lobes", () => {
    const bodies = new Set<number>();
    for (const edge of radiation.solid.edges) {
      expect(bodyOf(edge.from)).toBe(bodyOf(edge.to));
      bodies.add(bodyOf(edge.from));
    }
    expect(bodies).toEqual(new Set([0, 1, 2, 3]));

    const centre = radiation.solid.vertices.filter((_, vertex) => bodyOf(vertex) === 0);
    const lobes = radiation.solid.vertices.filter((_, vertex) => bodyOf(vertex) > 0);
    expect(Math.max(...centre.map(radius))).toBeLessThan(Math.min(...lobes.map(radius)));
  });

  it("leaves three broad, equal gaps between the lobes", () => {
    const middles = [0, 1, 2].map((lobe) => Math.PI / 2 + lobe * 2 * Math.PI / 3);
    const verticesPerLobe = (RADIATION.lobeSegments + 1) * 4;

    for (let lobe = 0; lobe < 3; lobe += 1) {
      const own = radiation.solid.vertices.slice(RADIATION.discSegments * 2 + lobe * verticesPerLobe, RADIATION.discSegments * 2 + (lobe + 1) * verticesPerLobe);
      const angles = own.map(([x, y]) => {
        const turn = Math.atan2(y, x) - middles[lobe];
        return Math.atan2(Math.sin(turn), Math.cos(turn));
      });
      expect(Math.min(...angles)).toBeCloseTo(-RADIATION.lobeSpread / 2);
      expect(Math.max(...angles)).toBeCloseTo(RADIATION.lobeSpread / 2);
    }
    expect(RADIATION.lobeSpread).toBeLessThan(2 * Math.PI / 3);
  });

  it("puts the lobe tips on the unit sphere and anchors their characteristic corners", () => {
    expect(Math.max(...radiation.solid.vertices.map((point) => Math.hypot(...point)))).toBeCloseTo(1);
    expect(radiation.anchors.length).toBeGreaterThanOrEqual(4);
    for (const anchor of radiation.anchors) expect(Math.hypot(...anchor.position)).toBeCloseTo(1);
  });

  it("marks the circular and sector boundaries as drawn edges", () => {
    expect(raw.drawn.length).toBeGreaterThan(RADIATION.discSegments * 2);
    expect(radiation.solid.edges.filter((edge) => edge.drawn).length).toBe(raw.drawn.length);
  });
});

describe("the radiation figure as an observer sees it", () => {
  it("reads face-on as a centre surrounded by three lobes", () => {
    const lines = drawnEdges(radiation.solid, [0, 0, 12]);
    const radii = lines.flatMap((line) => [radius(line.from), radius(line.to)]);

    expect(lines.length).toBeGreaterThan(20);
    expect(Math.min(...radii)).toBeLessThan(RADIATION.discRadius);
    expect(Math.max(...radii)).toBeGreaterThan(0.9);
  });

  it("hides the far faces behind the near faces", () => {
    const observer: SolidPoint = [0, 0, 12];
    // Use the middle of a curved rim: a radial end deliberately leaves its far corner visible as
    // silhouette through the neighbouring gap, while this point stands squarely behind the plate.
    const lobe = RADIATION.discSegments * 2;
    const rail = RADIATION.lobeSegments + 1;
    const middle = Math.floor(RADIATION.lobeSegments / 2);
    const near = lobe + middle;
    const far = lobe + 2 * rail + middle;

    expect(isVertexVisible(radiation.solid, near, observer)).toBe(true);
    expect(isVertexVisible(radiation.solid, far, observer)).toBe(false);
  });
});
