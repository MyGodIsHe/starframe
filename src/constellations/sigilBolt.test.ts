import { describe, expect, it } from "vitest";
import { drawnEdges, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { BOLT, buildBolt } from "./sigilBolt";
import { readSigilModel } from "./sigilModel";
import { add, cross, dot, length, mix, scale, subtract, unit } from "./sigilVectors";

const bolt = readSigilModel(buildBolt())!;
const raw = buildBolt();

// The body is sized by its own reach, so the zigzag it was forged along has to be sized the same way
// before anything can be measured against it. The head of the bolt is the first vertex built and is
// the path's first point exactly, which gives the scale back.
const SCALE = length(raw.vertices[0] as SolidPoint) / length(BOLT.path[0]);
const centres = BOLT.path.map((centre) => scale(centre, SCALE));

// How far the mitre at an elbow opens the section out: a section square to the average of two limbs
// is narrower than the limbs by the cosine of half their turn, and is opened back up by that much.
function mitreAt(index: number): number {
  const arriving = unit(subtract(centres[index], centres[index - 1]));
  const leaving = unit(subtract(centres[index + 1], centres[index]));
  return 1 / dot(unit(add(arriving, leaving)), leaving);
}

// Which section of the bar a vertex belongs to. The head is built first and the tail last, with one
// whole section for each elbow in between, so this is arithmetic rather than a search.
function sectionOf(vertex: number): number {
  return vertex === 0 ? -1 : vertex > BOLT.sides * (BOLT.path.length - 2) ? BOLT.path.length : Math.floor((vertex - 1) / BOLT.sides);
}

/** How far a point of the surface stands off the bolt's own centre line. */
function offTheLine(point: SolidPoint, centres: readonly SolidPoint[]): number {
  let best = Infinity;
  for (let index = 0; index + 1 < centres.length; index += 1) {
    const span = subtract(centres[index + 1], centres[index]);
    const reach = dot(span, span);
    const along = reach > 0 ? Math.min(1, Math.max(0, dot(subtract(point, centres[index]), span) / reach)) : 0;
    best = Math.min(best, length(subtract(point, mix(centres[index], centres[index + 1], along))));
  }
  return best;
}

// The section is a diamond, so its corners stand on the bar's own axes rather than at the corners of
// a box: the farthest of them is the wider of the two half-sizes, with the elbow's mitre opening the
// width out.
const section = Math.max(BOLT.width * Math.max(mitreAt(1), mitreAt(2)), BOLT.depth) * SCALE;

describe("buildBolt", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(bolt).not.toBeNull();
    expect(bolt.name).toBe("bolt");
    // Two sections joined for every straight stretch, and a fan of triangles into each point.
    expect(bolt.solid.faces).toHaveLength(BOLT.sides * (2 * (centres.length - 3) + 2));
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face.
    expect(bolt.solid.edges).toHaveLength((bolt.solid.faces.length * 3) / 2);
    for (const edge of bolt.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    expect(bolt.solid.faces.length).toBeLessThanOrEqual(64);
  });

  it("puts its points on the unit sphere, where a figure's farthest point goes", () => {
    expect(Math.max(...bolt.solid.vertices.map(length))).toBeCloseTo(1);
  });

  it("is forged along its own zigzag: no point of it stands further off the line than its section", () => {
    for (const vertex of bolt.solid.vertices) expect(offTheLine(vertex, centres)).toBeLessThanOrEqual(section + 1e-9);
    // And it is a body rather than a wire: the widest part of it stands the full section off.
    expect(Math.max(...bolt.solid.vertices.map((vertex) => offTheLine(vertex, centres)))).toBeCloseTo(section);
  });

  it("is two wedges: a point at each end, a whole section at each elbow", () => {
    expect(bolt.solid.vertices).toHaveLength(2 + BOLT.sides * (centres.length - 2));
    // The ends of the path carry one vertex each, which is the point itself.
    expect(bolt.solid.vertices[0]).toEqual(centres[0]);
    expect(bolt.solid.vertices[bolt.solid.vertices.length - 1]).toEqual(centres[centres.length - 1]);
    // An elbow carries a whole section, every corner of it standing off that elbow and no further
    // than the section's own reach.
    for (let elbow = 1; elbow + 1 < centres.length; elbow += 1) {
      const standing = bolt.solid.vertices.filter((_, vertex) => sectionOf(vertex) === elbow - 1);

      expect(standing).toHaveLength(BOLT.sides);
      for (const corner of standing) {
        expect(length(subtract(corner, centres[elbow]))).toBeLessThanOrEqual(section + 1e-9);
        expect(length(subtract(corner, centres[elbow]))).toBeGreaterThanOrEqual(BOLT.depth * SCALE - 1e-9);
      }
    }
  });

  it("is its own mirror image in the plane its silhouette lies in", () => {
    const mirrored = (point: SolidPoint): SolidPoint => [point[0], point[1], -point[2]];
    const same = (left: SolidPoint, right: SolidPoint): boolean => length(subtract(left, right)) < 1e-9;

    // The zigzag is flat in that plane, and nothing of the body is anywhere but either side of it.
    for (const centre of centres) expect(centre[2]).toBeCloseTo(0);
    for (const vertex of bolt.solid.vertices) expect(bolt.solid.vertices.some((other) => same(other, mirrored(vertex)))).toBe(true);
    // Face for face as well, or the two sides would be the same shape wound differently and the
    // facing test would read one of them inside out.
    for (const face of bolt.solid.faces) {
      expect(bolt.solid.faces.some((other) => same(other.centre, mirrored(face.centre)) && same(other.normal, mirrored(face.normal)))).toBe(true);
    }
  });

  it("comes to a point at both ends rather than stopping at a face", () => {
    const tips = [raw.anchors[0], raw.anchors[1]];

    for (const tip of tips) {
      // One vertex, with the whole fan of the point's faces meeting at it.
      expect(raw.triangles.filter((triangle) => triangle.includes(tip))).toHaveLength(BOLT.sides);
      expect(offTheLine(bolt.solid.vertices[tip], centres)).toBeCloseTo(0);
    }
  });

  it("winds every face outward, which is what lets the facing test read the body at all", () => {
    for (const face of bolt.solid.faces) {
      const outward = subtract(face.centre, nearest(face.centre));

      expect(dot(face.normal, outward)).toBeGreaterThan(0);
    }
  });

  it("marks the ridge that runs the length of the bolt, and nothing across it", () => {
    // Two ridge rails for every stretch of the bar, and nothing else marked at all.
    expect(raw.drawn).toHaveLength(2 * (centres.length - 1));
    // A rail runs from one section of the bar to the next, or from a section out to a point. An edge
    // joining two corners of the same section would be a line drawn across the stroke, and there is
    // no such thing in the drawing: the section is only what holds the surface together.
    for (const [from, to] of raw.drawn) expect(sectionOf(from)).not.toBe(sectionOf(to));
  });

  it("anchors the two points and the outer corner of each elbow", () => {
    expect(bolt.anchors).toHaveLength(4);
    const reach = bolt.anchors.map((anchor) => length(anchor.position));

    expect(Math.max(...reach)).toBeCloseTo(1);
    // The elbows stand well inside the points, which is what keeps the four from bunching.
    expect(Math.min(...reach)).toBeLessThan(0.85);
  });
});

function nearest(point: SolidPoint): SolidPoint {
  let best = centres[0];
  let gap = Infinity;
  for (let index = 0; index + 1 < centres.length; index += 1) {
    const span = subtract(centres[index + 1], centres[index]);
    const reach = dot(span, span);
    const along = reach > 0 ? Math.min(1, Math.max(0, dot(subtract(point, centres[index]), span) / reach)) : 0;
    const candidate = mix(centres[index], centres[index + 1], along);
    const distance = length(subtract(point, candidate));
    if (distance < gap) [best, gap] = [candidate, distance];
  }
  return best;
}

// The narrowest the drawing ever gets: over observers walked right round the figure, and for each of
// them over every direction across their view. A body that reads from everywhere never gets thin;
// one that is really flat art has a side it disappears on.
function thinnestView(solid: GlyphSolid): number {
  let narrowest = Infinity;
  for (let step = 0; step < 12; step += 1) {
    const angle = (2 * Math.PI * step) / 12;
    for (const height of [0.4, 2.6, 6]) {
      const observer: SolidPoint = [Math.sin(angle) * 11, height, Math.cos(angle) * 11];
      const view = unit(observer);
      const sideways = unit(cross([0, 1, 0], view));
      const rising = cross(view, sideways);
      const screen = drawnEdges(solid, observer).flatMap((line) => [line.from, line.to]).map((point) => [dot(point, sideways), dot(point, rising)]);
      for (let turn = 0; turn < 18; turn += 1) {
        const axis = (Math.PI * turn) / 18;
        const spread = screen.map(([across, up]) => across * Math.cos(axis) + up * Math.sin(axis));
        narrowest = Math.min(narrowest, Math.max(...spread) - Math.min(...spread));
      }
    }
  }
  return narrowest;
}

describe("the bolt as an observer sees it", () => {
  const around: SolidPoint[] = Array.from({ length: 8 }, (_, step) => {
    const angle = (2 * Math.PI * step) / 8;
    return [Math.sin(angle) * 11, 2.6, Math.cos(angle) * 11];
  });

  it("is as thin as its own bar when turned edge on, and no thinner", () => {
    // What a figure symmetrical in its own plane is: turned until that plane runs through the
    // observer, the bolt is the depth of its bar and nothing more. It is the ridge that carries the
    // relief, not a path leaning out of the plane, and this is the price of that.
    expect(thinnestView(bolt.solid)).toBeCloseTo(2 * BOLT.depth * SCALE, 1);
  });

  it("gives the two sides of its own plane the same drawing, mirrored", () => {
    // The symmetry, read back off the drawing rather than off the body: an observer and their
    // reflection in the figure's plane get the same lines, as mirror images of each other.
    const lengths = (observer: SolidPoint): string => drawnEdges(bolt.solid, observer).map((line) => length(subtract(line.from, line.to)).toFixed(9)).sort().join(",");

    for (const observer of around) expect(lengths([observer[0], observer[1], -observer[2]])).toBe(lengths(observer));
  });

  it("turns with the observer, which is the whole of Glyph Parallax", () => {
    const lengths = (observer: SolidPoint): string => drawnEdges(bolt.solid, observer).map((line) => length(subtract(line.from, line.to)).toFixed(6)).sort().join(",");
    const front: SolidPoint = [0, 2.6, 11];

    // A quarter turn either way, which is nobody's reflection of the first.
    expect(lengths([11, 2.6, 0])).not.toBe(lengths(front));
    expect(lengths([-11, 2.6, 0])).not.toBe(lengths(front));
  });

  it("hides the far side of its own bar rather than drawing through it", () => {
    // Face on, the near edge of the stroke and the ridge behind it are both there to be drawn; what
    // is behind the bar is not. Every line of the drawing is on the near half of the body.
    const observer: SolidPoint = [0, 0, 12];
    const behind = drawnEdges(bolt.solid, observer).filter((line) => Math.min(line.from[2], line.to[2]) < -0.5);

    expect(drawnEdges(bolt.solid, observer).length).toBeGreaterThan(0);
    expect(behind).toHaveLength(0);
  });
});
