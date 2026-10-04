import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type SolidPoint } from "./glyphSolid";
import { buildPacman, PACMAN } from "./sigilPacman";
import { readSigilModel } from "./sigilModel";
import { length } from "./sigilVectors";

const raw = buildPacman();
const pacman = readSigilModel(raw)!;

function radius(point: SolidPoint): number {
  return Math.hypot(point[0], point[1]);
}

describe("buildPacman", () => {
  it("is accepted as the pacman body", () => {
    expect(pacman).not.toBeNull();
    expect(pacman.name).toBe("pacman");
    expect(pacman.solid.faces.length).toBeGreaterThan(0);
  });

  it("closes the faceted volume and stays cheap enough for the facing test", () => {
    expect(pacman.solid.edges).toHaveLength((pacman.solid.faces.length * 3) / 2);
    for (const edge of pacman.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
    expect(pacman.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("is a round plate with an open wedge for a mouth, not a complete disc", () => {
    const vertices = pacman.solid.vertices;
    const outer = vertices.filter((vertex) => radius(vertex) > 0.8);
    const mouth = vertices.filter((vertex) => radius(vertex) < 0.2);

    expect(outer.length).toBeGreaterThanOrEqual(24);
    expect(mouth).toHaveLength(2);
    expect(Math.max(...vertices.map((vertex) => vertex[0]))).toBeGreaterThan(0.8);
    // No circumference vertices occupy the open wedge around the positive x axis: its furthest
    // forward points are the two mouth corners, safely above and below the missing middle.
    for (const vertex of outer.filter((point) => point[0] > 0.75)) expect(Math.abs(vertex[1])).toBeGreaterThan(0.25);
  });

  it("arrives centred with its farthest vertices on the unit sphere", () => {
    expect(Math.max(...pacman.solid.vertices.map(length))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const extent = pacman.solid.vertices.map((vertex) => vertex[axis]);
      expect(Math.min(...extent) + Math.max(...extent)).toBeCloseTo(0);
    }
  });

  it("marks the circular silhouette, both mouth lips, and their corners through the thickness", () => {
    const crossPlate = raw.drawn.filter(([from, to]) => Math.abs(raw.vertices[from][2] - raw.vertices[to][2]) > 1e-9);

    expect(crossPlate).toHaveLength(3);
    expect(raw.drawn.length).toBeGreaterThanOrEqual(2 * (PACMAN.segments + 2));
    expect(pacman.solid.edges.filter((edge) => edge.drawn).length).toBeLessThan(pacman.solid.edges.length);
  });

  it("offers four separated characteristic extremities as anchors", () => {
    const anchors = pacman.anchors.map((anchor) => anchor.position);

    expect(anchors.length).toBeGreaterThanOrEqual(4);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(Math.hypot(anchors[left][0] - anchors[right][0], anchors[left][1] - anchors[right][1])).toBeGreaterThan(0.45);
      }
    }
  });
});

describe("the pacman as an observer sees it", () => {
  it("shows a round outline interrupted by the two straight lips of its mouth", () => {
    const lines = drawnEdges(pacman.solid, [0, 0, 12]);
    const reachesCentre = lines.filter((line) => radius(line.from) < 0.2 || radius(line.to) < 0.2);

    expect(reachesCentre).toHaveLength(2);
    expect(lines.length).toBeGreaterThan(PACMAN.segments);
  });

  it("has real thickness and hides its far face", () => {
    const observer: SolidPoint = [0, 0, 12];
    const near = pacman.solid.vertices.findIndex((vertex) => vertex[1] < -0.7 && vertex[2] > 0);
    const far = pacman.solid.vertices.findIndex((vertex) => vertex[1] < -0.7 && vertex[2] < 0);

    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThanOrEqual(0);
    expect(isVertexVisible(pacman.solid, near, observer)).toBe(true);
    expect(isVertexVisible(pacman.solid, far, observer)).toBe(false);
  });
});
