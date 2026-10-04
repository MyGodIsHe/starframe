import { describe, expect, it } from "vitest";
import { length, subtract } from "./sigilVectors";
import { readSigilModel } from "./sigilModel";
import { buildQuake, QUAKE } from "./sigilQuake";

const raw = buildQuake();
const quake = readSigilModel(raw)!;

describe("buildQuake", () => {
  it("is accepted as the procedural Quake sigil", () => {
    expect(quake).not.toBeNull();
    expect(quake.name).toBe("quake");
  });

  it("is a closed coarse volume", () => {
    expect(quake.solid.faces.length).toBeLessThanOrEqual(512);
    expect(quake.solid.edges).toHaveLength((quake.solid.faces.length * 3) / 2);
    for (const edge of quake.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("arrives centred with its farthest corner on the unit sphere", () => {
    expect(Math.max(...quake.solid.vertices.map(length))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const coordinates = quake.solid.vertices.map((vertex) => vertex[axis]);
      expect(Math.min(...coordinates) + Math.max(...coordinates)).toBeCloseTo(0);
    }
  });

  it("draws an angular ring with a deliberate break around a much longer lower point", () => {
    expect(QUAKE.outer).toHaveLength(QUAKE.inner.length);
    expect(QUAKE.outer.length).toBeGreaterThanOrEqual(7);
    expect(QUAKE.outer[0][1]).toBe(QUAKE.outer.at(-1)?.[1]);
    expect(QUAKE.inner[0][1]).toBe(QUAKE.inner.at(-1)?.[1]);

    const bladeBottom = Math.min(...QUAKE.blade.map((point) => point[1]));
    const ringBottom = Math.min(...QUAKE.outer.map((point) => point[1]));
    const ringTop = Math.max(...QUAKE.outer.map((point) => point[1]));
    expect(ringBottom - bladeBottom).toBeGreaterThan((ringTop - ringBottom) / 2);
    expect(raw.drawn.length).toBeGreaterThan(QUAKE.outer.length * 4);
  });

  it("offers well-separated anchors on the crown, broken ring and piercing blade", () => {
    expect(quake.anchors.length).toBeGreaterThanOrEqual(4);
    for (let left = 0; left < quake.anchors.length; left += 1) {
      for (let right = left + 1; right < quake.anchors.length; right += 1) {
        expect(length(subtract(quake.anchors[left].position, quake.anchors[right].position))).toBeGreaterThan(0.18);
      }
    }
  });
});
