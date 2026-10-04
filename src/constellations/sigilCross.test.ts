import { describe, expect, it } from "vitest";
import { drawnEdges, type SolidPoint } from "./glyphSolid";
import { buildCross, CROSS } from "./sigilCross";
import { readSigilModel } from "./sigilModel";
import { dot, length } from "./sigilVectors";

const raw = buildCross();
const cross = readSigilModel(raw)!;
const PROFILE_CORNERS = 12;
const SCALE = 1 / Math.hypot(CROSS.reach, CROSS.halfWidth, CROSS.halfDepth);

function acrossFace(point: SolidPoint): readonly [number, number] {
  return [Math.abs(point[0]), Math.abs(point[1])];
}

describe("buildCross", () => {
  it("is accepted as the cross Sigil Figure", () => {
    expect(cross).not.toBeNull();
    expect(cross.name).toBe("cross");
    expect(cross.solid.vertices).toHaveLength(2 * PROFILE_CORNERS + 2);
    expect(cross.solid.faces).toHaveLength(4 * PROFILE_CORNERS);
  });

  it("closes its triangular surface and stays below the figure budget", () => {
    expect(cross.solid.edges).toHaveLength((cross.solid.faces.length * 3) / 2);
    for (const edge of cross.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
    expect(cross.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("is centred and normalized into the unit sphere", () => {
    expect(Math.max(...cross.solid.vertices.map(length))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const coordinates = cross.solid.vertices.map((vertex) => vertex[axis]);
      expect(Math.min(...coordinates) + Math.max(...coordinates)).toBeCloseTo(0);
    }
  });

  it("has the equal four arms and square-ended outline of an аптечный cross", () => {
    const boundary = cross.solid.vertices.slice(0, 2 * PROFILE_CORNERS);
    const reach = CROSS.reach * SCALE;
    const width = CROSS.halfWidth * SCALE;

    for (const vertex of boundary) {
      const [x, y] = acrossFace(vertex);
      expect((Math.abs(x - reach) < 1e-9 && Math.abs(y - width) < 1e-9)
        || (Math.abs(x - width) < 1e-9 && Math.abs(y - reach) < 1e-9)
        || (Math.abs(x - width) < 1e-9 && Math.abs(y - width) < 1e-9)).toBe(true);
    }
    expect(Math.max(...boundary.map((vertex) => Math.abs(vertex[0])))).toBeCloseTo(reach);
    expect(Math.max(...boundary.map((vertex) => Math.abs(vertex[1])))).toBeCloseTo(reach);
    expect(CROSS.halfWidth).toBeGreaterThan(CROSS.reach / 4);
    expect(CROSS.halfWidth).toBeLessThan(CROSS.reach / 2);
  });

  it("has genuine depth and winds every face outward", () => {
    const depth = CROSS.halfDepth * SCALE;
    expect(new Set(cross.solid.vertices.map((vertex) => vertex[2].toFixed(9)))).toEqual(
      new Set([depth.toFixed(9), (-depth).toFixed(9)]),
    );

    for (const face of cross.solid.faces) {
      const outward: SolidPoint = Math.abs(face.normal[2]) > 0.9
        ? [0, 0, face.centre[2]]
        : [face.centre[0], face.centre[1], 0];
      expect(dot(face.normal, outward)).toBeGreaterThan(0);
    }
  });

  it("marks both cross contours and every corner carried through its depth", () => {
    expect(raw.drawn).toHaveLength(3 * PROFILE_CORNERS);
    const rails = raw.drawn.filter(([from, to]) => Math.abs(raw.vertices[from][2] - raw.vertices[to][2]) > 1e-9);

    expect(rails).toHaveLength(PROFILE_CORNERS);
    for (const [from, to] of rails) {
      expect(raw.vertices[from][0]).toBeCloseTo(raw.vertices[to][0]);
      expect(raw.vertices[from][1]).toBeCloseTo(raw.vertices[to][1]);
    }
  });

  it("anchors one characteristic extremity on each of its four arms", () => {
    const anchors = cross.anchors.map((anchor) => anchor.position);
    const reach = CROSS.reach * SCALE;

    expect(anchors).toHaveLength(4);
    expect(anchors.filter((anchor) => Math.abs(anchor[0] - reach) < 1e-9)).toHaveLength(1);
    expect(anchors.filter((anchor) => Math.abs(anchor[0] + reach) < 1e-9)).toHaveLength(1);
    expect(anchors.filter((anchor) => Math.abs(anchor[1] - reach) < 1e-9)).toHaveLength(1);
    expect(anchors.filter((anchor) => Math.abs(anchor[1] + reach) < 1e-9)).toHaveLength(1);
    for (const anchor of anchors) expect(length(anchor)).toBeCloseTo(1);
  });

  it("shows the plus-shaped near contour face-on without drawing its far contour through the body", () => {
    const lines = drawnEdges(cross.solid, [0, 0, 12]);
    const endpoints = lines.flatMap((line) => [line.from, line.to]);
    const reach = CROSS.reach * SCALE;

    expect(lines.length).toBeGreaterThan(0);
    expect(Math.max(...endpoints.map((point) => point[0]))).toBeCloseTo(reach);
    expect(Math.min(...endpoints.map((point) => point[0]))).toBeCloseTo(-reach);
    expect(Math.max(...endpoints.map((point) => point[1]))).toBeCloseTo(reach);
    expect(Math.min(...endpoints.map((point) => point[1]))).toBeCloseTo(-reach);
    expect(Math.min(...endpoints.map((point) => point[2]))).toBeGreaterThan(0);
  });

  it.each([
    [[0, 0, 12], [0, 0, -12]],
    [[12, 0, 0], [-12, 0, 0]],
  ] as const)("renders the same amount of edge detail from opposite sides", (firstObserver, oppositeObserver) => {
    const first = drawnEdges(cross.solid, firstObserver);
    const opposite = drawnEdges(cross.solid, oppositeObserver);

    expect(first.length).toBeGreaterThan(0);
    expect(opposite).toHaveLength(first.length);
    expect(opposite.filter((line) => line.kind === "silhouette")).toHaveLength(
      first.filter((line) => line.kind === "silhouette").length,
    );
  });
});
