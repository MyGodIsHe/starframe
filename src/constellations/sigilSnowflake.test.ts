import { describe, expect, it } from "vitest";
import { type SolidPoint } from "./glyphSolid";
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

    // Every arm carries two levels, forked to both sides, in addition to its long central ray.
    expect(raw.drawn.length).toBeGreaterThanOrEqual(SNOWFLAKE.arms * (1 + 2 * SNOWFLAKE.branchLevels.length));
  });

  it("is a shallow volume rather than flat line art", () => {
    const depths = snowflake.solid.vertices.map((vertex) => vertex[2]);
    const width = Math.max(...snowflake.solid.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1])));

    expect(Math.min(...depths)).toBeLessThan(0);
    expect(Math.max(...depths)).toBeGreaterThan(0);
    expect(Math.max(...depths) - Math.min(...depths)).toBeLessThan(width / 3);
  });
});
