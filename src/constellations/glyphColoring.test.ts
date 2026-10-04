import { describe, expect, it } from "vitest";
import type { ConstellationGlyph } from "./constellationGlyphModel";
import { assignGlyphColors, buildGlyphAdjacency } from "./glyphColoring";
import { FIGURE_EXTENT } from "./sigilFit";

function glyph(constellationId: number, degrees: number): ConstellationGlyph {
  const radians = (degrees * Math.PI) / 180;
  const position: [number, number, number] = [Math.cos(radians) * 24, Math.sin(radians) * 24, 0];
  return {
    constellationId,
    opacity: 1,
    nodes: [{ systemId: constellationId, position, opacity: 1, proximity: 0.5, distance: 9_460_000_000_000_000 }],
    strokes: [{ kind: "silhouette", from: position, to: position, opacity: 1, proximity: 0.5, reliefStart: 0.5, reliefEnd: 0.5 }],
    reach: FIGURE_EXTENT,
    pen: 1,
  };
}

describe("visual glyph adjacency", () => {
  it("joins immediate sky neighbours without treating every visible pair as adjacent", () => {
    const graph = buildGlyphAdjacency([[glyph(1, -20), glyph(2, 0), glyph(3, 20)]]);

    expect(graph.get(1)).toEqual(new Set([2]));
    expect(graph.get(2)).toEqual(new Set([1, 3]));
    expect(graph.get(3)).toEqual(new Set([2]));
  });

  it("collects neighbour relationships from the whole journey", () => {
    const graph = buildGlyphAdjacency([
      [glyph(1, -20), glyph(2, 0), glyph(3, 20)],
      [glyph(1, -20), glyph(3, 0), glyph(2, 20)],
    ]);

    expect(graph.get(1)).toEqual(new Set([2, 3]));
  });
});

describe("assignGlyphColors", () => {
  it("gives adjacent glyphs different colours", () => {
    const frame = [glyph(1, -20), glyph(2, 0), glyph(3, 20)];
    const colors = assignGlyphColors([frame], new Map(), 3);
    const graph = buildGlyphAdjacency([frame]);

    for (const [id, neighbors] of graph) {
      for (const neighbor of neighbors) expect(colors.get(id)).not.toBe(colors.get(neighbor));
    }
  });

  it("uses one valid colouring for every sampled frame of a journey", () => {
    const frames = [
      [glyph(1, -30), glyph(2, -10), glyph(3, 20)],
      [glyph(1, -30), glyph(3, -10), glyph(2, 20)],
    ];
    const colors = assignGlyphColors(frames, new Map(), 3);

    for (const [id, neighbors] of buildGlyphAdjacency(frames)) {
      for (const neighbor of neighbors) expect(colors.get(id)).not.toBe(colors.get(neighbor));
    }
  });

  it("keeps existing colours when a new glyph can be fitted around them", () => {
    const previous = new Map([[1, 0], [2, 1]]);
    const colors = assignGlyphColors([[glyph(1, -20), glyph(2, 0), glyph(3, 20)]], previous, 3);

    expect(colors.get(1)).toBe(0);
    expect(colors.get(2)).toBe(1);
    expect(colors.get(3)).not.toBe(1);
  });

  it("drops colours belonging only to glyphs which have left the sky", () => {
    const colors = assignGlyphColors([[glyph(2, 0)]], new Map([[1, 0], [2, 1]]), 3);

    expect(colors).toEqual(new Map([[2, 1]]));
  });

  it("recolours only what is necessary when motion makes an old same-colour pair adjacent", () => {
    const previous = new Map([[1, 0], [2, 0], [3, 1]]);
    const colors = assignGlyphColors([[glyph(1, -20), glyph(2, 0), glyph(3, 20)]], previous, 3);

    expect([colors.get(1), colors.get(2)].filter((color) => color === 0)).toHaveLength(1);
    expect(colors.get(3)).toBe(1);
  });
});
