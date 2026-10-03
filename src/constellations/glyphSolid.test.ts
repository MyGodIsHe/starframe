import { describe, expect, it } from "vitest";
import { buildModelSolid, classifyEdges, drawnEdges, isVertexVisible, mapSolid, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { buildRing } from "./sigilRing";
import { readSigilModel } from "./sigilModel";

function tally(solid: GlyphSolid, observer: SolidPoint): Record<string, number> {
  const visibility = classifyEdges(solid, observer);
  const counts: Record<string, number> = { silhouette: 0, interior: 0, hidden: 0 };
  solid.edges.forEach((edge, position) => {
    if (edge.drawn) counts[visibility[position]] += 1;
  });
  return counts;
}

// Two boxes, one squarely behind the other: the simplest body whose far part faces an observer and
// is still covered by its near part, which is the case the facing test alone cannot answer.
function boxAt(centre: SolidPoint, half: number, offset: number): { vertices: SolidPoint[]; triangles: [number, number, number][] } {
  const vertices: SolidPoint[] = [-1, 1].flatMap((z) => [-1, 1].flatMap((y) => [-1, 1].map((x): SolidPoint => [centre[0] + x * half, centre[1] + y * half, centre[2] + z * half])));
  const corners = [0, 1, 3, 2, 4, 5, 7, 6].map((index) => index + offset);
  const [a, b, c, d, e, f, g, h] = corners;
  return {
    vertices,
    triangles: [
      [a, c, b], [a, d, c],
      [e, f, g], [e, g, h],
      [a, b, f], [a, f, e],
      [b, c, g], [b, g, f],
      [c, d, h], [c, h, g],
      [d, a, e], [d, e, h],
    ],
  };
}

function nestedBoxes(): GlyphSolid {
  const near = boxAt([0, 0, 2], 1, 0);
  const far = boxAt([0, 0, -2], 0.3, 8);
  const vertices = [...near.vertices, ...far.vertices];
  const triangles = [...near.triangles, ...far.triangles];
  // Every edge is part of the drawing, so nothing is dropped for any reason but being covered.
  const drawn = triangles.flatMap((triangle) => [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as [number, number][]);
  return buildModelSolid(vertices, triangles, drawn)!;
}

describe("drawnEdges", () => {
  const observer: SolidPoint = [0, 0, 40];

  it("leaves a convex body exactly what the facing test gives it", () => {
    const solid = buildModelSolid(boxAt([0, 0, 0], 1, 0).vertices, boxAt([0, 0, 0], 1, 0).triangles, [[0, 1], [1, 3], [3, 2], [2, 0]])!;
    const visibility = classifyEdges(solid, observer);
    const expected = solid.edges.filter((edge, index) => visibility[index] !== "hidden" && (edge.drawn || visibility[index] === "silhouette")).length;

    // Nothing of a convex body stands in front of anything else of it, so no line is cut.
    expect(drawnEdges(solid, observer)).toHaveLength(expected);
  });

  it("drops a line the body's own near side stands in front of", () => {
    const solid = nestedBoxes();
    const behind = drawnEdges(solid, observer).filter((line) => line.from[2] < 0 || line.to[2] < 0);

    // The small far box sits entirely inside the near box's shadow, and the facing test alone would
    // have drawn its four front edges straight through the near box.
    expect(classifyEdges(solid, observer).filter((seen, index) => seen !== "hidden" && solid.vertices[solid.edges[index].from][2] < 0).length).toBeGreaterThan(0);
    expect(behind).toHaveLength(0);
  });

  it("keeps the near side of the same body whole", () => {
    const lines = drawnEdges(nestedBoxes(), observer);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.from[2]).toBeGreaterThan(0);
      expect(line.to[2]).toBeGreaterThan(0);
    }
  });

  it("cuts a line where the body crosses it rather than dropping the whole of it", () => {
    // A bar passing behind the near box, long enough to stick out on both sides of it.
    const bar = boxAt([0, 0, -2], 0.2, 8);
    const stretched = bar.vertices.map((vertex): SolidPoint => [vertex[0] * 20, vertex[1], vertex[2]]);
    const near = boxAt([0, 0, 2], 1, 0);
    const triangles = [...near.triangles, ...bar.triangles];
    const drawn = triangles.flatMap((triangle) => [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as [number, number][]);
    const solid = buildModelSolid([...near.vertices, ...stretched], triangles, drawn)!;

    const alongBar = drawnEdges(solid, observer).filter((line) => line.from[2] < 0 && line.to[2] < 0 && Math.abs(line.from[0] - line.to[0]) > 1);
    expect(alongBar.length).toBeGreaterThan(0);
    // Each surviving stretch runs out to one end of the bar and stops short of the box covering it.
    for (const line of alongBar) {
      const inner = Math.min(Math.abs(line.from[0]), Math.abs(line.to[0]));
      expect(inner).toBeGreaterThan(0.5);
      expect(Math.max(Math.abs(line.from[0]), Math.abs(line.to[0]))).toBeCloseTo(4, 1);
    }
  });

  it("decides from the observer, so turning the camera round cannot restore a covered line", () => {
    const solid = nestedBoxes();

    // The same observer, asked twice, answers the same; a different one answers differently.
    expect(drawnEdges(solid, observer)).toEqual(drawnEdges(solid, observer));
    expect(drawnEdges(solid, [40, 0, 0]).length).not.toBe(drawnEdges(solid, observer).length);
  });
});

describe("isVertexVisible", () => {
  const observer: SolidPoint = [0, 0, 40];

  it("hides a point the body stands in front of and keeps one it does not", () => {
    const solid = nestedBoxes();

    // Corner of the near box, and the matching corner of the box hidden behind it.
    expect(isVertexVisible(solid, 4, observer)).toBe(true);
    expect(isVertexVisible(solid, 12, observer)).toBe(false);
  });
});

describe("a sculpted body's outline", () => {
  const observer: SolidPoint = [0, 0, 40];

  // A small body in front of a much larger one. The small one's edges are places the surface turns
  // away, so the facing test calls them silhouette - but they are not where the body ends, because
  // the larger body is behind them. Those are the edges that qualify for a fraction of a degree and
  // blink as a pilot moves.
  function nearAndFar(): GlyphSolid {
    const near = boxAt([0, 0, 6], 0.8, 0);
    const far = boxAt([0, 0, -2], 3, 8);
    return buildModelSolid([...near.vertices, ...far.vertices], [...near.triangles, ...far.triangles], [])!;
  }

  it("draws an unmarked edge only where the body ends, not where it passes in front of itself", () => {
    const solid = nearAndFar();
    const lines = drawnEdges(solid, observer);

    expect(lines.length).toBeGreaterThan(0);
    // Everything drawn belongs to the far body, whose edges are the outline; the near body turns
    // away too, but with something behind it, so none of its unmarked edges is a line.
    for (const line of lines) {
      expect(Math.max(Math.abs(line.from[0]), Math.abs(line.to[0]), Math.abs(line.from[1]), Math.abs(line.to[1]))).toBeCloseTo(3, 5);
    }
  });

  it("still draws a marked crease there, which is what keeps the near body readable", () => {
    const near = boxAt([0, 0, 6], 0.8, 0);
    const far = boxAt([0, 0, -2], 3, 8);
    const solid = buildModelSolid([...near.vertices, ...far.vertices], [...near.triangles, ...far.triangles], [[4, 5]])!;

    expect(drawnEdges(solid, observer).some((line) => line.from[2] > 5 || line.to[2] > 5)).toBe(true);
  });

  it("keeps the whole outline of a convex body, which is where it ends everywhere", () => {
    const box = boxAt([0, 0, 0], 1, 0);
    const solid = buildModelSolid(box.vertices, box.triangles, [])!;
    const visibility = classifyEdges(solid, observer);

    expect(drawnEdges(solid, observer)).toHaveLength(visibility.filter((seen) => seen === "silhouette").length);
  });
});

describe("classifyEdges", () => {
  // Marked along the near face, so what the facing test makes of the drawing can be counted.
  const cube = (marked: [number, number][]): GlyphSolid => buildModelSolid(boxAt([0, 0, 0], 1, 0).vertices, boxAt([0, 0, 0], 1, 0).triangles, marked)!;
  const NEAR_FACE: [number, number][] = [[4, 5], [5, 7], [7, 6], [6, 4]];
  const FAR_FACE: [number, number][] = [[0, 1], [1, 3], [3, 2], [2, 0]];

  it("draws a cube seen face on: the near face, whole", () => {
    expect(tally(cube(NEAR_FACE), [0, 0, 40])).toEqual({ silhouette: 4, interior: 0, hidden: 0 });
  });

  it("keeps the body's own far side off the drawing", () => {
    expect(tally(cube(FAR_FACE), [0, 0, 40])).toEqual({ silhouette: 0, interior: 0, hidden: 4 });
  });

  it("changes what is visible as the observer moves, and nothing else", () => {
    const solid = cube(NEAR_FACE);

    const near = classifyEdges(solid, [40, 40, 40]);
    const far = classifyEdges(solid, [-40, 10, -40]);

    // The whole promise of the body: a pilot who travels sees another side of the same object,
    // never a redrawn one.
    expect(near).not.toEqual(far);
    expect(cube(NEAR_FACE).vertices).toEqual(solid.vertices);
  });

  it("keeps the same edges hidden from anywhere along one line of sight", () => {
    const solid = cube(NEAR_FACE);

    // Camera distance must not enter into it: only the direction the observer lies in does.
    expect(classifyEdges(solid, [40, 40, 40])).toEqual(classifyEdges(solid, [400, 400, 400]));
  });

  it("hides the far side of a sculpted body seen from along its own plane", () => {
    const solid = readSigilModel(buildRing())!.solid;

    for (const observer of [[40, 0, 0], [-30, 5, -30]] as SolidPoint[]) {
      const counts = tally(solid, observer);

      expect(counts.hidden).toBeGreaterThan(0);
      expect(counts.silhouette + counts.interior).toBeGreaterThan(0);
    }
  });
});

describe("mapSolid", () => {
  it("moves positions with the frame and directions without its origin", () => {
    const box = boxAt([0, 0, 0], 1, 0);
    const solid = buildModelSolid(box.vertices, box.triangles, [[0, 1], [1, 3], [3, 2], [2, 0]])!;
    const offset: SolidPoint = [1e16, -2e16, 5e15];

    const mapped = mapSolid(
      solid,
      (point) => [point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]],
      (direction) => direction,
    );

    expect(mapped.vertices[0]).toEqual([solid.vertices[0][0] + offset[0], solid.vertices[0][1] + offset[1], solid.vertices[0][2] + offset[2]]);
    expect(mapped.faces[0].normal).toEqual(solid.faces[0].normal);
    // Classification has to survive the move, or a glyph would read differently in absolute space
    // than it did in its own frame.
    expect(classifyEdges(mapped, [offset[0], offset[1], offset[2] + 40])).toEqual(classifyEdges(solid, [0, 0, 40]));
  });
});
