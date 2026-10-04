import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { angleAt, buildCheese, CHEESE, cheeseHollows, HOLE_RINGS, LEVELS, rimOf, type CheeseHollow } from "./sigilCheese";
import { readSigilModel } from "./sigilModel";
import { add, cross, dot, length, scale, subtract, unit } from "./sigilVectors";

const raw = buildCheese();
const cheese = readSigilModel(raw)!;
const hollows = cheeseHollows(CHEESE);
const rim = rimOf(CHEESE);
const { rings, columns, holes, pockets, thickness, spread } = CHEESE;

// What the lattice comes to. A hole takes a block of cells and gives back a ring of material with a
// facet per corner; a block of m by n cells has 2(m + n) points round it, so a hole through a face
// has as many corners as the width it was given and a pocket as many as the run of rim it took. The
// apex stands in a fan, where a ring of cells would have no inner edge to stand on, and every cell
// no hole took is two triangles.
const MOUTH_CORNERS = holes.map((hole) => 2 * (HOLE_RINGS + hole.columns));
const POCKET_CORNERS = pockets.map((pocket) => 2 * (pocket.rings + pocket.levels));
const CORNERS = hollows.reduce((total, hollow) => total + hollow.rim.length, 0);
const FREE_CELLS = (rings.length - 2) * columns - holes.reduce((total, hole) => total + HOLE_RINGS * hole.columns, 0);
const RIBBONS = MOUTH_CORNERS.reduce((total, corners) => total + 2 * corners, 0);
const FACE_TRIANGLES = columns + 2 * FREE_CELLS + RIBBONS;
// The skin standing on the rim is two cells deep, so a pocket has a block to be cut out of. A bore
// joins its two mouths into a tube; a pocket closes on a cone inside the ring of material round it.
const POCKETS = hollows.length - 2 * holes.length;
const SKIN_TRIANGLES = 2 * (LEVELS * rim.length - pockets.reduce((total, pocket) => total + pocket.rings * pocket.levels, 0));
const HOLE_TRIANGLES = RIBBONS + 3 * POCKET_CORNERS.reduce((total, corners) => total + corners, 0);
// Every ring but the first carries a point per column, the first is the apex, and the points in the
// middle of a block are the hole and are never made. The skin adds one more point a step across its
// own middle, except where a pocket took it.
const LATTICE_POINTS = 2 * (1 + (rings.length - 1) * (columns + 1) - holes.reduce((total, hole) => total + (HOLE_RINGS - 1) * (hole.columns - 1), 0));

// The body is laid on its side, centred and then sized by its own reach, so the proportions it was
// written from have to be recovered before anything can be measured against them. The first vertex
// built is the apex on the near face, which gives both back: how far it stands off the middle of
// the figure is the scale, and what is left over along the slice is the shift.
const REACH = -thickness / raw.vertices[0][1];
const SHIFT = -raw.vertices[0][2] * REACH;

/** A point of the body, back in the frame the slice's own proportions are written in. */
function authored(point: SolidPoint): SolidPoint {
  return [point[0] * REACH, point[2] * REACH + SHIFT, -point[1] * REACH];
}

/** And back again, so an observer can be put somewhere the slice's own numbers name. */
function figure(point: SolidPoint): SolidPoint {
  return [point[0] / REACH, -point[2] / REACH, (point[1] - SHIFT) / REACH];
}

const LOW = angleAt(CHEESE, 0);
const HIGH = angleAt(CHEESE, columns);

// The flat sides the slice really has, each as the plane it lies in and the way out of it: the two
// cuts out of the apex, the two faces, and the arc, which is a run of chords rather than a curve. A
// facet of the arc is flat, and a point on one stands inside the circle the sector was cut from,
// which is the difference between the shape the options describe and the shape the body is.
const SIDES: readonly { normal: SolidPoint; at: number }[] = [
  { normal: [Math.sin(LOW), -Math.cos(LOW), 0], at: 0 },
  { normal: [-Math.sin(HIGH), Math.cos(HIGH), 0], at: 0 },
  { normal: [0, 0, 1], at: thickness },
  { normal: [0, 0, -1], at: thickness },
  ...Array.from({ length: columns }, (_, column) => ({
    normal: [Math.cos(angleAt(CHEESE, column + 0.5)), Math.sin(angleAt(CHEESE, column + 0.5)), 0] as SolidPoint,
    at: rings[rings.length - 1] * Math.cos(spread / columns),
  })),
];

/** How far a point stands past one side of the slice: positive outside it, zero on it. */
function past(side: { normal: SolidPoint; at: number }, point: SolidPoint): number {
  return dot(side.normal, point) - side.at;
}

// How far a point stands inside a hole, in the hole's own terms: positive within it, zero on its
// wall, negative in the material round it. A bore is the prism its mouth cuts clean through the
// slice; a pocket is the cone standing on the same mouth, closed off under the cut. Both are
// convex, so the answer is however far it stands inside the nearest of their own walls.
function intoHollow(hollow: CheeseHollow, point: SolidPoint): number {
  const apex = add(hollow.centre, scale(hollow.into, hollow.depth ?? 0));
  const walls = hollow.rim.map((corner, step) => {
    const next = hollow.rim[(step + 1) % hollow.rim.length];
    const along = hollow.depth === null ? hollow.into : subtract(apex, corner);
    return { at: corner, normal: unit(cross(along, subtract(next, corner))) };
  });
  // A pocket is closed at the mouth as well, so nothing standing clear of the cut counts as being
  // in it. A bore has no such wall: it goes right through.
  const mouth = hollow.depth === null ? [] : [{ at: hollow.centre, normal: scale(hollow.into, -1) }];

  return -Math.max(...[...walls, ...mouth].map((wall) => dot(wall.normal, subtract(point, wall.at))));
}

/** Whether a point stands in the slice: within the sector and its thickness, and in no hole. */
function inside(point: SolidPoint, slack: number): boolean {
  return SIDES.every((side) => past(side, point) <= slack) && hollows.every((hollow) => intoHollow(hollow, point) <= slack);
}

/** Whether a point stands on a corner of one hole's mouth. */
function onMouth(hollow: CheeseHollow, point: SolidPoint): boolean {
  return hollow.rim.some((corner) => length(subtract(corner, point)) < 1e-9);
}

/** The bottom of a pocket, which is where the cone it closes on comes to a point. */
function bottomOf(hollow: CheeseHollow): SolidPoint {
  return add(hollow.centre, scale(hollow.into, hollow.depth ?? 0));
}

function same(left: SolidPoint, right: SolidPoint): boolean {
  return length(subtract(left, right)) < 1e-9;
}

// The same drawing, measured so two observers can be compared: the lengths of the lines they get.
function drawnLengths(observer: SolidPoint): string {
  return drawnEdges(cheese.solid, observer).map((line) => length(subtract(line.from, line.to)).toFixed(9)).sort().join(",");
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
        const across = screen.map(([sideward, upward]) => sideward * Math.cos(axis) + upward * Math.sin(axis));
        narrowest = Math.min(narrowest, Math.max(...across) - Math.min(...across));
      }
    }
  }
  return narrowest;
}

describe("buildCheese", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(cheese).not.toBeNull();
    expect(cheese.name).toBe("cheese");
    expect(cheese.solid.faces).toHaveLength(2 * FACE_TRIANGLES + SKIN_TRIANGLES + HOLE_TRIANGLES);
    expect(cheese.solid.vertices.length).toBeGreaterThan(LATTICE_POINTS + CORNERS + POCKETS);
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face - holes bored through it
    // included, because a bore is a wall and not a gap in the surface. Where the holes do show up
    // is in the count itself: a surface with two ways through it closes two short of a sphere.
    expect(cheese.solid.edges).toHaveLength((cheese.solid.faces.length * 3) / 2);
    for (const edge of cheese.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
    expect(cheese.solid.vertices.length - cheese.solid.edges.length + cheese.solid.faces.length).toBe(2 - 2 * holes.length);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    expect(cheese.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("arrives centred, with its farthest point on the unit sphere", () => {
    expect(Math.max(...cheese.solid.vertices.map(length))).toBeCloseTo(1);
    for (const axis of [0, 1, 2] as const) {
      const reach = cheese.solid.vertices.map((vertex) => vertex[axis]);

      expect(Math.min(...reach) + Math.max(...reach)).toBeCloseTo(0);
    }
  });

  it("is an eighth of a turn of a slice lying on one unbroken broad face", () => {
    // The slice somebody cuts rather than the quarter a diagram draws, and thinner than it is long.
    expect(2 * spread).toBeCloseTo(Math.PI / 4);
    expect(2 * thickness).toBeLessThan(rings[rings.length - 1]);
    for (const vertex of cheese.solid.vertices.map(authored)) {
      expect(inside(vertex, 1e-9)).toBe(true);
      // And on the surface rather than within it: a body, not a cloud of points inside a wedge.
      expect(inside(vertex, -1e-6)).toBe(false);
    }
    // Laid down, so the holes run up the figure's own upright and an observer meets them first: the
    // slice is as wide and as long as the sector says, and only a thickness tall.
    const reach = (axis: 0 | 1 | 2): number => Math.max(...cheese.solid.vertices.map((vertex) => Math.abs(vertex[axis])));

    expect(reach(1)).toBeCloseTo(thickness / REACH);
    expect(reach(1)).toBeLessThan(reach(0) / 1.4);
    expect(reach(1)).toBeLessThan(reach(2) / 1.4);
  });

  it("winds every face outward, which is what lets the facing test read the body at all", () => {
    const probe = 0.004;
    for (const face of cheese.solid.faces) {
      const step = (side: number): SolidPoint => authored([
        face.centre[0] + face.normal[0] * probe * side,
        face.centre[1] + face.normal[1] * probe * side,
        face.centre[2] + face.normal[2] * probe * side,
      ]);

      // A step along the normal leaves the material and a step against it stays in, which is the
      // whole of what outward means - and inside a hole that is the same test read backwards: the
      // wall of a hole faces the hole, because the material is on the other side of it.
      expect(inside(step(1), 0)).toBe(false);
      expect(inside(step(-1), 0)).toBe(true);
    }
  });

  it("cuts every hole with a corner per point of its block, round rather than that block's shape", () => {
    for (const [index, hollow] of hollows.entries()) {
      const spokes = hollow.rim.map((corner) => length(subtract(corner, hollow.centre)));

      expect(hollow.rim).toHaveLength(hollow.depth === null ? MOUTH_CORNERS[Math.floor(index / 2)] : POCKET_CORNERS[index - 2 * holes.length]);
      // Every corner the same distance out is a circle, whatever the block it was cut from: a block
      // out near the arc is far wider than it is tall, and a hole stretched to fill it would read
      // as a slot cut in the slice.
      for (const spoke of spokes) expect(spoke).toBeCloseTo(spokes[0]);
      const sectors = hollow.rim.map((corner, step) => {
        const next = hollow.rim[(step + 1) % hollow.rim.length];
        return Math.acos(dot(unit(subtract(corner, hollow.centre)), unit(subtract(next, hollow.centre))));
      });
      for (const sector of sectors) expect(sector).toBeCloseTo((2 * Math.PI) / hollow.rim.length);
      // And the mouth lies in the face it is cut in, square to the way the hole was bored.
      for (const corner of hollow.rim) expect(dot(subtract(corner, hollow.centre), hollow.into)).toBeCloseTo(0);
    }
  });

  it("keeps both broad faces whole and cuts three shallow holes into each side", () => {
    const bores = hollows.filter((hollow) => hollow.depth === null);
    const pockets = hollows.filter((hollow) => hollow.depth !== null);

    expect(bores).toHaveLength(0);
    expect(pockets).toHaveLength(6);
    expect(pockets.filter((pocket) => pocket.into[0] < 0)).toHaveLength(3);
    expect(pockets.filter((pocket) => pocket.into[0] > 0)).toHaveLength(3);
    for (const pocket of pockets) {
      // Deep enough to read as the half of a bubble, shallow enough to stay a dish rather than a
      // drilling - and the material closes over it, which is what makes it a pocket at all.
      expect(pocket.depth!).toBeGreaterThan(0);
      expect(pocket.depth!).toBeLessThan(length(subtract(pocket.rim[0], pocket.centre)));
      expect(pocket.into[2]).toBeCloseTo(0);
      expect(inside(add(bottomOf(pocket), scale(pocket.into, 1e-6)), 0)).toBe(true);
    }
    const diameters = pockets.map((pocket) => (2 * length(subtract(pocket.rim[0], pocket.centre))).toFixed(6));
    expect(new Set(diameters).size).toBeGreaterThanOrEqual(3);
  });

  it("leaves material round every hole, so no hole cuts into the next or out of the slice", () => {
    // Every corner of every mouth stands in the material, and so does the bottom of every pocket.
    for (const hollow of hollows) {
      for (const corner of hollow.rim) expect(inside(corner, 1e-9)).toBe(true);
      if (hollow.depth !== null) expect(inside(bottomOf(hollow), 1e-9)).toBe(true);
    }
    // The thinnest web anywhere, measured from the wall of each hole out to the sides of the slice
    // and across to every other hole. Sampled down each wall rather than round its mouth, because a
    // pocket leans into the slice and a bore runs the whole way through it.
    const walls = hollows.map((hollow) => hollow.rim.flatMap((corner) => [0, 0.25, 0.5, 0.75, 1].map((step) => (hollow.depth === null
      ? add(corner, scale(hollow.into, 2 * thickness * step))
      : add(add(hollow.centre, scale(subtract(corner, hollow.centre), 1 - step)), scale(hollow.into, hollow.depth! * step))))));
    const web = Math.min(...hollows.flatMap((hollow, index) => walls[index].flatMap((point) => [
      // The sides a hole is cut through are no measure of anything - it opens in them - so what is
      // measured is the sides it runs beside, and every hole but itself.
      ...SIDES.filter((side) => Math.abs(dot(side.normal, hollow.into)) < 1e-9).map((side) => -past(side, point)),
      ...hollows.filter((other) => intoHollow(other, point) < -1e-9).map((other) => -intoHollow(other, point)),
    ])));
    const across = hollows.map((hollow) => 2 * length(subtract(hollow.rim[0], hollow.centre)));

    expect(web).toBeGreaterThan(0.025);
    // Six side holes of clearly visible but non-destructive sizes.
    expect(hollows).toHaveLength(6);
    expect(Math.min(...across)).toBeGreaterThan(rings[rings.length - 1] / 12);
    expect(Math.max(...across)).toBeLessThan(rings[rings.length - 1] / 3);
  });

  it("marks the rim of every face and every hole, and nothing across the material", () => {
    expect(raw.drawn).toHaveLength(2 * rim.length + CORNERS + 3 * LEVELS);
    const cornersThroughThickness = raw.drawn.filter(([from, to]) => {
      const near = authored(raw.vertices[from]);
      const far = authored(raw.vertices[to]);
      return Math.abs(near[0] - far[0]) < 1e-9 && Math.abs(near[1] - far[1]) < 1e-9 && Math.abs(near[2] - far[2]) > 1e-9;
    });

    // Only the wedge's three real corners run through its thickness. The intermediate lattice
    // sites still hold the surface together without drawing stripes across either cut.
    expect(cornersThroughThickness).toHaveLength(3 * LEVELS);
    for (const [from, to] of raw.drawn) {
      const near = authored(cheese.solid.vertices[from]);
      const far = authored(cheese.solid.vertices[to]);
      // A line of the figure runs along one flat side of the slice, where the material ends, or
      // round the mouth of one hole. Nothing is marked down a bore, into a pocket or across a face.
      const alongASide = SIDES.some((side) => Math.abs(past(side, near)) < 1e-9 && Math.abs(past(side, far)) < 1e-9);

      const throughACorner = Math.abs(near[0] - far[0]) < 1e-9 && Math.abs(near[1] - far[1]) < 1e-9;
      expect(alongASide || throughACorner || hollows.some((hollow) => onMouth(hollow, near) && onMouth(hollow, far))).toBe(true);
    }
    for (const hollow of hollows) {
      expect(raw.drawn.filter(([from, to]) => [from, to].every((vertex) => onMouth(hollow, authored(cheese.solid.vertices[vertex]))))).toHaveLength(hollow.rim.length);
    }
  });

  it("anchors the apex and the three points of the arc, taking a face at a time", () => {
    const anchors = cheese.anchors.map((anchor) => anchor.position);

    expect(anchors).toHaveLength(4);
    // The two ends of the arc are where the slice reaches farthest, so they land on the unit sphere;
    // the apex and the middle of the arc stand well inside them.
    expect(anchors.filter((anchor) => Math.abs(length(anchor) - 1) < 1e-6)).toHaveLength(2);
    expect(Math.min(...anchors.map(length))).toBeGreaterThan(0.6);
    // Each extremity gives up one of its two faces, and which one it gives up alternates round the
    // figure, so no two anchors stand a thickness apart on the same spot.
    for (let left = 0; left < anchors.length; left += 1) {
      expect(Math.sign(authored(anchors[left])[2])).toBe(left % 2 === 0 ? 1 : -1);
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(length(subtract(anchors[left], anchors[right]))).toBeGreaterThan(1);
      }
    }
    // And the set is unchanged by the mirror the figure itself is unchanged by, so a Solar System
    // lands in the same place whichever way round the fit reads it.
    for (const anchor of anchors) {
      expect(anchors.some((other) => same(other, [-anchor[0], anchor[1], anchor[2]]))).toBe(true);
    }
  });

  it("places the holes asymmetrically between the two sides", () => {
    const left = pockets.filter((pocket) => pocket.side === "left");
    const right = pockets.filter((pocket) => pocket.side === "right");

    expect(new Set(left.map((pocket) => pocket.level)).size).toBe(3);
    expect(new Set(right.map((pocket) => pocket.level)).size).toBe(3);
    expect(left.map((pocket) => pocket.ring)).not.toEqual(right.map((pocket) => pocket.ring));
    expect(left.map((pocket) => pocket.level)).not.toEqual(right.map((pocket) => pocket.level));
    expect(left.map((pocket) => pocket.bore)).not.toEqual(right.map((pocket) => pocket.bore));
  });

  it("keeps the way a facet was cut into triangles out of the drawing", () => {
    // Every face of the slice is flat, so the diagonal splitting a facet is never where the body
    // turns away, and an edge that is not a crease is only ever drawn there.
    const flat = cheese.solid.edges.filter((edge) => same(cheese.solid.faces[edge.faces[0]].normal, cheese.solid.faces[edge.faces[1]].normal));

    expect(flat.length).toBeGreaterThan(0);
    for (const edge of flat) expect(edge.drawn).toBe(false);
  });
});

describe("the cheese as an observer sees it", () => {
  const around: SolidPoint[] = Array.from({ length: 8 }, (_, step) => {
    const angle = (2 * Math.PI * step) / 8;
    return [Math.sin(angle) * 11, 2.6, Math.cos(angle) * 11];
  });

  it("shows the bottom of a pocket, and never daylight through one", () => {
    for (const pocket of hollows.filter((hollow) => hollow.depth !== null)) {
      const observer = figure(add(pocket.centre, scale(pocket.into, -4)));
      const found = (point: SolidPoint): number => cheese.solid.vertices.findIndex((vertex) => same(authored(vertex), point));

      // The whole mouth and the bottom it closes on are in sight: a cut through a bubble is a dish,
      // and an observer standing over it sees all of it.
      expect(found(bottomOf(pocket))).toBeGreaterThanOrEqual(0);
      expect(isVertexVisible(cheese.solid, found(bottomOf(pocket)), observer)).toBe(true);
      for (const corner of pocket.rim) expect(isVertexVisible(cheese.solid, found(corner), observer)).toBe(true);
    }
  });

  it("is two thicknesses across when turned edge on, and never thinner", () => {
    // What a slab promises and a drawing cannot. The narrowest view of the slice is its own edge,
    // which is still a third of the figure across - a little over two thicknesses, because the
    // lowest observer this sweep takes still looks at it from slightly above.
    expect(thinnestView(cheese.solid)).toBeGreaterThan((2 * thickness) / REACH);
    expect(thinnestView(cheese.solid)).toBeLessThan((2.2 * thickness) / REACH);
  });

  it("shows different drawings from its two irregular sides", () => {
    // The radial sides no longer mirror one another. Turning the observer over the slab preserves
    // the same set of line lengths even though the holes move to different screen positions.
    expect(around.some((observer) => drawnLengths([-observer[0], observer[1], observer[2]]) !== drawnLengths(observer))).toBe(true);
    for (const observer of around) expect(drawnLengths([observer[0], -observer[1], observer[2]])).toBe(drawnLengths(observer));
  });

  it("turns with the observer, which is the whole of Glyph Parallax", () => {
    const above: SolidPoint = [0.01, 11, 0];

    // From over the holes, from the apex end and from a cut: a wedge full of holes, a bar, and a
    // cut with a dish in it. No two of them are the same drawing.
    expect(drawnLengths([0, 2.6, 11])).not.toBe(drawnLengths(above));
    expect(drawnLengths([11, 2.6, 0])).not.toBe(drawnLengths(above));
    expect(drawnLengths([0, 2.6, 11])).not.toBe(drawnLengths([11, 2.6, 0]));
  });
});
