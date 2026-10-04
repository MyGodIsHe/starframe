import { describe, expect, it } from "vitest";
import { classifyEdges, drawnEdges, type SolidPoint } from "./glyphSolid";
import { length, subtract } from "./sigilVectors";
import { readSigilModel } from "./sigilModel";
import { buildQuake, QUAKE } from "./sigilQuake";

const raw = buildQuake();
const quake = readSigilModel(raw)!;

// The drawing one observer is left, as a bag of lines: order is the solid's business, not the
// figure's. `through` turns the body over as it is read, so the far side of a figure symmetric
// through its own plane can be compared against the near side point for point.
function strokes(observer: SolidPoint, through = 1): string[] {
  return drawnEdges(quake.solid, observer)
    .map((line) => [line.from, line.to]
      .map((point) => [point[0], point[1], point[2] * through].map((value) => value.toFixed(4)).join(","))
      .sort()
      .join(" -> "))
    .sort();
}

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

  it("winds every face outwards, so the facing test works from either side", () => {
    // The arcs are mirrored copies, which turns a body inside out unless the winding is turned back
    // with it. A negative total says some part of the surface is reporting the wrong way round.
    let volume = 0;
    for (const face of quake.solid.faces) {
      const [a, b, c] = face.vertices.map((index) => quake.solid.vertices[index]);
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    expect(volume).toBeGreaterThan(0);
  });

  it("arrives centred with its farthest corner on the unit sphere", () => {
    expect(Math.max(...quake.solid.vertices.map(length))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const coordinates = quake.solid.vertices.map((vertex) => vertex[axis]);
      expect(Math.min(...coordinates) + Math.max(...coordinates)).toBeCloseTo(0);
    }
  });

  it("draws the same figure from behind as from in front", () => {
    // The body is symmetric through its own plane, so a pilot on either side must be shown the same
    // lines. A rim marked only on the front comes out solid from one side and hollow from the other.
    const front = strokes([0, 0, 6]);
    const back = strokes([0, 0, -6], -1);
    expect(front.length).toBeGreaterThan(40);
    expect(back).toEqual(front);
  });

  it("is one connected rune rather than separate horns and a blade", () => {
    const neighbours = quake.solid.vertices.map(() => new Set<number>());
    for (const edge of quake.solid.edges) {
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

    expect(reached.size).toBe(quake.solid.vertices.length);
  });

  it("sharpens each arc towards the crown and leaves it heaviest at the foot", () => {
    expect(QUAKE.from).toBeCloseTo(-QUAKE.to);
    expect(QUAKE.tip).toBeLessThan(QUAKE.root / 4);

    // The crown is the thin break and the foot the wide one, which is what tells this ring from a
    // letter C: the gap left by a sharpened tip is nothing like the gap left by a cut-off end.
    const crown = 2 * Math.sin(((90 - QUAKE.from) * Math.PI) / 180);
    const foot = 2 * Math.sin(((90 + QUAKE.to) * Math.PI) / 180);
    expect(crown).toBeCloseTo(foot);
    expect(QUAKE.tip).toBeLessThan(QUAKE.root);
  });

  it("grows the blade from the foot of the ring and reaches well past it", () => {
    const point = Math.min(...QUAKE.nail.map(([, y]) => y));
    const head = Math.max(...QUAKE.nail.map(([, y]) => y));
    expect(point).toBeLessThan(-1);
    expect(head).toBeLessThan(0);
    // Past the circle the arcs are cut from, so the point is the lowest thing in the figure.
    expect(point).toBeLessThan(-1.5);
    expect(Math.max(...QUAKE.nail.map(([x]) => x))).toBeLessThan(1);
  });

  it("uses its solid face to hide the outline on the far side", () => {
    const seen = classifyEdges(quake.solid, [0, 0, 6]);
    expect(seen.filter((visibility) => visibility === "hidden").length).toBeGreaterThan(0);
    expect(seen.filter((visibility) => visibility === "silhouette").length).toBeGreaterThan(0);
  });

  it("offers well-separated anchors on both arcs and on the blade", () => {
    expect(quake.anchors.length).toBeGreaterThanOrEqual(4);
    for (let left = 0; left < quake.anchors.length; left += 1) {
      for (let right = left + 1; right < quake.anchors.length; right += 1) {
        expect(length(subtract(quake.anchors[left].position, quake.anchors[right].position))).toBeGreaterThan(0.18);
      }
    }
  });
});
