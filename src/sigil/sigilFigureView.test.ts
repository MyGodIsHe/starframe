import { describe, expect, it } from "vitest";
import { readSigilModel, type SigilModel } from "../constellations/sigilModel";
import { observerPosition, proximityOf, viewSigilFigure } from "./sigilFigureView";

// A sculpted figure made here rather than imported.
//
// No model is committed to the repository - see `sigilModel` for why - so the page's behaviour is
// tested against a body built in the test. A box on the unit sphere, every edge of it a marked
// crease and every corner an anchor, is enough to ask all of it: it has a near side and a far side,
// its outline changes completely as an observer walks round it, and four of its corners are always
// round the back.
const CUBE = (() => {
  const half = 1 / Math.sqrt(3);
  const vertices = [-1, 1].flatMap((z) => [-1, 1].flatMap((y) => [-1, 1].map((x) => [x * half, y * half, z * half])));
  const faces: [number, number, number][] = [
    [0, 3, 1], [0, 2, 3],
    [4, 5, 7], [4, 7, 6],
    [0, 1, 5], [0, 5, 4],
    [1, 3, 7], [1, 7, 5],
    [3, 2, 6], [3, 6, 7],
    [2, 0, 4], [2, 4, 6],
  ];
  // The twelve edges of the box, and not the diagonals the triangulation left behind.
  const drawn = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [3, 7], [2, 6]];
  return readSigilModel({ name: "cube", source: { file: "cube.stl" }, vertices, triangles: faces, drawn, anchors: [0, 1, 2, 3, 4, 5, 6, 7] })!;
})();

const figure: SigilModel = CUBE;

function lineKeys(observer: Parameters<typeof viewSigilFigure>[1]): string[] {
  return viewSigilFigure(figure, observer).strokes.map((stroke) => [...stroke.from, ...stroke.to].map((value) => value.toFixed(5)).join(",")).sort();
}

describe("viewSigilFigure", () => {
  it("draws the body as an outline with detail inside it", () => {
    const view = viewSigilFigure(figure, observerPosition(0.6, 0.2));
    const kinds = new Set(view.strokes.map((stroke) => stroke.kind));

    expect(kinds.has("silhouette")).toBe(true);
    expect(kinds.has("interior")).toBe(true);
    expect(view.strokes.filter((stroke) => stroke.kind === "silhouette").length).toBeGreaterThanOrEqual(4);
  });

  it("stands a node on the anchors it can see, where a real Solar System would be", () => {
    const nodes = viewSigilFigure(figure, observerPosition(0.6, 0.2)).nodes;

    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) expect(figure.anchors.some((anchor) => anchor.vertex === node.systemId)).toBe(true);
  });

  it("never draws the far side", () => {
    const view = viewSigilFigure(figure, observerPosition(0.6, 0.2));

    // Three of a box's twelve edges are round the back from any corner, and the triangulation that
    // holds the surface together was never part of the drawing either.
    expect(view.strokes.length).toBeLessThan(figure.solid.edges.length);
    expect(view.strokes.length).toBeGreaterThan(0);
  });

  it("turns the figure when the observer moves", () => {
    expect(lineKeys(observerPosition(Math.PI / 2, 0))).not.toEqual(lineKeys(observerPosition(0, 0)));
  });

  it("invents no geometry: every line it draws runs along an edge of the body", () => {
    for (const stroke of viewSigilFigure(figure, observerPosition(0.8, 0.3)).strokes) {
      expect(figure.solid.edges.some((edge) => liesAlong(stroke.from, stroke.to, figure.solid.vertices[edge.from], figure.solid.vertices[edge.to]))).toBe(true);
    }
  });

  it("hides the anchors the body stands in front of", () => {
    const counts = [0, 1.4, 2.8, 4.2].map((azimuth) => viewSigilFigure(figure, observerPosition(azimuth, 0.1)).nodes.length);

    // Every anchor is a point on the surface, so some of them are round the back from any one side.
    expect(Math.max(...counts)).toBeLessThanOrEqual(figure.anchors.length);
    expect(Math.min(...counts)).toBeLessThan(figure.anchors.length);
    expect(Math.max(...counts)).toBeGreaterThan(0);
  });

  it("gives the same drawing for the same observer, whatever happened in between", () => {
    const first = viewSigilFigure(figure, observerPosition(1.1, -0.3));
    viewSigilFigure(figure, observerPosition(2.6, 0.8));
    const again = viewSigilFigure(figure, observerPosition(1.1, -0.3));

    expect(again).toEqual(first);
  });
});

// Whether a drawn line is a stretch of one of the body's own edges: on it, and within it.
function liesAlong(from: readonly number[], to: readonly number[], start: readonly number[], end: readonly number[]): boolean {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  if (length === 0) return false;

  return [from, to].every((point) => {
    const amount = ((point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1]) + (point[2] - start[2]) * (end[2] - start[2])) / (length * length);
    if (amount < -1e-6 || amount > 1 + 1e-6) return false;
    const nearest = [0, 1, 2].map((axis) => start[axis] + (end[axis] - start[axis]) * amount);
    return Math.hypot(point[0] - nearest[0], point[1] - nearest[1], point[2] - nearest[2]) < 1e-6;
  });
}

describe("proximityOf", () => {
  it("reads the near side of the body as nearer than its far side", () => {
    const observer = observerPosition(0, 0);

    expect(proximityOf([0, 0, 1], observer)).toBeGreaterThan(proximityOf([0, 0, -1], observer));
  });

  it("stays inside the ramp the depth cue is drawn on", () => {
    const observer = observerPosition(0.4, 0.4);

    for (const vertex of figure.solid.vertices) {
      const proximity = proximityOf(vertex, observer);
      expect(proximity).toBeGreaterThanOrEqual(0);
      expect(proximity).toBeLessThanOrEqual(1);
    }
  });
});
