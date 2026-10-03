import type { SolidPoint } from "./glyphSolid";
import { ringShell, type RingOptions, type RingShell } from "./sigilRing";
import { add, cross, distance, dot, scale, subtract, turnOnto, unit } from "./sigilVectors";

// The second Sigil Figure this build makes for itself: an atom.
//
// A figure is only generated here when a rule describes the subject exactly rather than
// approximately - that is why the library is otherwise sculpted models, and why the ring was the
// first thing in it. An atom passes the same test. It is a core with shells round it: a radius, a
// count, and the tube a shell is made of. Nothing about it is a guess at a shape nobody drew.
//
// The shells are set square to each other, and that is the whole of why it reads. Two planes at a
// right angle are as far apart as two planes get, so from wherever an observer stands the shells
// cross at the widest angle they can and the figure stays two orbits round a core. Set at any
// narrower angle they project nearly on top of one another from most sides, and the atom collapses
// into an onion of rings - which is exactly what the first few of these looked like.
//
// It is also the figure that asks the body the harder question. A ring hides its own far side; an
// atom is three separate bodies hiding each other. The core blanks whatever passes behind it and
// each shell cuts the other where it crosses in front, and none of that is the facing test's doing:
// it falls out of asking the whole body what stands between a line and the observer. Turned until
// one shell is edge on, that shell collapses to a bar while the other stays open, which no extruded
// drawing has managed.
//
// Where a real Solar System lands is where an electron would: on the rims of the shells. The
// anchors are not authored, because an atom sticks out all over, so they are spread - each one taken
// as far from the ones already chosen as a rim vertex can be.

export type AtomOptions = {
  /** Shells round the core, each one square to the last. Three is all the room there is. */
  shells: number;
  /** The core's radius, as a fraction of the figure's reach. */
  core: number;
  /** The tube one shell is made of, which arrives from the ring the sky already draws. */
  shell: RingOptions;
  /** Rim points a real Solar System is meant to land on. */
  anchors: number;
};

export const ATOM: AtomOptions = {
  shells: 2,
  core: 0.32,
  // Thin, because a shell is one orbit and not a band, and finely stepped, because a tube this
  // narrow has no facets left to read.
  shell: { around: 16, through: 3, thickness: 0.035, railStep: 3 },
  anchors: 6,
};

// The axis each shell turns about, in the figure's own frame. The first lies in the figure's own
// equator, so the upright is its axis and the atom has an obvious way up; each one after that
// stands through it.
const AXES: SolidPoint[] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];

/** Three indices into the vertices, which is one triangle or one face of the table below. */
type Triple = [number, number, number];

export function buildAtom({ shells, core, shell, anchors }: AtomOptions = ATOM) {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];
  const rim: number[] = [];

  for (let index = 0; index < shells; index += 1) {
    const placed = place(ringShell(shell), AXES[index % AXES.length], vertices.length);

    rim.push(...placed.rim);
    vertices.push(...placed.vertices);
    triangles.push(...placed.triangles);
    drawn.push(...placed.drawn);
  }

  const nucleus = coreAt(vertices.length, core);
  vertices.push(...nucleus.vertices);
  triangles.push(...nucleus.triangles);

  return {
    name: "atom",
    source: { file: `generated, ${shells} shells of ${shell.around} by ${shell.through} segments round a core` },
    vertices,
    triangles,
    drawn,
    anchors: spreadOver(vertices, rim, anchors),
  };
}

// A shell turned onto its own plane. The tube arrives lying flat and turning about its own axis, so
// the shell's axis takes that one, and the two directions in the plane are found from the figure's
// upright: one of them level, the other the shell's own rise. Only the body is moved - the rails it
// marks and the rim it reaches are the same tube's, renumbered.
function place(shell: RingShell, axis: SolidPoint, offset: number): RingShell {
  // The shell lying in the figure's own equator turns about the upright itself, and the upright then
  // says nothing about which way round its plane is, so it takes a level direction instead.
  const across = Math.abs(axis[1]) > 0.999 ? ([0, 0, 1] as SolidPoint) : unit([axis[2], 0, -axis[0]]);
  const up = cross(axis, across);

  return {
    vertices: shell.vertices.map(([x, y, z]): Triple => [
      across[0] * x + up[0] * y + axis[0] * z,
      across[1] * x + up[1] * y + axis[1] * z,
      across[2] * x + up[2] * y + axis[2] * z,
    ]),
    triangles: shell.triangles.map(([a, b, c]): Triple => [a + offset, b + offset, c + offset]),
    drawn: shell.drawn.map(([from, to]): [number, number] => [from + offset, to + offset]),
    rim: shell.rim.map((vertex) => vertex + offset),
  };
}

// The core, as an icosahedron: the roundest body a fixed table of twenty faces describes, which is
// all a core has to be. None of its creases is marked, so what an observer gets of it is its
// outline alone - the one closed shape the shells pass in front of and behind. Twenty lines across
// it would read as a cage.
//
// It is stood on one of its own three-fold axes, so the figure's upright runs through a face rather
// than through a corner of the table nobody chose.
const PHI = (1 + Math.sqrt(5)) / 2;

const CORE_VERTICES: SolidPoint[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

const CORE_FACES: Triple[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function coreAt(offset: number, radius: number): { vertices: SolidPoint[]; triangles: Triple[] } {
  const [a, b, c] = CORE_FACES[0];
  const stand = unit(add(add(CORE_VERTICES[a], CORE_VERTICES[b]), CORE_VERTICES[c]));
  const vertices = CORE_VERTICES.map((vertex): SolidPoint => scale(turnOnto(unit(vertex), stand, [0, 1, 0]), radius));

  return {
    vertices,
    // Wound outward, decided from the body rather than trusted to the table: the facing test reads
    // a face by which way it points, so one triple entered the other way round would leave a hole
    // in the core that the shells behind it would show through.
    triangles: CORE_FACES.map(([first, second, third]): Triple => {
      const corners: Triple = [first + offset, second + offset, third + offset];
      const centre = scale(add(add(vertices[first], vertices[second]), vertices[third]), 1 / 3);
      const outward = dot(cross(subtract(vertices[second], vertices[first]), subtract(vertices[third], vertices[first])), centre);
      return outward > 0 ? corners : [corners[0], corners[2], corners[1]];
    }),
  };
}

// Anchors spread over the rims, by farthest point: start at the highest rim vertex, then take
// whichever candidate stands farthest from everything already taken. It needs no table, it cannot
// bunch two anchors where the shells cross, and it gives the same points every build.
function spreadOver(vertices: readonly SolidPoint[], candidates: readonly number[], count: number): number[] {
  const first = candidates.reduce((highest, vertex) => (vertices[vertex][1] > vertices[highest][1] ? vertex : highest), candidates[0]);
  const chosen = [first];

  while (chosen.length < Math.min(count, candidates.length)) {
    let best = -1;
    let widest = -1;
    for (const candidate of candidates) {
      if (chosen.includes(candidate)) continue;
      const gap = Math.min(...chosen.map((taken) => distance(vertices[candidate], vertices[taken])));
      if (gap > widest) [best, widest] = [candidate, gap];
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen;
}
