// Fitting an authored figure onto a Constellation's real stars.
//
// The previous grammar drew a polygon through the Solar Systems, which is why every glyph came out
// a quadrilateral: six arbitrary points admit no other shape. Star atlases have always worked the
// other way round - the lion is drawn as a lion, and the stars fall on its eye, its paw, its tail.
// So a figure here is authored art with named anchors, and fitting moves the figure onto the real
// stars rather than bending a line through them.
//
// Everything is in chart space, where the constellation's Solar Systems sit inside the unit circle
// with the farthest one on it.

export type FigurePoint = readonly [number, number];

export type SigilFigure = {
  /** Stable identifier, used by the motif table to name this figure. */
  name: string;
  /** The artwork: open or closed polylines in figure space, roughly within [-1, 1]. */
  strokes: readonly (readonly FigurePoint[])[];
  /** Points of the figure a real Solar System is meant to land on, in priority order. */
  anchors: readonly FigurePoint[];
};

export type FittedStroke = {
  kind: "figure" | "lead";
  points: readonly FigurePoint[];
};

export type FittedFigure = {
  strokes: FittedStroke[];
  /** Which star each anchor was matched to, by index into the input points. */
  matched: readonly number[];
};

type FitPoint = { systemId: number; x: number; y: number };

// How far a figure vertex may be dragged from where the rigid fit put it, as a fraction of the
// fitted figure's size. Enough to make the figure feel like it belongs to these particular stars,
// far short of enough to turn a wolf into a puddle.
export const MAX_WARP = 0.16;

// A figure has an inherent upright. The Glyph Chart already carries a stable sense of up from the
// galactic axis, so the fit is allowed to tilt a figure only this far: a crown rotated to lie on
// its side stops being a crown, which is exactly how the first fitted sheet failed.
export const MAX_TILT = (24 * Math.PI) / 180;

// A star further than this from the artwork gets a lead line, so every Solar System is visibly
// part of the drawing even when no anchor reached it.
const LEAD_THRESHOLD = 0.06;

// Total reach allowed, matching what Glyph Occlusion reserves around the footprint.
const FIGURE_EXTENT = 1.35;

const INITIAL_TILTS = 7;
const REFINEMENT_PASSES = 6;

export function fitFigure(figure: SigilFigure, points: readonly FitPoint[]): FittedFigure {
  const stars = points.map((point): FigurePoint => [point.x, point.y]);
  if (stars.length === 0 || figure.anchors.length === 0) return { strokes: [], matched: [] };

  const best = bestAlignment(figure.anchors, stars);
  const placedAnchors = figure.anchors.map((anchor) => applySimilarity(anchor, best.transform));

  // Per-anchor pull towards the star it was matched to, clamped so the figure keeps its shape.
  const limit = MAX_WARP * best.transform.scale;
  const pulls = placedAnchors.map((placed, index) => {
    const target = best.matched[index] < 0 ? placed : stars[best.matched[index]];
    return clampVector([target[0] - placed[0], target[1] - placed[1]], limit);
  });

  const warp = (point: FigurePoint): FigurePoint => {
    let dx = 0;
    let dy = 0;
    let total = 0;
    for (let index = 0; index < placedAnchors.length; index += 1) {
      const weight = 1 / (0.02 + squaredDistance(point, placedAnchors[index]));
      dx += pulls[index][0] * weight;
      dy += pulls[index][1] * weight;
      total += weight;
    }
    return total === 0 ? point : [point[0] + dx / total, point[1] + dy / total];
  };

  const strokes: FittedStroke[] = figure.strokes
    .map((stroke): FittedStroke => ({ kind: "figure", points: stroke.map((point) => warp(applySimilarity(point, best.transform))) }))
    .filter((stroke) => stroke.points.length > 1);

  for (let index = 0; index < stars.length; index += 1) {
    const nearest = nearestPointOnStrokes(stars[index], strokes);
    if (!nearest || distance(nearest, stars[index]) <= LEAD_THRESHOLD) continue;
    strokes.push({ kind: "lead", points: [stars[index], nearest] });
  }

  return { strokes: contain(strokes), matched: best.matched };
}

type Similarity = { scale: number; rotation: number; tx: number; ty: number };

// Correspondence between anchors and stars is unknown, so start from several rotations, greedily
// pair each anchor with its nearest free star, refit, and keep whichever start settles best.
function bestAlignment(anchors: readonly FigurePoint[], stars: readonly FigurePoint[]) {
  const anchorCentre = centroid(anchors);
  const starCentre = centroid(stars);
  const anchorSpread = Math.max(1e-6, rootMeanSquare(anchors, anchorCentre));
  const starSpread = Math.max(1e-6, rootMeanSquare(stars, starCentre));

  let best: { transform: Similarity; matched: number[]; cost: number } | null = null;

  for (let step = 0; step < INITIAL_TILTS; step += 1) {
    const rotation = -MAX_TILT + (2 * MAX_TILT * step) / (INITIAL_TILTS - 1);
    let transform: Similarity = {
      scale: starSpread / anchorSpread,
      rotation,
      tx: starCentre[0] - (starSpread / anchorSpread) * (Math.cos(rotation) * anchorCentre[0] - Math.sin(rotation) * anchorCentre[1]),
      ty: starCentre[1] - (starSpread / anchorSpread) * (Math.sin(rotation) * anchorCentre[0] + Math.cos(rotation) * anchorCentre[1]),
    };
    let matched = matchAnchors(anchors, stars, transform);

    for (let pass = 0; pass < REFINEMENT_PASSES; pass += 1) {
      const refitted = refit(anchors, stars, matched, transform);
      const nextMatched = matchAnchors(anchors, stars, refitted);
      transform = refitted;
      if (nextMatched.every((value, index) => value === matched[index])) break;
      matched = nextMatched;
    }

    const cost = matchCost(anchors, stars, matched, transform);
    if (!best || cost < best.cost) best = { transform, matched, cost };
  }

  return best!;
}

function matchAnchors(anchors: readonly FigurePoint[], stars: readonly FigurePoint[], transform: Similarity): number[] {
  const pairs: { anchor: number; star: number; cost: number }[] = [];
  for (let anchor = 0; anchor < anchors.length; anchor += 1) {
    const placed = applySimilarity(anchors[anchor], transform);
    for (let star = 0; star < stars.length; star += 1) {
      pairs.push({ anchor, star, cost: squaredDistance(placed, stars[star]) });
    }
  }
  pairs.sort((left, right) => left.cost - right.cost || left.anchor - right.anchor || left.star - right.star);

  const matched = anchors.map(() => -1);
  const usedStars = new Set<number>();
  for (const pair of pairs) {
    if (matched[pair.anchor] !== -1 || usedStars.has(pair.star)) continue;
    matched[pair.anchor] = pair.star;
    usedStars.add(pair.star);
  }
  return matched;
}

// Closed-form least-squares similarity for the pairs that matched.
function refit(anchors: readonly FigurePoint[], stars: readonly FigurePoint[], matched: readonly number[], fallback: Similarity): Similarity {
  const pairs = matched.map((star, anchor) => ({ from: anchors[anchor], to: star < 0 ? null : stars[star] })).filter((pair) => pair.to !== null) as { from: FigurePoint; to: FigurePoint }[];
  if (pairs.length < 2) return fallback;

  const from = centroid(pairs.map((pair) => pair.from));
  const to = centroid(pairs.map((pair) => pair.to));
  let dotSum = 0;
  let crossSum = 0;
  let norm = 0;
  for (const pair of pairs) {
    const ax = pair.from[0] - from[0];
    const ay = pair.from[1] - from[1];
    const bx = pair.to[0] - to[0];
    const by = pair.to[1] - to[1];
    dotSum += ax * bx + ay * by;
    crossSum += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  if (norm <= 1e-12) return fallback;

  const rotation = clampTilt(Math.atan2(crossSum, dotSum));
  const scale = Math.hypot(dotSum, crossSum) / norm;
  if (!Number.isFinite(scale) || scale <= 1e-9) return fallback;

  return {
    scale,
    rotation,
    tx: to[0] - scale * (Math.cos(rotation) * from[0] - Math.sin(rotation) * from[1]),
    ty: to[1] - scale * (Math.sin(rotation) * from[0] + Math.cos(rotation) * from[1]),
  };
}

function clampTilt(rotation: number): number {
  const wrapped = Math.atan2(Math.sin(rotation), Math.cos(rotation));
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, wrapped));
}

function matchCost(anchors: readonly FigurePoint[], stars: readonly FigurePoint[], matched: readonly number[], transform: Similarity): number {
  let total = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    if (matched[index] < 0) continue;
    total += squaredDistance(applySimilarity(anchors[index], transform), stars[matched[index]]);
  }
  // An unmatched star is a star the figure ignored; penalise it so a pose that reaches more of the
  // constellation wins over one that huddles around a few.
  const reached = new Set(matched.filter((value) => value >= 0));
  return total + (stars.length - reached.size) * 0.05;
}

function applySimilarity(point: FigurePoint, transform: Similarity): FigurePoint {
  const cos = Math.cos(transform.rotation) * transform.scale;
  const sin = Math.sin(transform.rotation) * transform.scale;
  return [cos * point[0] - sin * point[1] + transform.tx, sin * point[0] + cos * point[1] + transform.ty];
}

function nearestPointOnStrokes(target: FigurePoint, strokes: readonly FittedStroke[]): FigurePoint | null {
  let best: FigurePoint | null = null;
  let bestDistance = Infinity;
  for (const stroke of strokes) {
    if (stroke.kind !== "figure") continue;
    for (let index = 0; index + 1 < stroke.points.length; index += 1) {
      const candidate = closestOnSegment(target, stroke.points[index], stroke.points[index + 1]);
      const candidateDistance = squaredDistance(candidate, target);
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        best = candidate;
      }
    }
  }
  return best;
}

function closestOnSegment(point: FigurePoint, from: FigurePoint, to: FigurePoint): FigurePoint {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return from;
  const amount = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return [from[0] + dx * amount, from[1] + dy * amount];
}

function contain(strokes: readonly FittedStroke[]): FittedStroke[] {
  let reach = 0;
  for (const stroke of strokes) for (const point of stroke.points) reach = Math.max(reach, Math.hypot(point[0], point[1]));
  if (reach <= FIGURE_EXTENT) return [...strokes];

  const factor = FIGURE_EXTENT / reach;
  return strokes.map((stroke) => ({ kind: stroke.kind, points: stroke.points.map((point): FigurePoint => [point[0] * factor, point[1] * factor]) }));
}

function clampVector(vector: FigurePoint, limit: number): FigurePoint {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= limit || length === 0) return vector;
  return [(vector[0] / length) * limit, (vector[1] / length) * limit];
}

function centroid(points: readonly FigurePoint[]): FigurePoint {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0] / points.length;
    y += point[1] / points.length;
  }
  return [x, y];
}

function rootMeanSquare(points: readonly FigurePoint[], centre: FigurePoint): number {
  let total = 0;
  for (const point of points) total += squaredDistance(point, centre) / points.length;
  return Math.sqrt(total);
}

function squaredDistance(left: FigurePoint, right: FigurePoint): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function distance(left: FigurePoint, right: FigurePoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
