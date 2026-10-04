import type { SolidPoint } from "./glyphSolid";
import { add, intoFigureSpace, scale } from "./sigilVectors";

// The fourth Sigil Figure this build makes for itself: a hammer.
//
// A figure is generated here only when a rule describes the subject exactly rather than
// approximately - that is why the rest of the library is sculpted models, and why a torus was the
// first thing in it. A hafted hammer passes the same test. It is a block lofted along the axis it
// strikes on, and a bar run down the upright out of the middle of that block. Every number below is
// a proportion of the figure, and none of them is a guess at a surface nobody drew.
//
// The proportions are the ones everybody draws for a thunder god's hammer: a head about twice as
// long as it is tall, its two striking faces flared out to a rim and then chamfered back, on a grip
// not much longer than the head itself. A long narrow head on a handle that outruns it is a mallet,
// and a sigil has to say which it is from a long way off, so the head carries the figure and the
// grip only balances it.
//
// It is two bodies and not one. The head is closed, the haft is closed, and the haft runs up into
// the head rather than being welded to its underside - which is what a hafted tool is, and what the
// body already knows how to draw: the atom is three separate bodies hiding each other, and this is
// two. The stretch of grip driven into the head is covered by the head from every side, so none of
// it is ever drawn, and the collar where it comes back out is a line of the figure rather than a
// seam in a surface.
//
// What keeps it a body rather than a sign is the head's four long corners, which are marked, and its
// two rims, which are marked as well: the outline is always found from the observer, but the ring
// where the chamfer turns back off a striking face is a crease the head has from every angle. Face
// on, the hammer is its outline with two long creases down the head and a square inside each end of
// it. Turned down its own strike axis it does not collapse to a sliver the way a bolt does - it is
// nearly as deep as it is tall - which is the honest view of a block, and what Glyph Parallax
// promises for one.
//
// Where a real Solar System lands is where a hammer sticks out: the corners of the two rims, and the
// butt of the grip. All eight rim corners would bunch in pairs, so each rim gives up one diagonal,
// and the two ends give up opposite diagonals - which spreads four anchors over all three axes and
// still leaves the set unchanged by the hammer's own half-turn about its upright.

/** One section across the head's strike axis: how far along it stands, and how big it is there. */
export type HeadSection = {
  /** Along the strike axis, as a fraction of the head's half-length. */
  at: number;
  /** The section's size there, as a fraction of the head's widest. */
  size: number;
  /** Mark the ring round this section as a line of the drawing. */
  ring: boolean;
};

/** One section of the haft, square to the figure's upright. */
export type HaftSection = {
  /** How high the section stands, in the space the head's own height is written in. */
  at: number;
  /** Half-width of the grip there. The grip is square, so this is its half-depth as well. */
  width: number;
  /** Mark the ring round this section as a line of the drawing. */
  ring: boolean;
};

export type HammerOptions = {
  head: {
    /** How far the strike axis stands above the middle of the figure, before the body is centred. */
    height: number;
    /** Half-length along the strike axis. */
    length: number;
    /** Half-height of the head's widest section, in the plane the hammer is drawn in. */
    rise: number;
    /** Half-depth of the head's widest section, through the figure. */
    depth: number;
    sections: readonly HeadSection[];
  };
  /** The haft, written from inside the head down to the butt of the grip. */
  haft: readonly HaftSection[];
  /** Mark the head's four long corners as lines running its whole length: the relief of the block. */
  rails: boolean;
};

export const HAMMER: HammerOptions = {
  head: {
    height: 0.5,
    length: 0.62,
    rise: 0.34,
    depth: 0.3,
    // Straight through the middle, flared to a rim near each end, then chamfered back into the
    // striking face itself. The waist is barely narrower than the rim, because a forged head is a
    // block with its ends worked rather than a shape with a waist.
    sections: [
      { at: -1, size: 0.84, ring: true },
      { at: -0.88, size: 1, ring: true },
      { at: -0.5, size: 0.95, ring: false },
      { at: 0.5, size: 0.95, ring: false },
      { at: 0.88, size: 1, ring: true },
      { at: 1, size: 0.84, ring: true },
    ],
  },
  // Top first, which is the end driven into the head and the only part of the figure nothing ever
  // sees. The collar stands clear of the head's underside, so what a pilot gets is a grip hafted
  // into a block rather than a block balanced on a stick.
  //
  // The second station stands exactly on the head's underside, where the grip comes back out of it.
  // Whether a stretch of the grip is drawn at all is asked once for the whole stretch, so one that
  // began inside the head and ended outside would be answered inside and dropped, and the grip would
  // hang a facet short of the block it is driven into.
  haft: [
    { at: 0.46, width: 0.1, ring: false },
    { at: 0.177, width: 0.1, ring: false },
    { at: 0.1, width: 0.13, ring: true },
    { at: -0.02, width: 0.1, ring: false },
    { at: -0.62, width: 0.1, ring: false },
    { at: -0.7, width: 0.155, ring: true },
    { at: -0.8, width: 0.14, ring: true },
  ],
  rails: true,
};

/** Three indices into the vertices, which is one triangle. */
type Triple = [number, number, number];

// The corners of a head section, in the order `boxTube` lays them down. A head section's own two
// directions are the head's rise and its depth, so its corners name themselves - and these are the
// names the anchors are chosen by.
const TOP_FRONT = 0;
const BOTTOM_FRONT = 1;
const BOTTOM_BACK = 2;
const TOP_BACK = 3;

export function buildHammer({ head, haft, rails }: HammerOptions = HAMMER) {
  // The head, lofted along the axis it strikes on: its section stands in the figure's rise and its
  // depth, and the run advances along the strike axis, which those two are right-handed about.
  const block = boxTube(head.sections.map((section) => ({
    centre: [section.at * head.length, head.height, 0] as SolidPoint,
    right: [0, head.rise * section.size, 0] as SolidPoint,
    up: [0, 0, head.depth * section.size] as SolidPoint,
    ring: section.ring,
  })), rails);

  // The haft, the same tube run downward: written top first, so the run advances down the upright,
  // which its square section is right-handed about in turn. The grip is thin, and its own four
  // corners would be three lines down a stroke two lines wide, so it carries no rails: its
  // silhouette is found from the observer, and the collar and the butt are what mark it out.
  const grip = boxTube(haft.map((section) => ({
    centre: [0, section.at, 0] as SolidPoint,
    right: [section.width, 0, 0] as SolidPoint,
    up: [0, 0, section.width] as SolidPoint,
    ring: section.ring,
  })), false);

  const offset = block.vertices.length;
  const near = block.corners[rimOf(head.sections, -1)];
  const far = block.corners[rimOf(head.sections, 1)];

  return {
    name: "hammer",
    source: { file: `generated, a ${head.sections.length} section head hafted on a ${haft.length} section grip` },
    vertices: intoFigureSpace([...block.vertices, ...grip.vertices]),
    triangles: [...block.triangles, ...grip.triangles.map((triangle): Triple => [triangle[0] + offset, triangle[1] + offset, triangle[2] + offset])],
    drawn: [...block.drawn, ...grip.drawn.map(([from, to]): [number, number] => [from + offset, to + offset])],
    anchors: [near[TOP_FRONT], near[BOTTOM_BACK], far[TOP_BACK], far[BOTTOM_FRONT], offset + grip.ends[1]],
  };
}

/** One rectangular section of a run, with its own two directions already sized to their half-extent. */
type TubeStation = { centre: SolidPoint; right: SolidPoint; up: SolidPoint; ring: boolean };

type Tube = {
  vertices: SolidPoint[];
  triangles: Triple[];
  drawn: [number, number][];
  /** The four corners at each station, in the order `CORNERS` lays them down. */
  corners: number[][];
  /** The centre of the cap at each end of the run: where it starts, and where it stops. */
  ends: [number, number];
};

/** The corners of a section, counted round it: the two directions it was handed, both ways. */
const CORNERS: readonly (readonly [number, number])[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

// The one piece both halves of the figure are made of: a run of rectangular sections joined into a
// closed box tube and capped flat at each end.
//
// A station's two directions arrive already sized, and they are right-handed about the way the run
// advances - so the faces below come out wound outward as they are written, rather than being wound
// either way and put right afterwards by asking the body which way is out.
function boxTube(stations: readonly TubeStation[], rails: boolean): Tube {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];

  const corners = stations.map((station) =>
    CORNERS.map(([right, up]) => place(vertices, add(station.centre, add(scale(station.right, right), scale(station.up, up))))));

  for (let step = 0; step + 1 < stations.length; step += 1) {
    const near = corners[step];
    const far = corners[step + 1];
    for (let corner = 0; corner < CORNERS.length; corner += 1) {
      const next = (corner + 1) % CORNERS.length;
      triangles.push([near[corner], near[next], far[next]], [near[corner], far[next], far[corner]]);
      // A rail runs the whole length of the run and is one line of the figure; the diagonal that
      // splits each facet only holds the surface together, and is never marked.
      if (rails) drawn.push([near[corner], far[corner]]);
    }
  }

  for (const [step, station] of stations.entries()) {
    if (!station.ring) continue;
    for (let corner = 0; corner < CORNERS.length; corner += 1) drawn.push([corners[step][corner], corners[step][(corner + 1) % CORNERS.length]]);
  }

  // The caps go on last, so the run's own corners keep the numbering a caller reads them by. One is
  // wound against the way the run advances and the other with it, which is the whole difference
  // between the two ends of a tube.
  const ends = ([[0, false], [stations.length - 1, true]] as const).map(([step, forward]) => {
    const centre = place(vertices, stations[step].centre);
    for (let corner = 0; corner < CORNERS.length; corner += 1) {
      const next = (corner + 1) % CORNERS.length;
      triangles.push(forward ? [centre, corners[step][corner], corners[step][next]] : [centre, corners[step][next], corners[step][corner]]);
    }
    return centre;
  });

  return { vertices, triangles, drawn, corners, ends: [ends[0], ends[1]] };
}

// The rim of a striking face: the widest section on that half of the head, and the outer one of two
// equally wide. It is read off the shape rather than counted off the table, so retuning the sections
// cannot quietly move an anchor onto a chamfer.
function rimOf(sections: readonly HeadSection[], side: number): number {
  return sections.reduce((widest, section, index) => {
    if (Math.sign(section.at) !== side) return widest;
    if (widest < 0) return index;
    const held = sections[widest];
    return section.size > held.size || (section.size === held.size && Math.abs(section.at) > Math.abs(held.at)) ? index : widest;
  }, -1);
}

function place(vertices: SolidPoint[], point: SolidPoint): number {
  return vertices.push(point) - 1;
}
