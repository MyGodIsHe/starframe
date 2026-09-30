import type { Vector3 } from "../universe/generateUniverse";
import { buildBody, buildLathe, isClosedStroke, mapSolid, spanAt, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { fitFigure, type FigurePoint, type SigilFigure } from "./sigilFigure";

// A Constellation Glyph as a fixed object in space.
//
// Fitting a figure in the observer's sky plane meant refitting it every time the observer moved,
// and the anchor-to-star matching would jump from one frame to the next: the figure visibly redrew
// itself onto different systems mid-flight. So the fit happens once, in a frame the constellation
// owns - the best-fit plane through its own Solar Systems - and the result is a fixed set of 3D
// points. Travel then changes only the projection, which is what gives a glyph its volume: it is
// one object seen from somewhere else, not a new drawing.
//
// The fit itself stays flat, in the plane the constellation most nearly lies in, because that is
// where the real Solar Systems are and where the anchors must land. Volume is given afterwards: a
// closed outline becomes a body standing through that plane, with the stars at its waist, and the
// figure's open lines are struck on the body's near and far faces. Only then can a glyph hide its
// own far side, which is what tells a pilot they are looking at a thing and not at a sprite.

export type GlyphShapeStroke = {
  kind: "figure" | "lead";
  /**
   * Which face of the body this line is struck on: `1` the near cap, `-1` the far cap, `0` the
   * waist, where the real Solar Systems and their Glyph Leads are. A line on a cap is drawn only
   * while that cap faces the observer.
   */
  side: 1 | 0 | -1;
  /** Absolute SDE positions, in metres. */
  points: readonly Vector3[];
};

export type GlyphShape = {
  /**
   * The bodies the figure's closed outlines stand for, in absolute space. Their edges are most of
   * the drawing; which of those edges an observer can see is decided per observer, per frame, and
   * never changes a vertex.
   */
  solids: readonly GlyphSolid[];
  strokes: readonly GlyphShapeStroke[];
  /** Centre of the constellation's own frame, in absolute SDE positions. */
  centre: Vector3;
  /** Normal of the plane the figure was laid out on: the direction its near cap faces. */
  normal: Vector3;
  /** The figure's own upright within that plane, from the galactic vertical. */
  up: Vector3;
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

// Half the body's thickness, as a fraction of the figure's own size rather than of the
// constellation's radius: a body has to be thick in proportion to the thing it is a body of, or a
// long thin figure comes out a sliver however large the constellation around it.
//
// The depth is authored, not measured, and that is a deliberate change: real constellations are
// flatter than they look - the out-of-plane spread of their Solar Systems is a median 0.126 of
// their radius across the whole SDE build - so taking the thickness from the data gives every
// figure a slab too thin to read as a body from any angle. The proportion is therefore the
// artwork's, and the data sets only where inside a narrow band each constellation falls: a
// genuinely flat one still gets the shallower body, a deep one the fuller.
const BASE_DEPTH = 0.45;
const DEPTH_BAND = 0.18;
const MEDIAN_SPREAD = 0.126;

// What a figure that declares no side view gets instead: a body fullest at mid-height and drawn in
// towards the extremes. It is not a side view and does not pretend to be one - it only keeps the
// figure from being a slab with a rectangle for a profile until the side view is authored.
const DEFAULT_WAIST = 0.3;

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

  const depthFraction = bodyDepth(planar.map((point) => point.z / radius));
  // The figure's own size, for the lines struck on its caps: they belong to no one outline.
  const figureDepth = depthFraction * extentOf(fitted.strokes.flatMap((stroke) => stroke.points));
  const toAbsolute = (point: SolidPoint): SolidPoint => [
    centroid[0] + (frame.right[0] * point[0] + frame.up[0] * point[1] + frame.normal[0] * point[2]) * radius,
    centroid[1] + (frame.right[1] * point[0] + frame.up[1] * point[1] + frame.normal[1] * point[2]) * radius,
    centroid[2] + (frame.right[2] * point[0] + frame.up[2] * point[1] + frame.normal[2] * point[2]) * radius,
  ];
  const toDirection = (direction: SolidPoint): SolidPoint => [
    frame.right[0] * direction[0] + frame.up[0] * direction[1] + frame.normal[0] * direction[2],
    frame.right[1] * direction[0] + frame.up[1] * direction[1] + frame.normal[1] * direction[2],
    frame.right[2] * direction[0] + frame.up[2] * direction[1] + frame.normal[2] * direction[2],
  ];

  const solids: GlyphSolid[] = [];
  const strokes: GlyphShapeStroke[] = [];

  for (const stroke of fitted.strokes) {
    // A Glyph Lead ties a real Solar System to the artwork, and the systems are at the waist, so a
    // lead stays there too rather than being struck on a cap it has nothing to do with.
    if (stroke.kind === "lead") {
      strokes.push({ kind: "lead", side: 0, points: stroke.points.map((point) => toAbsolute([point[0], point[1], 0]) as Vector3) });
      continue;
    }

    const solid = isClosedStroke(stroke.points) ? buildSolid(figure, stroke.points, stroke.source, depthFraction) : null;
    if (solid) {
      solids.push(mapSolid(solid, toAbsolute, toDirection));
      continue;
    }

    // An open line carries no body of its own, so it is struck on both caps: the near copy reads as
    // detail on the side facing the pilot, and the far one is hidden behind the body with the rest
    // of the far side.
    for (const side of [1, -1] as const) {
      strokes.push({ kind: "figure", side, points: stroke.points.map((point) => toAbsolute([point[0], point[1], side * figureDepth]) as Vector3) });
    }
  }

  if (solids.length === 0 && strokes.every((stroke) => stroke.kind === "lead")) return null;
  return { solids, strokes, centre: centroid, normal: frame.normal, up: frame.up, radius };
}

// The body one closed outline stands for. A figure that can be turned is turned, which costs no
// authored art at all; otherwise the outline keeps its shape and only its thickness varies, from
// the authored side view where there is one.
function buildSolid(figure: SigilFigure, outline: readonly FigurePoint[], source: number | undefined, depthFraction: number): GlyphSolid | null {
  // A turned body is as deep as it is wide by construction - that is what being turned means - so
  // the constellation's own flatness only squashes or fills it within the band, and must never be
  // multiplied by the figure's size a second time.
  if (figure.symmetry === "revolve") return buildLathe(outline, depthFraction / BASE_DEPTH);

  const profile = source === undefined ? null : figure.side ?? null;
  return buildBody(outline, halfDepths(outline, profile, depthFraction * extentOf(outline)));
}

// Thickness along the outline, as a share of the body's depth. Height is measured as a fraction of
// the outline's own extent rather than in figure space, so the profile survives the fit's scaling
// and its slight tilt without having to be transformed alongside it.
function halfDepths(outline: readonly FigurePoint[], profile: readonly FigurePoint[] | null, depth: number): number[] {
  const heights = outline.map(([, y]) => y);
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  if (high - low <= DEGENERATE) return outline.map(() => depth);

  const sideLow = profile ? Math.min(...profile.map(([, y]) => y)) : 0;
  const sideHigh = profile ? Math.max(...profile.map(([, y]) => y)) : 0;
  let widest = 0;
  if (profile) {
    for (let step = 0; step <= 32; step += 1) {
      const span = spanAt(profile, sideLow + ((sideHigh - sideLow) * step) / 32);
      if (span) widest = Math.max(widest, (span[1] - span[0]) / 2);
    }
  }

  return heights.map((y) => {
    const height = (y - low) / (high - low);
    if (!profile || widest <= DEGENERATE) return depth * (DEFAULT_WAIST + (1 - DEFAULT_WAIST) * Math.sqrt(Math.max(0, 1 - (2 * height - 1) ** 2)));
    const span = spanAt(profile, sideLow + (sideHigh - sideLow) * height);
    const half = span ? (span[1] - span[0]) / 2 : 0;
    return Math.max(depth * 0.08, (depth * half) / widest);
  });
}

// How big a run of points is, as the geometric mean of its half-extents: a measure that shrinks
// with a small figure and does not let one long axis stand in for the whole of it.
function extentOf(points: readonly FigurePoint[]): number {
  if (points.length === 0) return 0;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const width = (Math.max(...xs) - Math.min(...xs)) / 2;
  const height = (Math.max(...ys) - Math.min(...ys)) / 2;
  return Math.sqrt(Math.max(width, DEGENERATE) * Math.max(height, DEGENERATE));
}

// Where in the allowed band this constellation's body falls, from how far its own Solar Systems sit
// off the plane they were fitted in.
function bodyDepth(offsets: readonly number[]): number {
  let total = 0;
  for (const offset of offsets) total += (offset * offset) / offsets.length;
  const spread = Math.sqrt(total);
  return Math.max(BASE_DEPTH - DEPTH_BAND, Math.min(BASE_DEPTH + DEPTH_BAND, (BASE_DEPTH * spread) / MEDIAN_SPREAD));
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
