import { describe, expect, it } from "vitest";
import { drawnEdges, type SolidPoint } from "./glyphSolid";
import { BIOHAZARD, buildBiohazard } from "./sigilBiohazard";
import { readSigilModel } from "./sigilModel";

const raw = buildBiohazard();
const biohazard = readSigilModel(raw)!;

function radius(point: SolidPoint): number {
  return Math.hypot(...point);
}

function distance(left: SolidPoint, right: SolidPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function turn(point: SolidPoint, angle: number): SolidPoint {
  return [
    point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
    point[0] * Math.sin(angle) + point[1] * Math.cos(angle),
    point[2],
  ];
}

const RING_VERTICES = BIOHAZARD.ring.around * BIOHAZARD.ring.through;
const LOBE_VERTICES = (BIOHAZARD.lobe.along + 1) * BIOHAZARD.lobe.through;

function verticesOf(body: number): readonly SolidPoint[] {
  if (body === 0) return raw.vertices.slice(0, RING_VERTICES);
  const start = RING_VERTICES + (body - 1) * LOBE_VERTICES;
  return raw.vertices.slice(start, start + LOBE_VERTICES);
}

describe("buildBiohazard", () => {
  it("builds the named Sigil Figure as a bounded closed body", () => {
    expect(biohazard).not.toBeNull();
    expect(biohazard.name).toBe("biohazard");
    expect(biohazard.solid.faces.length).toBeLessThanOrEqual(512);
    expect(Math.max(...biohazard.solid.vertices.map(radius))).toBeCloseTo(1);

    expect(biohazard.solid.edges).toHaveLength((biohazard.solid.faces.length * 3) / 2);
    for (const edge of biohazard.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("is a central open node and three broken circular lobes with clear negative gaps", () => {
    const ring = verticesOf(0);
    const lobes = [verticesOf(1), verticesOf(2), verticesOf(3)];

    expect(Math.min(...ring.map((point) => Math.hypot(point[0], point[1])))).toBeGreaterThan(0.12);
    const scale = 1 / (BIOHAZARD.lobe.centre + BIOHAZARD.lobe.radius + BIOHAZARD.lobe.thickness);
    for (const [index, lobe] of lobes.entries()) {
      expect(Math.min(...lobe.flatMap((point) => ring.map((ringPoint) => distance(point, ringPoint))))).toBeGreaterThan(0.04);
      const lobeCentre = turn([0, BIOHAZARD.lobe.centre * scale, 0], index * 2 * Math.PI / 3);
      const radii = lobe.map((point) => Math.hypot(point[0] - lobeCentre[0], point[1] - lobeCentre[1]));
      expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(BIOHAZARD.lobe.thickness * scale * 2.1);
    }
    for (let left = 0; left < lobes.length; left += 1) {
      for (let right = left + 1; right < lobes.length; right += 1) {
        expect(Math.min(...lobes[left].flatMap((point) => lobes[right].map((other) => distance(point, other))))).toBeGreaterThan(0.025);
      }
    }
  });

  it("repeats one lobe exactly three times around the central node", () => {
    const first = verticesOf(1);
    for (let copy = 1; copy < 3; copy += 1) {
      const expected = first.map((point) => turn(point, copy * 2 * Math.PI / 3));
      const actual = verticesOf(copy + 1);
      for (let index = 0; index < actual.length; index += 1) {
        expect(distance(actual[index], expected[index])).toBeLessThan(1e-9);
      }
    }
  });

  it("marks the ring rims, lobe sweeps, and blunt ends as characteristic strokes", () => {
    expect(raw.drawn.length).toBeGreaterThanOrEqual(BIOHAZARD.ring.around * 2 + BIOHAZARD.lobe.along * 3 * 2);
    expect(raw.drawn.length).toBeLessThan(biohazard.solid.edges.length / 2);
    expect(drawnEdges(biohazard.solid, [0, 0, 12]).length).toBeGreaterThan(raw.drawn.length / 3);
  });

  it("places at least four anchors on widely separated characteristic extremities", () => {
    expect(biohazard.anchors.length).toBeGreaterThanOrEqual(4);
    for (const anchor of biohazard.anchors) expect(radius(anchor.position)).toBeGreaterThan(0.3);
    for (let left = 0; left < biohazard.anchors.length; left += 1) {
      for (let right = left + 1; right < biohazard.anchors.length; right += 1) {
        expect(distance(biohazard.anchors[left].position, biohazard.anchors[right].position)).toBeGreaterThan(0.25);
      }
    }
  });
});
