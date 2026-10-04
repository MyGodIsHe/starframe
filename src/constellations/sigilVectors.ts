import type { SolidPoint } from "./glyphSolid";

// The handful of vector operations the generated Sigil Figures are built out of.
//
// Each figure here is forged from a rule rather than imported, so each one needs the same few
// turns of arithmetic. They live together so a ring, an atom and a bolt cannot quietly disagree
// about what a cross product is.

export function add(left: SolidPoint, right: SolidPoint): SolidPoint {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function subtract(left: SolidPoint, right: SolidPoint): SolidPoint {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function scale(point: SolidPoint, factor: number): SolidPoint {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

/** The point a fraction of the way from one to the other: zero is the first, one is the second. */
export function mix(from: SolidPoint, to: SolidPoint, fraction: number): SolidPoint {
  return add(from, scale(subtract(to, from), fraction));
}

export function cross(left: SolidPoint, right: SolidPoint): SolidPoint {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function dot(left: SolidPoint, right: SolidPoint): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function length(point: SolidPoint): number {
  return Math.hypot(point[0], point[1], point[2]);
}

export function distance(left: SolidPoint, right: SolidPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** The same direction at length one. A point of no length is returned as it came. */
export function unit(point: SolidPoint): SolidPoint {
  const reach = length(point);
  return reach > 0 ? scale(point, 1 / reach) : point;
}

// The turn that takes one direction onto another, applied to a point: about the axis the two share,
// by the angle between them. Both arrive as unit vectors; two that are already opposite share no
// axis, and the point comes back untouched rather than turned by a guess.
export function turnOnto(point: SolidPoint, from: SolidPoint, to: SolidPoint): SolidPoint {
  const axis = cross(from, to);
  const sine = length(axis);
  if (sine < 1e-12) return point;

  const turn = unit(axis);
  const cosine = dot(from, to);
  // Rodrigues: the part of the point along the axis stays, and the part across it turns.
  return add(add(scale(point, cosine), scale(cross(turn, point), sine)), scale(turn, dot(turn, point) * (1 - cosine)));
}

// A Sigil Figure arrives in its own space: centred, upright, with its farthest point on the unit
// sphere. A generated figure is written at the proportions somebody would draw it at - a hammer's
// head at its own height, a wedge standing on its point - so the move onto the origin is made here,
// once, rather than typed pre-offset into every number of every figure.
export function intoFigureSpace(vertices: readonly SolidPoint[]): SolidPoint[] {
  const middle = (axis: 0 | 1 | 2): number => {
    const spread = vertices.map((vertex) => vertex[axis]);
    return (Math.min(...spread) + Math.max(...spread)) / 2;
  };
  const centred = vertices.map((vertex) => subtract(vertex, [middle(0), middle(1), middle(2)]));
  const reach = Math.max(...centred.map(length));

  return centred.map((vertex) => scale(vertex, 1 / reach));
}
