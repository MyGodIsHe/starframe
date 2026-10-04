import { describe, expect, it } from "vitest";
import { classifyEdges, drawnEdges, type SolidPoint } from "./glyphSolid";
import { modelForFigure, readSigilModel, SIGIL_MODELS } from "./sigilModel";

// A closed box with only its vertical creases marked, so the test can tell an edge that was marked
// from one that is only ever drawn because the body turns away there.
const BOX = {
  name: "box",
  source: { file: "box.stl" },
  vertices: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ],
  triangles: [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ],
  drawn: [[0, 1], [1, 2], [2, 3], [0, 3]],
  anchors: [0, 6],
};

describe("readSigilModel", () => {
  it("builds a closed surface, so the body can hide its own far side", () => {
    const model = readSigilModel(BOX)!;

    expect(model.solid.faces).toHaveLength(12);
    for (const edge of model.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
    expect(model.solid.edges).toHaveLength(18);
  });

  it("carries the anchors through as points on the model, and remembers which vertex each is", () => {
    expect(readSigilModel(BOX)!.anchors).toEqual([
      { vertex: 0, position: [-1, -1, -1] },
      { vertex: 6, position: [1, 1, 1] },
    ]);
  });

  it("drops a model whose indices point at vertices it does not have", () => {
    expect(readSigilModel({ ...BOX, triangles: [[0, 1, 99]] })).toBeNull();
  });

  it("drops a model with no name to match a figure by", () => {
    expect(readSigilModel({ ...BOX, name: "" })).toBeNull();
  });

  it("drops a malformed vertex rather than letting it reach the sky", () => {
    expect(readSigilModel({ ...BOX, vertices: [[0, 0], [1, "x", 2]] })).toBeNull();
  });
});

describe("a sculpted body's outline", () => {
  // Along +z: the far face is turned away, and the four edges round the body's rim are its outline.
  const observer: SolidPoint = [0, 0, 12];
  const drawnLengths = (solid: ReturnType<typeof readSigilModel>, from: SolidPoint) =>
    drawnEdges(solid!.solid, from).map((line) => line.from.concat(line.to).join(","));

  it("is drawn where the body ends, marked or not", () => {
    const model = readSigilModel(BOX)!;
    const visibility = classifyEdges(model.solid, observer);
    const outline = model.solid.edges.filter((edge, index) => visibility[index] === "silhouette");

    // The rim of a cube seen face on: four edges, and the triangulation marked none of them.
    expect(outline.some((edge) => !edge.drawn)).toBe(true);
    expect(drawnEdges(model.solid, observer).length).toBeGreaterThanOrEqual(outline.length);
  });

  it("leaves the triangulation out of the near side, which was never part of the drawing", () => {
    const model = readSigilModel(BOX)!;
    const visibility = classifyEdges(model.solid, observer);
    const structural = model.solid.edges.filter((edge, index) => visibility[index] === "interior" && !edge.drawn);

    expect(structural.length).toBeGreaterThan(0);
    for (const edge of structural) {
      const [start, end] = [model.solid.vertices[edge.from], model.solid.vertices[edge.to]];
      expect(drawnLengths(model, observer)).not.toContain(start.concat(end).join(","));
    }
  });

  it("never draws what is behind the body", () => {
    const model = readSigilModel(BOX)!;

    // Nothing at the far face, which the near face covers completely.
    for (const line of drawnEdges(model.solid, observer)) {
      expect(Math.max(line.from[2], line.to[2])).toBeGreaterThan(-1);
    }
  });

  it("changes which lines it shows when the observer moves, and moves no vertex doing it", () => {
    const model = readSigilModel(BOX)!;

    expect(drawnLengths(model, [12, 3, 0])).not.toEqual(drawnLengths(model, observer));
    expect(model.solid.vertices).toEqual(readSigilModel(BOX)!.solid.vertices);
  });
});

describe("the imported library", () => {
  // Nothing is committed to it: a sculpted body is somebody else's model, and whether it may be
  // redistributed is their decision. These hold for whatever a build imports for itself, and stand
  // as the contract `scripts/import-sigil-model.ts` writes against.
  it("ships the figures it generates, and nothing it did not make itself", () => {
    expect(modelForFigure("bolt")).not.toBeNull();
    expect(modelForFigure("atom")).not.toBeNull();
    expect(modelForFigure("ring")).not.toBeNull();
    expect(modelForFigure("hammer")).not.toBeNull();
    expect(modelForFigure("cheese")).not.toBeNull();
    expect(modelForFigure("gear")).not.toBeNull();
    expect(modelForFigure("diamond")).not.toBeNull();
    expect(modelForFigure("cross")).not.toBeNull();
    expect(modelForFigure("biohazard")).not.toBeNull();
    expect(modelForFigure("radiation")).not.toBeNull();
    expect(modelForFigure("pacman")).not.toBeNull();
    expect(modelForFigure("horseshoe")).not.toBeNull();
    expect(modelForFigure("millet")).not.toBeNull();
    expect(modelForFigure("snowflake")).not.toBeNull();
    expect(modelForFigure("quake")).not.toBeNull();
    expect(modelForFigure("wolf")).toBeNull();
    expect(SIGIL_MODELS.map((model) => model.name)).toEqual([
      "bolt", "atom", "ring", "hammer", "cheese", "gear", "diamond", "cross",
      "biohazard", "radiation", "pacman", "horseshoe", "millet", "snowflake", "quake",
    ]);
  });

  it("keeps every body closed and inside the figure's own space", () => {
    for (const model of SIGIL_MODELS) {
      // A closed triangle mesh has exactly three halves of an edge per face.
      expect(model.solid.edges).toHaveLength((model.solid.faces.length * 3) / 2);
      for (const vertex of model.solid.vertices) expect(Math.hypot(vertex[0], vertex[1], vertex[2])).toBeLessThanOrEqual(1.001);
      expect(model.anchors.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps a sigil to a handful of lines instead of a wireframe model", () => {
    for (const model of SIGIL_MODELS) {
      expect(model.solid.edges.filter((edge) => edge.drawn).length).toBeLessThan(model.solid.edges.length / 2);
    }
  });

  it("stays small enough to solve the facing test for, for every glyph on the sky", () => {
    for (const model of SIGIL_MODELS) expect(model.solid.faces.length).toBeLessThanOrEqual(512);
  });
});
