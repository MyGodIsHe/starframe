import { describe, expect, it } from "vitest";
import { buildBody, buildLathe, buildPrism, classifyEdges, isClosedStroke, mapSolid, spanAt, type GlyphSolid, type SolidPoint } from "./glyphSolid";

// A unit cube, as the square outline a Sigil Figure would close, extruded through the Glyph Frame.
const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;

// Wide at the foot, narrow at the head: a shape whose side view has to differ from a rectangle.
const CONE = [[-1, -1], [1, -1], [0.2, 1], [-0.2, 1], [-1, -1]] as const;

// An outline with a bite out of it, where a fan from the centre would lay triangles over sky the
// body does not fill.
const CONCAVE = [[-1, -1], [1, -1], [1, 1], [0.2, 1], [0.2, -0.2], [-0.2, -0.2], [-0.2, 1], [-1, 1], [-1, -1]] as const;

function tally(solid: GlyphSolid, observer: SolidPoint): Record<string, number> {
  const visibility = classifyEdges(solid, observer);
  const counts: Record<string, number> = { silhouette: 0, interior: 0, hidden: 0 };
  solid.edges.forEach((edge, position) => {
    if (edge.drawn) counts[visibility[position]] += 1;
  });
  return counts;
}

// Half the body's reach across the axis at one height, as the two views would see it.
function reachAt(solid: GlyphSolid, y: number, axis: 0 | 2): number {
  let reach = 0;
  for (const vertex of solid.vertices) {
    if (Math.abs(vertex[1] - y) > 0.25) continue;
    reach = Math.max(reach, Math.abs(vertex[axis]));
  }
  return reach;
}

function capArea(solid: GlyphSolid): number {
  let total = 0;
  for (const face of solid.faces) {
    const [a, b, c] = face.vertices.map((index) => solid.vertices[index]);
    // Only the caps lie in a plane of constant depth; the walls stand across it.
    if (a[2] !== b[2] || b[2] !== c[2] || a[2] <= 0) continue;
    total += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  return total;
}

describe("buildBody", () => {
  it("closes the body, so every edge has two faces to be hidden by", () => {
    const solid = buildPrism(SQUARE, 1)!;

    expect(solid.vertices).toHaveLength(8);
    for (const edge of solid.edges) {
      expect(edge.faces[0]).not.toBe(edge.faces[1]);
      for (const face of edge.faces) expect(face).toBeLessThan(solid.faces.length);
    }
  });

  it("draws the figure's own edges and not the triangulation holding it together", () => {
    const solid = buildPrism(SQUARE, 1)!;

    // Twelve edges of a cube, however many triangles the surface was cut into.
    expect(solid.edges.filter((edge) => edge.drawn)).toHaveLength(12);
    expect(solid.edges.filter((edge) => !edge.drawn).length).toBeGreaterThan(0);
  });

  it("points every normal outward whichever way the stroke was wound", () => {
    for (const outline of [SQUARE, [...SQUARE].reverse()]) {
      for (const face of buildPrism(outline, 1)!.faces) {
        const outward = face.normal[0] * face.centre[0] + face.normal[1] * face.centre[1] + face.normal[2] * face.centre[2];
        expect(outward).toBeGreaterThan(0);
      }
    }
  });

  it("fills a concave outline without covering the bite taken out of it", () => {
    const solid = buildBody(CONCAVE, CONCAVE.map(() => 1))!;

    // The outline encloses 3.52 of the 4 square units it spans; a fan from the centre would have
    // claimed the whole span and occluded the 0.48 unit notch.
    expect(capArea(solid)).toBeCloseTo(3.52, 5);
  });

  it("takes its thickness from the half-depths, so the side view is not the front view", () => {
    const tapered = buildBody(SQUARE, [0.9, 0.9, 0.15, 0.15, 0.9])!;

    expect(reachAt(tapered, -1, 2)).toBeGreaterThan(0.8);
    expect(reachAt(tapered, 1, 2)).toBeLessThan(0.2);
    // The front outline is untouched by any of it: that is the artwork.
    expect(reachAt(tapered, -1, 0)).toBeCloseTo(1, 6);
    expect(reachAt(tapered, 1, 0)).toBeCloseTo(1, 6);
  });

  it("refuses a stroke with no area to give a body", () => {
    expect(buildPrism([[0, 0], [1, 1], [0, 0]], 1)).toBeNull();
    expect(buildPrism([[0, 0], [1, 0], [2, 0], [0, 0]], 1)).toBeNull();
    expect(buildPrism(SQUARE, 0)).toBeNull();
  });
});

describe("buildLathe", () => {
  it("turns the outline's own half-width, so a tapered figure tapers from every side", () => {
    const solid = buildLathe(CONE)!;

    // Wide at the foot and narrow at the head, across the figure and through it alike - which a
    // straight extrusion could never be.
    for (const axis of [0, 2] as const) {
      expect(reachAt(solid, 0.8, axis)).toBeLessThan(reachAt(solid, -0.8, axis) * 0.6);
      expect(reachAt(solid, -0.8, axis)).toBeGreaterThan(0.6);
    }
  });

  it("reads the same seen from the front and from the side", () => {
    const solid = buildLathe(CONE)!;

    for (const y of [-0.8, 0, 0.8]) expect(reachAt(solid, y, 2)).toBeCloseTo(reachAt(solid, y, 0), 1);
  });

  it("is closed at both ends, so nothing shows through the axis", () => {
    const solid = buildLathe(CONE)!;

    for (const edge of solid.edges) expect(edge.faces).toHaveLength(2);
    expect(solid.edges.filter((edge) => edge.drawn).length).toBeGreaterThan(20);
  });

  it("refuses an outline with no height to turn", () => {
    expect(buildLathe([[-1, 0], [1, 0], [0, 0], [-1, 0]])).toBeNull();
  });
});

describe("classifyEdges", () => {
  it("draws a square seen face on: the outline only", () => {
    expect(tally(buildPrism(SQUARE, 1)!, [0, 0, 40])).toEqual({ silhouette: 4, interior: 0, hidden: 8 });
  });

  it("draws a cube seen from a corner: six outline edges, three near ones, three lost behind it", () => {
    expect(tally(buildPrism(SQUARE, 1)!, [40, 40, 40])).toEqual({ silhouette: 6, interior: 3, hidden: 3 });
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

  it("hides about half a turned body, from any side", () => {
    const solid = buildLathe(CONE)!;

    for (const observer of [[40, 0, 0], [0, 10, 40], [-30, 5, -30]] as SolidPoint[]) {
      const counts = tally(solid, observer);
      const drawn = counts.silhouette + counts.interior;
      expect(counts.hidden).toBeGreaterThan(0);
      expect(drawn).toBeGreaterThan(0);
      expect(counts.silhouette).toBeGreaterThan(0);
    }
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

describe("spanAt", () => {
  it("bounds the outline at a height, across a bite as well as a solid part", () => {
    expect(spanAt(SQUARE, 0)).toEqual([-1, 1]);
    expect(spanAt(CONCAVE, 0.5)).toEqual([-1, 1]);
    expect(spanAt(SQUARE, 9)).toBeNull();
  });
});

describe("isClosedStroke", () => {
  it("tells an outline that can carry a body from a line that cannot", () => {
    expect(isClosedStroke(SQUARE)).toBe(true);
    expect(isClosedStroke([[0, -1], [0, 1]])).toBe(false);
    expect(isClosedStroke([[-0.4, 0.5], [0, 1], [0.4, 0.5]])).toBe(false);
  });
});
