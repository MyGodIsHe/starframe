import { describe, expect, it } from "vitest";
import { drawnEdges, type SolidPoint } from "./glyphSolid";
import { readSigilModel } from "./sigilModel";
import { buildSnowflake, SNOWFLAKE } from "./sigilSnowflake";
import { length } from "./sigilVectors";

const raw = buildSnowflake();
const snowflake = readSigilModel(raw)!;

function turn([x, y, z]: SolidPoint, angle: number): SolidPoint {
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z];
}

function same(left: SolidPoint, right: SolidPoint): boolean {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) < 1e-9;
}

function projectedInteriorsOverlap(first: readonly [SolidPoint, SolidPoint], second: readonly [SolidPoint, SolidPoint]): boolean {
  const cross = (a: SolidPoint, b: SolidPoint, c: SolidPoint): number =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const turns = [cross(first[0], first[1], second[0]), cross(first[0], first[1], second[1]), cross(second[0], second[1], first[0]), cross(second[0], second[1], first[1])];

  if (turns.every((value) => Math.abs(value) < 1e-9)) {
    const axis = Math.abs(first[1][0] - first[0][0]) >= Math.abs(first[1][1] - first[0][1]) ? 0 : 1;
    const firstRange = [first[0][axis], first[1][axis]].sort((left, right) => left - right);
    const secondRange = [second[0][axis], second[1][axis]].sort((left, right) => left - right);
    return Math.min(firstRange[1], secondRange[1]) - Math.max(firstRange[0], secondRange[0]) > 1e-9;
  }

  return turns[0] * turns[1] < -1e-12 && turns[2] * turns[3] < -1e-12;
}

describe("buildSnowflake", () => {
  it("is accepted as the snowflake Sigil Figure", () => {
    expect(snowflake).not.toBeNull();
    expect(snowflake.name).toBe("snowflake");
    expect(snowflake.solid.faces.length).toBeGreaterThan(0);
  });

  it("closes every piece, so the snowflake can hide its far side", () => {
    expect(snowflake.solid.edges).toHaveLength((snowflake.solid.faces.length * 3) / 2);
    for (const edge of snowflake.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("is one connected crystal rather than overlapping closed pieces", () => {
    const neighbours = snowflake.solid.vertices.map(() => new Set<number>());
    for (const edge of snowflake.solid.edges) {
      neighbours[edge.from].add(edge.to);
      neighbours[edge.to].add(edge.from);
    }

    const reached = new Set([0]);
    const pending = [0];
    while (pending.length > 0) {
      for (const neighbour of neighbours[pending.pop()!]) {
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        pending.push(neighbour);
      }
    }

    expect(reached.size).toBe(snowflake.solid.vertices.length);
  });

  it("stays within the facing-test budget", () => {
    expect(snowflake.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("puts the six ray tips on the unit sphere and uses them as meaningful anchors", () => {
    expect(Math.max(...snowflake.solid.vertices.map(length))).toBeCloseTo(1);
    expect(snowflake.anchors).toHaveLength(SNOWFLAKE.arms);

    for (const anchor of snowflake.anchors) {
      expect(length(anchor.position)).toBeCloseTo(1);
      expect(Math.abs(anchor.position[2])).toBeCloseTo(SNOWFLAKE.depth / Math.hypot(1, SNOWFLAKE.depth));
    }
  });

  it("has exact six-fold symmetry, including its characteristic branch edges", () => {
    const sixthTurn = (2 * Math.PI) / SNOWFLAKE.arms;

    for (const vertex of snowflake.solid.vertices) {
      const rotated = turn(vertex, sixthTurn);
      expect(snowflake.solid.vertices.some((candidate) => same(candidate, rotated))).toBe(true);
    }
  });

  it("joins the face contours through the depth at every ray and branch tip", () => {
    const depthEdges = raw.drawn.filter(([from, to]) =>
      Math.abs(raw.vertices[from][2] - raw.vertices[to][2]) > 1e-9);

    // Every arm has one main tip and two branch tips at each level.
    expect(depthEdges).toHaveLength(SNOWFLAKE.arms * (1 + 2 * SNOWFLAKE.branchLevels.length));
    for (const [from, to] of depthEdges) {
      expect(raw.vertices[from][0]).toBeCloseTo(raw.vertices[to][0]);
      expect(raw.vertices[from][1]).toBeCloseTo(raw.vertices[to][1]);
    }
  });

  it("shows equal edge detail from opposite sides", () => {
    for (const observer of [[0, 0, 12], [4, 0, 12], [12, 0, 4]] as const) {
      const opposite: SolidPoint = [-observer[0], -observer[1], -observer[2]];
      const visible = drawnEdges(snowflake.solid, observer);
      const reverse = drawnEdges(snowflake.solid, opposite);

      expect(reverse).toHaveLength(visible.length);
      expect(reverse.filter((line) => line.kind === "silhouette")).toHaveLength(
        visible.filter((line) => line.kind === "silhouette").length,
      );
    }
  });

  it("has no face-on lines crossing or lying over one another", () => {
    const observer: SolidPoint = [0, 0, 12];
    const project = (point: SolidPoint): SolidPoint => [
      point[0] / (observer[2] - point[2]),
      point[1] / (observer[2] - point[2]),
      0,
    ];
    const lines = drawnEdges(snowflake.solid, observer).map((line) => ({
      from: project(line.from),
      to: project(line.to),
    }));

    for (let first = 0; first < lines.length; first += 1) {
      for (let second = first + 1; second < lines.length; second += 1) {
        expect(projectedInteriorsOverlap(
          [lines[first].from, lines[first].to],
          [lines[second].from, lines[second].to],
        )).toBe(false);
      }
    }
  });

  it("is a shallow volume rather than flat line art", () => {
    const depths = snowflake.solid.vertices.map((vertex) => vertex[2]);
    const width = Math.max(...snowflake.solid.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1])));

    expect(Math.min(...depths)).toBeLessThan(0);
    expect(Math.max(...depths)).toBeGreaterThan(0);
    expect(Math.max(...depths) - Math.min(...depths)).toBeLessThan(width / 3);
  });
});
