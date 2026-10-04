import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

type Triple = [number, number, number];
type Pair = [number, number];
type Flat = readonly [number, number];

/** Proportions of the open ring and of the blade growing out of its foot. */
export type QuakeOptions = {
  /** Half the depth through the rune. */
  depth: number;
  /** Facets along each of the ring's two arcs. */
  facets: number;
  /** Where an arc begins and ends, in degrees on the right-hand side, zero being due right. */
  from: number;
  to: number;
  /** How wide the band is at the sharp upper tip of an arc, and at its blunt lower end. */
  tip: number;
  root: number;
  /** How the band thickens along the arc. One is an even taper; below one it leaves its tip faster. */
  taper: number;
  /** The right half of the blade's outline, from its lower point to the corner of its head. */
  nail: readonly Flat[];
};

// Two mirrored arcs leave the narrow opening at the crown. Each arc grows heavier towards the foot,
// where it becomes the blade rather than ending beside it. The reference is worn and asymmetric,
// but those are properties of its surface; the rune underneath is this clean symmetric silhouette.
export const QUAKE: QuakeOptions = {
  depth: 0.11,
  facets: 13,
  from: 61,
  to: -61,
  tip: 0.037,
  root: 0.22,
  taper: 0.85,
  // Point, the long lower blade, the outside of its shoulder, then the shaft and head inside the
  // ring. The shoulder and the shaft are joined to the outer and inner feet of the arc respectively.
  nail: [
    [0, -1.845],
    [0.1, -1.291],
    [0.105, -1.009],
    [0.4, -0.93],
    [0.47, -0.875],
    [0.105, -0.75],
    [0.105, -0.425],
    [0.248, -0.345],
    [0.248, -0.308],
  ],
};

/**
 * The Quake rune: a heavy ring open at the crown and growing into a long central blade at its foot.
 *
 * The entire outline is one simple polygon carried through a real depth. In particular, the two
 * lower arc ends share material with the blade: overlapping or merely touching separate prisms look
 * joined face-on but split apart as soon as a pilot travels around them.
 */
export function buildQuake(options: QuakeOptions = QUAKE) {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];

  const arc = arcBand(options);
  const profile = wholeRune(arc, options.nail);
  const rune = addPrism(profile, options.depth, vertices, triangles, drawn);
  const at = (score: (point: Flat) => number, side: (point: Flat) => boolean = () => true): number => {
    let best = profile.findIndex(side);
    for (let index = best + 1; index < profile.length; index += 1) {
      if (side(profile[index]) && score(profile[index]) > score(profile[best])) best = index;
    }
    return rune.front[best];
  };

  return {
    name: "quake",
    source: { file: "generated, one open ring growing into a central blade" },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    anchors: [
      at(([, y]) => y, ([x]) => x > 0), at(([, y]) => y, ([x]) => x < 0),
      at(([x]) => x), at(([x]) => -x),
      at(([, y]) => -y),
    ],
  };
}

// One arc of the ring, from its tip at the crown down to its blunt end at the foot. Both paths carry
// the same corners, so the band is a deliberately faceted piece of iron rather than a round tube
// sampled at whatever resolution.
function arcBand(options: QuakeOptions): { outer: Flat[]; inner: Flat[] } {
  const outer: Flat[] = [];
  const inner: Flat[] = [];

  for (let step = 0; step <= options.facets; step += 1) {
    const along = step / options.facets;
    const angle = ((options.from + (options.to - options.from) * along) * Math.PI) / 180;
    // Just short of even, so the band leaves its point a little faster than it finishes thickening
    // and the crown end reads as sharpened iron rather than as a wedge.
    const width = options.tip + (options.root - options.tip) * along ** options.taper;
    outer.push([Math.cos(angle), Math.sin(angle)]);
    inner.push([Math.cos(angle) * (1 - width), Math.sin(angle) * (1 - width)]);
  }
  return { outer, inner };
}

function mirror([x, y]: Flat): Flat {
  return [-x, y];
}

// Walk the whole boundary counter-clockwise. The first five blade points are its point and outer
// right shoulder; the remaining four climb the inner shaft to the head. The arc paths fill the two
// gaps between those groups, making the joins shared edges rather than coincident surfaces.
function wholeRune(arc: { outer: readonly Flat[]; inner: readonly Flat[] }, half: readonly Flat[]): Flat[] {
  if (half.length < 6) throw new Error("Quake blade needs an outer shoulder and an inner shaft");
  const shoulder = half.slice(1, 5);
  const shaft = half.slice(5);
  return [
    half[0],
    ...shoulder,
    ...arc.outer.slice().reverse(),
    ...arc.inner,
    ...shaft,
    ...shaft.slice().reverse().map(mirror),
    ...arc.inner.slice().reverse().map(mirror),
    ...arc.outer.map(mirror),
    ...shoulder.slice().reverse().map(mirror),
  ];
}

/** A closed slab of one outline, with both of its faces marked as the drawing. */
function addPrism(profile: readonly Flat[], depth: number, vertices: SolidPoint[], triangles: Triple[], drawn: Pair[]) {
  const front = profile.map(([x, y]) => vertices.push([x, y, depth]) - 1);
  const back = profile.map(([x, y]) => vertices.push([x, y, -depth]) - 1);

  for (const [a, b, c] of triangulate(profile)) triangles.push([front[a], front[b], front[c]], [back[c], back[b], back[a]]);

  for (let corner = 0; corner < profile.length; corner += 1) {
    const next = (corner + 1) % profile.length;
    triangles.push([front[corner], back[corner], back[next]], [front[corner], back[next], front[next]]);
    drawn.push([front[corner], front[next]], [back[corner], back[next]]);
  }
  return { front, back };
}

// Ear clipping, over an outline wound counter-clockwise.
//
// The nail is nowhere near convex - its head and its guard both stand out past its shaft - so the
// fan from one interior point that serves a wedge would lay triangles across open sky on either
// side of the shaft, and the body would then occlude lines that nothing stands in front of.
function triangulate(profile: readonly Flat[]): Triple[] {
  const remaining = profile.map((_, index) => index);
  const cut: Triple[] = [];

  while (remaining.length > 3) {
    const before = remaining.length;
    for (let at = 0; at < remaining.length; at += 1) {
      const prev = remaining[(at + remaining.length - 1) % remaining.length];
      const here = remaining[at];
      const next = remaining[(at + 1) % remaining.length];
      if (turn(profile[prev], profile[here], profile[next]) <= 0) continue;
      if (remaining.some((index) => index !== prev && index !== here && index !== next && within(profile[index], profile[prev], profile[here], profile[next]))) continue;

      cut.push([prev, here, next]);
      remaining.splice(at, 1);
      break;
    }
    // A simple outline always has an ear. Finding none means the outline crosses itself, and leaving
    // the surface open hands the model reader a body it will reject rather than looping here.
    if (remaining.length === before) return cut;
  }

  cut.push([remaining[0], remaining[1], remaining[2]]);
  return cut;
}

/** Twice the signed area of a corner: positive where the outline turns left. */
function turn(a: Flat, b: Flat, c: Flat): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function within(point: Flat, a: Flat, b: Flat, c: Flat): boolean {
  return turn(a, b, point) >= 0 && turn(b, c, point) >= 0 && turn(c, a, point) >= 0;
}
