import type { Vector3 } from "../universe/generateUniverse";
import { fitFigure, type SigilFigure } from "./sigilFigure";

// A Constellation Glyph as a fixed object in space.
//
// Fitting a figure in the observer's sky plane meant refitting it every time the observer moved,
// and the anchor-to-star matching would jump from one frame to the next: the figure visibly redrew
// itself onto different systems mid-flight. So the fit happens once, in a frame the constellation
// owns - the best-fit plane through its own Solar Systems - and the result is a fixed set of 3D
// points. Travel then changes only the projection, which is what gives a glyph its volume: it is
// one object seen from somewhere else, not a new drawing.

export type GlyphShapeStroke = {
  kind: "figure" | "lead";
  /** Absolute SDE positions, in metres. */
  points: readonly Vector3[];
};

export type GlyphShape = {
  strokes: readonly GlyphShapeStroke[];
  /** Centre of the constellation's own frame, in absolute SDE positions. */
  centre: Vector3;
  /** Normal of the plane the figure was laid out on: the direction it faces. */
  normal: Vector3;
  /** Distance from the centre to the farthest member, in metres. */
  radius: number;
};

type ShapeSystem = {
  id: number;
  position: Vector3;
};

// EVE's vertical axis, used to give every constellation's frame the same sense of up so a figure is
// authored upright and stays that way in space.
const GALACTIC_UP: Vector3 = [0, 1, 0];
const DEGENERATE = 1e-9;

// How far the figure may lift off its own plane, as a fraction of the constellation's radius. The
// relief comes from the real out-of-plane offsets of the Solar Systems, so a flat constellation
// gives a flat figure and a deep one gives a figure with real depth - but a single far-flung system
// must not spike the artwork into a needle.
const MAX_RELIEF = 0.6;

export function buildGlyphShape(input: readonly ShapeSystem[], figure: SigilFigure): GlyphShape | null {
  if (input.length < 2) return null;

  // Anchor-to-star matching resolves ties by position in the list, so the shape is only stable if
  // the list is. Sorting here rather than trusting the caller keeps the shape a pure function of
  // the SDE build.
  const systems = [...input].sort((left, right) => left.id - right.id);
  const centroid = centroidOf(systems.map((system) => system.position));
  const offsets = systems.map((system) => subtract(system.position, centroid));
  const frame = planeFrame(offsets);
  if (!frame) return null;

  // Solar Systems in the constellation's own plane, plus how far each sits off it.
  const planar = offsets.map((offset) => ({
    x: dot(offset, frame.right),
    y: dot(offset, frame.up),
    z: dot(offset, frame.normal),
  }));

  let radius = 0;
  for (const point of planar) radius = Math.max(radius, Math.hypot(point.x, point.y));
  if (radius <= DEGENERATE) return null;

  const chartPoints = systems.map((system, index) => ({
    systemId: system.id,
    x: planar[index].x / radius,
    y: planar[index].y / radius,
  }));
  const fitted = fitFigure(figure, chartPoints);
  if (fitted.strokes.length === 0) return null;

  const reliefSamples = planar.map((point) => ({ x: point.x / radius, y: point.y / radius, z: point.z / radius }));
  const reliefLimit = MAX_RELIEF;

  const strokes = fitted.strokes.map((stroke): GlyphShapeStroke => ({
    kind: stroke.kind,
    points: stroke.points.map(([x, y]) => {
      const z = Math.max(-reliefLimit, Math.min(reliefLimit, sampleRelief(reliefSamples, x, y)));
      return [
        centroid[0] + (frame.right[0] * x + frame.up[0] * y + frame.normal[0] * z) * radius,
        centroid[1] + (frame.right[1] * x + frame.up[1] * y + frame.normal[1] * z) * radius,
        centroid[2] + (frame.right[2] * x + frame.up[2] * y + frame.normal[2] * z) * radius,
      ] as Vector3;
    }),
  }));

  return { strokes, centre: centroid, normal: frame.normal, radius };
}

// The figure lifts off its plane by however much the Solar Systems around it do, so its relief is
// the constellation's own three-dimensional shape rather than an invented bulge.
function sampleRelief(samples: readonly { x: number; y: number; z: number }[], x: number, y: number): number {
  let weighted = 0;
  let total = 0;
  for (const sample of samples) {
    const weight = 1 / (0.05 + (sample.x - x) ** 2 + (sample.y - y) ** 2);
    weighted += sample.z * weight;
    total += weight;
  }
  return total === 0 ? 0 : weighted / total;
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
