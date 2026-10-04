import type { Vector3 } from "../universe/generateUniverse";
import { mapSolid, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { frameFigure, placePoint, LEAD_THRESHOLD, type ChartStar, type FitPoint, type Placement } from "./sigilFit";
import type { SigilModel } from "./sigilModel";

// A Constellation Glyph as a fixed object in space.
//
// Fitting a figure in the observer's sky plane meant refitting it every time the observer moved,
// and the anchor-to-star matching would jump from one frame to the next: the figure visibly redrew
// itself onto different systems mid-flight. So the fit happens once, in a frame the constellation
// owns - the best-fit plane through its own Solar Systems - and the result is a fixed body in
// space. Travel then changes only the projection, which is what gives a glyph its volume: it is one
// object seen from somewhere else, not a new drawing.
//
// What gets placed is a sculpted body, and it arrives with its volume already. Nothing here gives
// it depth, thickens it or turns it about an axis - the model is the artwork. Where it stands and
// how big it comes out are the constellation's to say, and `sigilFit` says them as a rule: centred
// on the constellation, drawn out to a fixed multiple of its radius. All the anchors settle is which
// way up. That is the whole difference from the line art this replaced: a drawing had to be made
// into a body by rule, and every such rule was a guess about a shape nobody drew.
//
// The model's own x and y lie in the constellation's plane and its z stands through it, so a figure
// faces the way its constellation does and keeps the galactic sense of up.

/** An offline fitting aid from a real Solar System to the drawing, in absolute SDE positions. */
export type GlyphLead = { systemId: number; from: Vector3; to: Vector3 };

export type GlyphShape = {
  /**
   * The bodies the figure is made of, in absolute space. Their edges are the whole drawing; which
   * of those edges an observer can see is decided per observer, per frame, and never moves a
   * vertex.
   */
  solids: readonly GlyphSolid[];
  /** Fitting aids for offline review; the Celestial Map does not draw them. */
  leads: readonly GlyphLead[];
  /** Centre of the constellation's own frame, in absolute SDE positions. */
  centre: Vector3;
  /** Normal of the plane the figure was placed in: the direction it faces. */
  normal: Vector3;
  /** The figure's own upright within that plane, from the galactic vertical. */
  up: Vector3;
  /** Distance from the centre to the farthest member, in metres. */
  radius: number;
  /**
   * How far the drawing reaches across the constellation's plane, as a multiple of `radius`. The
   * framing rule settles it, so it is `FIGURE_EXTENT` for every glyph - which is the point, and
   * what the Celestial Map publishes so a test can read the size a figure came out at.
   */
  reach: number;
};

type ShapeSystem = {
  id: number;
  position: Vector3;
};

// EVE's vertical axis, used to give every constellation's frame the same sense of up so a figure is
// sculpted upright and stays that way in space.
const GALACTIC_UP: Vector3 = [0, 1, 0];
const DEGENERATE = 1e-9;

export function buildGlyphShape(input: readonly ShapeSystem[], model: SigilModel): GlyphShape | null {
  if (input.length < 2) return null;

  // Anchor-to-star matching resolves ties by position in the list, so the shape is only stable if
  // the list is. Sorting here rather than trusting the caller keeps the shape a pure function of
  // the SDE build.
  const systems = [...input].sort((left, right) => left.id - right.id);
  const centroid = centroidOf(systems.map((system) => system.position));
  const offsets = systems.map((system) => subtract(system.position, centroid));
  const frame = planeFrame(offsets);
  if (!frame) return null;

  // Solar Systems in the constellation's own plane. How far each sits off it is not asked any more:
  // the body brought its own depth, and nothing here is free to change it.
  const planar = offsets.map((offset) => ({ x: dot(offset, frame.right), y: dot(offset, frame.up) }));

  let radius = 0;
  for (const point of planar) radius = Math.max(radius, Math.hypot(point.x, point.y));
  if (radius <= DEGENERATE) return null;

  const stars: ChartStar[] = systems.map((system, index) => ({
    systemId: system.id,
    x: planar[index].x / radius,
    y: planar[index].y / radius,
  }));
  // How big the figure comes out and where it is centred were settled when it joined the library -
  // the framing rule asks the body and the turn, never the constellation. All that is left here is
  // which of those framings this constellation's own systems answer best.
  const fit = frameFigure(model.framings, model.anchors.map((anchor): FitPoint => [anchor.position[0], anchor.position[1]]), stars);
  if (!fit) return null;

  const toChart = (point: SolidPoint): SolidPoint => place(point, fit.placement);
  const toAbsolute = (point: SolidPoint): SolidPoint => [
    centroid[0] + (frame.right[0] * point[0] + frame.up[0] * point[1] + frame.normal[0] * point[2]) * radius,
    centroid[1] + (frame.right[1] * point[0] + frame.up[1] * point[1] + frame.normal[1] * point[2]) * radius,
    centroid[2] + (frame.right[2] * point[0] + frame.up[2] * point[1] + frame.normal[2] * point[2]) * radius,
  ];
  // Turning the figure in its own plane turns its face normals with it; the scale is uniform, so it
  // leaves a direction alone.
  const toDirection = (direction: SolidPoint): SolidPoint => {
    const turned = turn([direction[0], direction[1]], fit.placement.rotation);
    return [
      frame.right[0] * turned[0] + frame.up[0] * turned[1] + frame.normal[0] * direction[2],
      frame.right[1] * turned[0] + frame.up[1] * turned[1] + frame.normal[1] * direction[2],
      frame.right[2] * turned[0] + frame.up[2] * turned[1] + frame.normal[2] * direction[2],
    ];
  };

  const chartVertices = model.solid.vertices.map(toChart);
  const leads = stars.flatMap((star, index): GlyphLead[] => {
    const nearest = nearestOnBody([star.x, star.y], model.solid, chartVertices);
    if (!nearest || Math.hypot(nearest[0] - star.x, nearest[1] - star.y) <= LEAD_THRESHOLD) return [];
    // The tie starts at the real system, including its distance from the constellation's best-fit
    // plane, then meets the nearest point of the drawing in that plane.
    return [{ systemId: star.systemId, from: systems[index].position, to: toAbsolute([nearest[0], nearest[1], 0]) as Vector3 }];
  });

  // Measured off the placed body rather than restated from the constant, so what a glyph reports is
  // the size it actually came out at.
  let reach = 0;
  for (const vertex of chartVertices) reach = Math.max(reach, Math.hypot(vertex[0], vertex[1]));

  return {
    solids: [mapSolid(model.solid, (point) => toAbsolute(toChart(point)), toDirection)],
    leads,
    centre: centroid,
    normal: frame.normal,
    up: frame.up,
    radius,
    reach,
  };
}

// The model in chart space, framed on the constellation and turned to face it. A similarity and
// nothing else, so the body stays the body it was sculpted as.
function place(point: SolidPoint, placement: Placement): SolidPoint {
  const flat = placePoint([point[0], point[1]], placement);
  return [flat[0], flat[1], point[2] * placement.scale];
}

function turn(point: FitPoint, rotation: number): FitPoint {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [cos * point[0] - sin * point[1], sin * point[0] + cos * point[1]];
}

// Where an offline fitting lead should land: the nearest point of the body seen flat on the chart.
// Every edge is a candidate, structural ones included, because this reviews placement rather than
// the observer-dependent set of edges drawn on the Celestial Map.
function nearestOnBody(star: FitPoint, solid: GlyphSolid, chartVertices: readonly SolidPoint[]): FitPoint | null {
  let best: FitPoint | null = null;
  let bestDistance = Infinity;

  for (const edge of solid.edges) {
    const from = chartVertices[edge.from];
    const to = chartVertices[edge.to];
    const candidate = closestOnSegment(star, [from[0], from[1]], [to[0], to[1]]);
    const distance = (candidate[0] - star[0]) ** 2 + (candidate[1] - star[1]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function closestOnSegment(point: FitPoint, from: FitPoint, to: FitPoint): FitPoint {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return from;
  const amount = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return [from[0] + dx * amount, from[1] + dy * amount];
}

type PlaneFrame = { right: Vector3; up: Vector3; normal: Vector3 };

// The plane the constellation most nearly lies in, with a deterministic orientation: the normal is
// the least-spread principal axis, and "up" is the galactic vertical laid into that plane.
function planeFrame(offsets: readonly Vector3[]): PlaneFrame | null {
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const offset of offsets) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) covariance[row][column] += (offset[row] * offset[column]) / offsets.length;
    }
  }

  const axes = principalAxes(covariance);
  if (!axes) return null;

  let normal = axes[2];
  if (dot(normal, GALACTIC_UP) < 0) normal = [-normal[0], -normal[1], -normal[2]];

  const projectedUp = reject(GALACTIC_UP, normal);
  const up = length(projectedUp) > DEGENERATE ? normalize(projectedUp) : fallbackUp(offsets, normal);
  if (!up) return null;

  return { right: cross(up, normal), up, normal };
}

function fallbackUp(offsets: readonly Vector3[], normal: Vector3): Vector3 | null {
  // Looking straight along the galactic axis there is no projected up left, so the first Solar
  // System (input is sorted by id) takes over - still deterministic.
  for (const offset of offsets) {
    const projected = reject(offset, normal);
    if (length(projected) > DEGENERATE) return normalize(projected);
  }
  return null;
}

// Eigenvectors of a symmetric 3x3 matrix by cyclic Jacobi rotations, returned largest spread first.
function principalAxes(matrix: number[][]): [Vector3, Vector3, Vector3] | null {
  const a = matrix.map((row) => [...row]);
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < 24; sweep += 1) {
    let offDiagonal = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) offDiagonal += a[p][q] * a[p][q];
    if (offDiagonal <= 1e-30) break;

    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(a[p][q]) <= 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = vectors[k][p];
        const vkq = vectors[k][q];
        vectors[k][p] = c * vkp - s * vkq;
        vectors[k][q] = s * vkp + c * vkq;
      }
    }
  }

  const ordered = [0, 1, 2]
    .map((index) => ({ value: a[index][index], axis: [vectors[0][index], vectors[1][index], vectors[2][index]] as Vector3 }))
    .sort((left, right) => right.value - left.value);

  for (const entry of ordered) if (!entry.axis.every(Number.isFinite) || length(entry.axis) <= DEGENERATE) return null;
  return [normalize(ordered[0].axis), normalize(ordered[1].axis), normalize(ordered[2].axis)];
}

function centroidOf(positions: readonly Vector3[]): Vector3 {
  const sum: Vector3 = [0, 0, 0];
  for (const position of positions) for (let axis = 0; axis < 3; axis += 1) sum[axis] += position[axis] / positions.length;
  return sum;
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function reject(vector: Vector3, axis: Vector3): Vector3 {
  const projection = dot(vector, axis);
  return [vector[0] - axis[0] * projection, vector[1] - axis[1] * projection, vector[2] - axis[2] * projection];
}

function normalize(vector: Vector3): Vector3 {
  const size = length(vector) || 1;
  return [vector[0] / size, vector[1] / size, vector[2] / size];
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}
