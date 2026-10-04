import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { HAMMER, buildHammer } from "./sigilHammer";
import { readSigilModel } from "./sigilModel";
import { cross, dot, length, subtract, unit } from "./sigilVectors";

const hammer = readSigilModel(buildHammer())!;
const raw = buildHammer();

const HEAD_SECTIONS = HAMMER.head.sections.length;
const HAFT_SECTIONS = HAMMER.haft.length;
// Four corners at every station and a cap centre at each end; two triangles for every facet of every
// band, and a fan of four into each cap.
const HEAD_VERTICES = 4 * HEAD_SECTIONS + 2;
const HEAD_FACES = 8 * (HEAD_SECTIONS - 1) + 8;
const HAFT_FACES = 8 * (HAFT_SECTIONS - 1) + 8;

// The body is centred and then sized by its own reach, so the proportions it was written from have to
// be recovered before anything can be measured against them. The first vertex built is a corner of
// the head's first section, which gives both back: how far it stands off the figure's upright is the
// scale, and what is left over along that upright is the shift.
const REACH = HAMMER.head.length / Math.abs(raw.vertices[0][0]);
const SHIFT = HAMMER.head.height + HAMMER.head.rise * HAMMER.head.sections[0].size - raw.vertices[0][1] * REACH;

/** A point of the body, back in the space the proportions above are written in. */
function authored(point: SolidPoint): SolidPoint {
  return [point[0] * REACH, point[1] * REACH + SHIFT, point[2] * REACH];
}

/** Which of the two bodies a vertex belongs to. The head is built first, so this is arithmetic. */
function bodyOf(vertex: number): "head" | "haft" {
  return vertex < HEAD_VERTICES ? "head" : "haft";
}

// The size a run has where it passes one point along its own axis, or null past either end of it: the
// loft interpolated the way the surface between two stations interpolates.
function sizeAt(run: readonly (readonly [number, number])[], at: number, slack: number): number | null {
  const stations = [...run].sort((left, right) => left[0] - right[0]);
  if (at < stations[0][0] - slack || at > stations[stations.length - 1][0] + slack) return null;

  for (let index = 0; index + 1 < stations.length; index += 1) {
    const [from, near] = stations[index];
    const [to, far] = stations[index + 1];
    if (at > to) continue;
    return near + ((far - near) * (at - from)) / (to - from);
  }
  return stations[stations.length - 1][1];
}

/** Whether a point stands inside the head: within the section the loft has where it stands. */
function insideHead(point: SolidPoint, slack: number): boolean {
  const { height, length: reach, rise, depth, sections } = HAMMER.head;
  const size = sizeAt(sections.map((section) => [section.at * reach, section.size] as const), point[0], slack);

  return size !== null && Math.abs(point[1] - height) <= rise * size + slack && Math.abs(point[2]) <= depth * size + slack;
}

/** Whether a point stands inside the grip, which is the same question asked down the upright. */
function insideHaft(point: SolidPoint, slack: number): boolean {
  const width = sizeAt(HAMMER.haft.map((section) => [section.at, section.width] as const), point[1], slack);

  return width !== null && Math.abs(point[0]) <= width + slack && Math.abs(point[2]) <= width + slack;
}

function inside(body: "head" | "haft", point: SolidPoint, slack: number): boolean {
  return body === "head" ? insideHead(point, slack) : insideHaft(point, slack);
}

function radius(point: SolidPoint): number {
  return length(point);
}

function same(left: SolidPoint, right: SolidPoint): boolean {
  return length(subtract(left, right)) < 1e-9;
}

/** The head's own underside where the grip comes out of it. */
function underside(): number {
  const size = sizeAt(HAMMER.head.sections.map((section) => [section.at * HAMMER.head.length, section.size] as const), 0, 1e-9)!;
  return HAMMER.head.height - HAMMER.head.rise * size;
}

/** Where the head's strike axis stands once the body is centred: level with it is level with the head. */
const HEAD_AXIS = (HAMMER.head.height - SHIFT) / REACH;

// The same drawing, measured so two observers can be compared: the lengths of the lines they get.
function drawnLengths(observer: SolidPoint): string {
  return drawnEdges(hammer.solid, observer).map((line) => length(subtract(line.from, line.to)).toFixed(9)).sort().join(",");
}

// The narrowest the drawing ever gets: over observers walked right round the figure, and for each of
// them over every direction across their view. A body that reads from everywhere never gets thin; one
// that is really flat art has a side it disappears on.
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

describe("buildHammer", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(hammer).not.toBeNull();
    expect(hammer.name).toBe("hammer");
    expect(hammer.solid.faces).toHaveLength(HEAD_FACES + HAFT_FACES);
    expect(hammer.solid.vertices).toHaveLength(HEAD_VERTICES + 4 * HAFT_SECTIONS + 2);
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face, whether it is one body or
    // two of them.
    expect(hammer.solid.edges).toHaveLength((hammer.solid.faces.length * 3) / 2);
    for (const edge of hammer.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    expect(hammer.solid.faces.length).toBeLessThanOrEqual(192);
  });

  it("arrives centred, with its farthest point on the unit sphere", () => {
    expect(Math.max(...hammer.solid.vertices.map(radius))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const spread = hammer.solid.vertices.map((vertex) => vertex[axis]);

      expect(Math.min(...spread) + Math.max(...spread)).toBeCloseTo(0);
    }
  });

  it("is a head and a haft - two bodies, so one can cover the part of the other driven into it", () => {
    const bodies = new Set<string>();
    for (const edge of hammer.solid.edges) {
      // No face ever joins them, which is what lets the head hide the end of the grip.
      expect(bodyOf(edge.from)).toBe(bodyOf(edge.to));
      bodies.add(bodyOf(edge.from));
    }

    expect(bodies).toEqual(new Set(["head", "haft"]));
  });

  it("lofts the head along the axis it strikes on, every corner on the section standing there", () => {
    const head = hammer.solid.vertices.filter((_, vertex) => bodyOf(vertex) === "head").map(authored);

    expect(head).toHaveLength(HEAD_VERTICES);
    for (const vertex of head) {
      expect(insideHead(vertex, 1e-9)).toBe(true);
      // And on the surface rather than within it: a body, not a cloud of points inside a box.
      expect(insideHead(vertex, -1e-6)).toBe(false);
    }
    // The head is longer than it is tall and taller than it is deep, which is the proportion that
    // makes it read as this hammer rather than as a mallet.
    expect(HAMMER.head.length).toBeGreaterThan(1.6 * HAMMER.head.rise);
    expect(HAMMER.head.rise).toBeGreaterThan(HAMMER.head.depth);
  });

  it("runs the haft down the upright as a square bar, out of the middle of the head", () => {
    const haft = hammer.solid.vertices.filter((_, vertex) => bodyOf(vertex) === "haft").map(authored);

    expect(haft).toHaveLength(4 * HAFT_SECTIONS + 2);
    for (const vertex of haft) {
      expect(insideHaft(vertex, 1e-9)).toBe(true);
      expect(insideHaft(vertex, -1e-6)).toBe(false);
      // Square: the grip is as deep as it is wide, so no view of it is the thin one.
      expect(Math.abs(vertex[0])).toBeCloseTo(Math.abs(vertex[2]));
    }
    // Thin enough to be a grip rather than a second block.
    expect(Math.max(...HAMMER.haft.map((section) => section.width))).toBeLessThan(HAMMER.head.rise / 2);
  });

  it("drives the grip into the head and brings it back out exactly at the head's underside", () => {
    const [buried, emerging] = [HAMMER.haft[0], HAMMER.haft[1]];

    // The top of the grip stands inside the head, which is what hafted means.
    expect(insideHead([0, buried.at, 0], 0)).toBe(true);
    // And the station below it stands on the head's own surface. Whether a stretch of the grip is
    // drawn at all is answered once for the whole stretch, so a stretch half inside the head would be
    // answered inside and dropped, leaving the grip hanging a facet short of the block.
    expect(emerging.at).toBeCloseTo(underside());
    for (const section of HAMMER.haft.slice(2)) expect(insideHead([0, section.at, 0], 0)).toBe(false);
  });

  it("winds every face outward, which is what lets the facing test read the body at all", () => {
    const probe = 0.004;
    for (const [index, face] of hammer.solid.faces.entries()) {
      const body = index < HEAD_FACES ? "head" : "haft";
      const step = (side: number): SolidPoint => authored([
        face.centre[0] + face.normal[0] * probe * side,
        face.centre[1] + face.normal[1] * probe * side,
        face.centre[2] + face.normal[2] * probe * side,
      ]);

      // A step along the normal leaves the body and a step against it stays inside, which is the
      // whole of what outward means - and it holds for the flat caps too, where there is no centre
      // line to measure away from.
      expect(inside(body, step(1), 0)).toBe(false);
      expect(inside(body, step(-1), 0)).toBe(true);
    }
  });

  it("marks the head's long corners and its two rims, and nothing across the grip", () => {
    const rings = (sections: readonly { ring: boolean }[]): number => sections.filter((section) => section.ring).length;

    expect(raw.drawn).toHaveLength(4 * (HEAD_SECTIONS - 1) + 4 * rings(HAMMER.head.sections) + 4 * rings(HAMMER.haft));
    for (const [from, to] of raw.drawn) expect(bodyOf(from)).toBe(bodyOf(to));
    // A rail runs the length of the head from one section to the next; a ring stands within one
    // section. Nothing else is marked, and the grip carries rings alone: its own four corners would
    // be three lines down a stroke two lines wide.
    for (const [from, to] of raw.drawn) {
      const span = Math.abs(authored(hammer.solid.vertices[from])[0] - authored(hammer.solid.vertices[to])[0]);

      if (bodyOf(from) === "haft") expect(authored(hammer.solid.vertices[from])[1]).toBeCloseTo(authored(hammer.solid.vertices[to])[1]);
      else expect(span > 1e-9 || HAMMER.head.sections.some((section) => Math.abs(section.at * HAMMER.head.length - authored(hammer.solid.vertices[from])[0]) < 1e-9)).toBe(true);
    }
  });

  it("anchors the corners of both rims and the butt of the grip", () => {
    const anchors = hammer.anchors.map((anchor) => anchor.position);

    expect(anchors).toHaveLength(5);
    // The head stands above the middle of the figure, so of the four rim corners it is the two upper
    // ones that reach farthest - onto the unit sphere, where a figure's farthest point goes - and the
    // two lower ones stand well inside them. The butt is the one anchor on the figure's own upright.
    expect(anchors.filter((anchor) => Math.abs(radius(anchor) - 1) < 1e-6)).toHaveLength(2);
    const butt = anchors.find((anchor) => Math.abs(anchor[0]) < 1e-9)!;
    expect(butt[2]).toBeCloseTo(0);
    expect(butt[1]).toBeLessThan(-0.5);
    expect(Math.min(...anchors.map(radius))).toBeGreaterThan(0.55);

    // One diagonal of each rim, and opposite diagonals at the two ends: spread over all three axes,
    // and unchanged as a set by the hammer's own half-turn about its upright.
    const turned = anchors.map((anchor): SolidPoint => [-anchor[0], anchor[1], -anchor[2]]);
    for (const anchor of turned) expect(anchors.some((other) => length(subtract(other, anchor)) < 1e-9)).toBe(true);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(length(subtract(anchors[left], anchors[right]))).toBeGreaterThan(0.5);
      }
    }
  });

  it("is its own mirror image in both the planes it is drawn in", () => {
    const mirrors: ((point: SolidPoint) => SolidPoint)[] = [
      (point) => [-point[0], point[1], point[2]],
      (point) => [point[0], point[1], -point[2]],
    ];

    for (const mirror of mirrors) {
      for (const vertex of hammer.solid.vertices) expect(hammer.solid.vertices.some((other) => same(other, mirror(vertex)))).toBe(true);
      // The surface with it, not only its corners: the mirror of any point of the body stands on the
      // body, pointing the mirrored way out of it.
      for (const [index, face] of hammer.solid.faces.entries()) {
        const body = index < HEAD_FACES ? "head" : "haft";
        const centre = mirror(face.centre);
        const normal = mirror(face.normal);
        const step = (side: number): SolidPoint => authored([centre[0] + normal[0] * 0.004 * side, centre[1] + normal[1] * 0.004 * side, centre[2] + normal[2] * 0.004 * side]);

        expect(inside(body, step(1), 0)).toBe(false);
        expect(inside(body, step(-1), 0)).toBe(true);
      }
    }
  });

  it("keeps the way a facet was cut into triangles out of the drawing", () => {
    // Which diagonal a four-cornered facet is split along cannot be mirrored - flip the facet and the
    // diagonal becomes the other one - so a body built this way is its own mirror image as a surface
    // and never as a triangulation. It costs nothing, because every facet of a box tube is flat: both
    // triangles of one point the same way, so the diagonal between them is never where the body turns
    // away, and an edge that is not a crease is only ever drawn there.
    const flat = hammer.solid.edges.filter((edge) => same(hammer.solid.faces[edge.faces[0]].normal, hammer.solid.faces[edge.faces[1]].normal));

    expect(flat.length).toBeGreaterThan(0);
    for (const edge of flat) expect(edge.drawn).toBe(false);
  });
});

describe("the hammer as an observer sees it", () => {
  const around: SolidPoint[] = Array.from({ length: 8 }, (_, step) => {
    const angle = (2 * Math.PI * step) / 8;
    return [Math.sin(angle) * 11, 2.6, Math.cos(angle) * 11];
  });

  it("hides the far side of the head rather than drawing through it", () => {
    // Level with the head, so neither its top nor its underside is in sight and what is left is a
    // block seen square on. Every line of the head is then on its near half.
    const observer: SolidPoint = [0, HEAD_AXIS, 12];
    const head = drawnEdges(hammer.solid, observer).filter((line) => authored(line.from)[1] > underside() && authored(line.to)[1] > underside());

    expect(head.length).toBeGreaterThan(0);
    expect(Math.min(...head.flatMap((line) => [line.from[2], line.to[2]]))).toBeGreaterThan(0);
  });

  it("hides the stretch of grip driven into the head, from wherever the observer stands", () => {
    const buried = [0, 1, 2, 3].map((corner) => HEAD_VERTICES + corner);

    for (const observer of [...around, [0, 12, 0.01] as SolidPoint, [0.01, -12, 0] as SolidPoint]) {
      for (const vertex of buried) expect(isVertexVisible(hammer.solid, vertex, observer)).toBe(false);
    }
  });

  it("cuts the grip where the head stands in front of it", () => {
    // A line that starts or ends away from any vertex of the body was cut there, and the only thing
    // that can cut one is something of the figure standing between it and the observer. The facing
    // test cannot do this: the grip faces the observer the whole way up into the head.
    const atAVertex = (point: SolidPoint): boolean => hammer.solid.vertices.some((vertex) => length(subtract(vertex, point)) < 1e-9);
    const cut = drawnEdges(hammer.solid, [0, HEAD_AXIS, 12]).filter((line) => !atAVertex(line.from) || !atAVertex(line.to));

    expect(cut.length).toBeGreaterThan(0);
    // What is cut is the grip, and what is left of it runs up to the head's underside rather than
    // stopping short of it - a little past it, in fact, because from a finite distance the head's own
    // near bottom edge stands in front of slightly more of the grip than its surface does.
    for (const line of cut) {
      const top = Math.max(authored(line.from)[1], authored(line.to)[1]);

      expect(top).toBeLessThanOrEqual(underside() + 1e-9);
      expect(top).toBeGreaterThan(underside() - 0.05);
    }
  });

  it("is as wide as the head is deep when turned down its own strike axis, and never thinner", () => {
    // What a block promises and a drawing cannot. A bolt turned into its own plane is the depth of
    // its bar; a hammer has no such side - the narrowest view of it is the head seen end on, which is
    // still most of the head's own height across.
    expect(thinnestView(hammer.solid)).toBeCloseTo((2 * HAMMER.head.depth) / REACH, 2);
    expect(thinnestView(hammer.solid)).toBeGreaterThan(0.5);
  });

  it("gives the two sides of each of its own planes the same drawing, mirrored", () => {
    // The symmetry, read back off the drawing rather than off the body: an observer and their
    // reflection in either plane of the figure get the same lines, as mirror images of each other.
    for (const observer of around) {
      expect(drawnLengths([observer[0], observer[1], -observer[2]])).toBe(drawnLengths(observer));
      expect(drawnLengths([-observer[0], observer[1], observer[2]])).toBe(drawnLengths(observer));
    }
  });

  it("turns with the observer, which is the whole of Glyph Parallax", () => {
    const front: SolidPoint = [0, 2.6, 11];

    // A quarter turn either way, which is nobody's reflection of the first: face on the hammer is its
    // head across the view, and down the strike axis it is the head end on.
    expect(drawnLengths([11, 2.6, 0])).not.toBe(drawnLengths(front));
    expect(drawnLengths([-11, 2.6, 0])).not.toBe(drawnLengths(front));
    // And a figure with volume changes when the observer rises, not only when they walk round it.
    expect(drawnLengths([0, 9, 7])).not.toBe(drawnLengths(front));
  });
});
