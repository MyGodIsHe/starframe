import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

type Triple = [number, number, number];
type Pair = [number, number];
type Flat = readonly [number, number];

/** Proportions of the broken ring and of the nail standing in the break. */
export type QuakeOptions = {
  /** Half the depth through the ring. The nail stands a little proud of it, so it reads as in front. */
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
  /** The right half of the nail's outline, from its point up to the corner of its head. */
  nail: readonly Flat[];
};

// The ring is one circle with two bites out of it, and the bites are the same size: an arc runs from
// sixty-one degrees above the horizon on one side to sixty-one below it on the other. What makes
// the crown read as a hairline break and the foot as a wide one is the taper, not the angle - the
// band comes to a point at the crown and is at its heaviest where it is cut off at the foot.
export const QUAKE: QuakeOptions = {
  depth: 0.11,
  facets: 13,
  from: 61,
  to: -61,
  tip: 0.037,
  root: 0.22,
  taper: 0.85,
  // Point, the long parallel blade, the underside of the guard, its outer end, the shaft, and the
  // head flaring out over it. Measured off the ring's own radius, with the ring centred on the
  // origin, so the nail stands in the lower break without touching either arc.
  nail: [
    [0, -1.845],
    [0.1, -1.291],
    [0.105, -1.009],
    [0.4, -0.93],
    [0.4, -0.87],
    [0.105, -0.75],
    [0.105, -0.425],
    [0.248, -0.345],
    [0.248, -0.308],
  ],
};

/**
 * A heavy ring broken at the crown and at the foot, with a long nail standing in the lower break.
 *
 * Three separate closed bodies rather than one, which is what gives the figure its two breaks: the
 * arcs never meet each other and the nail never touches either of them. Each body is wound outwards,
 * so the facing test asks the same question on either side of the figure, and each of the four rims
 * of a band is marked on the back as well as the front. An unmarked back rim simply goes missing
 * once a pilot has travelled round, which is how this figure came out solid from the front and
 * hollow from behind.
 */
export function buildQuake(options: QuakeOptions = QUAKE) {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];

  const arc = arcBand(options);
  const right = addBand(arc.outer, arc.inner, options.depth, false, vertices, triangles, drawn);
  // Mirroring across the upright turns a body inside out, so the left arc's faces are wound back the
  // other way rather than authored a second time and trusted to agree.
  const left = addBand(arc.outer.map(mirror), arc.inner.map(mirror), options.depth, true, vertices, triangles, drawn);
  const nail = addPrism(wholeNail(options.nail), options.depth * 1.25, vertices, triangles, drawn);

  const foot = options.facets;
  return {
    name: "quake",
    source: { file: "generated, a ring broken at the crown and the foot around a standing nail" },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    anchors: [
      right.outerFront[0], left.outerFront[0],
      right.outerFront[foot], left.outerFront[foot],
      nail.front[0], nail.front[options.nail.length - 1],
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

// The nail is authored as its right half, from the point up to the corner of its head, and mirrored
// onto the left. A figure this symmetrical must not be able to drift out of true one typed number at
// a time.
function wholeNail(half: readonly Flat[]): Flat[] {
  return [...half, ...half.slice(1).reverse().map(mirror)];
}

// A closed band between two matching paths: a front and a back face, an outer and an inner wall, and
// a cap over each cut end.
function addBand(outer: readonly Flat[], inner: readonly Flat[], depth: number, flipped: boolean, vertices: SolidPoint[], triangles: Triple[], drawn: Pair[]) {
  const place = ([x, y]: Flat, z: number): number => vertices.push([x, y, z]) - 1;
  const outerFront = outer.map((point) => place(point, depth));
  const innerFront = inner.map((point) => place(point, depth));
  const outerBack = outer.map((point) => place(point, -depth));
  const innerBack = inner.map((point) => place(point, -depth));
  const face = (...each: Triple[]): void => {
    for (const [a, b, c] of each) triangles.push(flipped ? [a, c, b] : [a, b, c]);
  };

  for (let step = 0; step + 1 < outer.length; step += 1) {
    const next = step + 1;
    face(
      [outerFront[step], innerFront[step], innerFront[next]], [outerFront[step], innerFront[next], outerFront[next]],
      [outerBack[step], outerBack[next], innerBack[next]], [outerBack[step], innerBack[next], innerBack[step]],
      [outerFront[step], outerFront[next], outerBack[next]], [outerFront[step], outerBack[next], outerBack[step]],
      [innerFront[step], innerBack[next], innerFront[next]], [innerFront[step], innerBack[step], innerBack[next]],
    );
    // The four rims are the drawing. The diagonals holding the facets together are not, and neither
    // are rungs across the walls, which would ladder a plain piece of iron.
    drawn.push(
      [outerFront[step], outerFront[next]], [innerFront[step], innerFront[next]],
      [outerBack[step], outerBack[next]], [innerBack[step], innerBack[next]],
    );
  }

  const foot = outer.length - 1;
  face(
    [outerFront[0], innerBack[0], innerFront[0]], [outerFront[0], outerBack[0], innerBack[0]],
    [outerFront[foot], innerFront[foot], innerBack[foot]], [outerFront[foot], innerBack[foot], outerBack[foot]],
  );
  for (const end of [0, foot]) {
    drawn.push(
      [outerFront[end], innerFront[end]], [outerBack[end], innerBack[end]],
      [outerFront[end], outerBack[end]], [innerFront[end], innerBack[end]],
    );
  }

  return { outerFront, innerFront, outerBack, innerBack };
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
