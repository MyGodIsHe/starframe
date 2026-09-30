import { describe, expect, it } from "vitest";
import { buildPrism, classifyEdges, isClosedStroke, mapSolid, type SolidPoint } from "./glyphSolid";

// A unit cube, as the square outline a Sigil Figure would close, extruded through the Glyph Frame.
const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;

function tally(visibility: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = { silhouette: 0, interior: 0, hidden: 0 };
  for (const entry of visibility) counts[entry] += 1;
  return counts;
}

describe("buildPrism", () => {
  it("closes the body, so every edge has two faces to be hidden by", () => {
    const solid = buildPrism(SQUARE, 1)!;

    expect(solid.vertices).toHaveLength(8);
    expect(solid.faces).toHaveLength(6);
    expect(solid.edges).toHaveLength(12);
    for (const edge of solid.edges) {
      expect(edge.faces[0]).not.toBe(edge.faces[1]);
      for (const face of edge.faces) expect(solid.faces[face].vertices).toContain(edge.from);
    }
  });

  it("points every normal outward whichever way the stroke was wound", () => {
    const solid = buildPrism(SQUARE, 1)!;
    const reversed = buildPrism([...SQUARE].reverse(), 1)!;

    for (const face of [...solid.faces, ...reversed.faces]) {
      const outward = face.normal[0] * face.centre[0] + face.normal[1] * face.centre[1] + face.normal[2] * face.centre[2];
      expect(outward).toBeGreaterThan(0);
    }
  });

  it("refuses a stroke with no area to extrude", () => {
    expect(buildPrism([[0, 0], [1, 1], [0, 0]], 1)).toBeNull();
    expect(buildPrism([[0, 0], [1, 0], [2, 0], [0, 0]], 1)).toBeNull();
    expect(buildPrism(SQUARE, 0)).toBeNull();
  });
});

describe("classifyEdges", () => {
  it("draws a square seen face on: the outline only", () => {
    const solid = buildPrism(SQUARE, 1)!;

    expect(tally(classifyEdges(solid, [0, 0, 40]))).toEqual({ silhouette: 4, interior: 0, hidden: 8 });
  });

  it("draws a cube seen from a corner: six outline edges, three near ones, three lost behind it", () => {
    const solid = buildPrism(SQUARE, 1)!;

    expect(tally(classifyEdges(solid, [40, 40, 40]))).toEqual({ silhouette: 6, interior: 3, hidden: 3 });
  });

  it("changes what is visible as the observer moves, and nothing else", () => {
    const solid = buildPrism(SQUARE, 1)!;

    const near = classifyEdges(solid, [40, 40, 40]);
    const far = classifyEdges(solid, [-40, 10, -40]);

    // The whole promise of the body: a pilot who travels sees another side of the same object,
    // never a redrawn one.
    expect(near).not.toEqual(far);
    expect(buildPrism(SQUARE, 1)!.vertices).toEqual(solid.vertices);
  });

  it("keeps the same edges hidden from anywhere along one line of sight", () => {
    const solid = buildPrism(SQUARE, 1)!;

    // Camera distance must not enter into it: only the direction the observer lies in does.
    expect(classifyEdges(solid, [40, 40, 40])).toEqual(classifyEdges(solid, [400, 400, 400]));
  });
});

describe("mapSolid", () => {
  it("moves positions with the frame and directions without its origin", () => {
    const solid = buildPrism(SQUARE, 1)!;
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

describe("isClosedStroke", () => {
  it("tells an outline that can carry a body from a line that cannot", () => {
    expect(isClosedStroke(SQUARE)).toBe(true);
    expect(isClosedStroke([[0, -1], [0, 1]])).toBe(false);
    expect(isClosedStroke([[-0.4, 0.5], [0, 1], [0.4, 0.5]])).toBe(false);
  });
});
