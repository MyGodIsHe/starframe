// Placing a Sigil Figure on a Constellation's real stars.
//
// Star atlases have always worked one way round: the lion is drawn as a lion, and the stars fall on
// its eye, its paw, its tail. So a figure is never bent through the Solar Systems - it is moved onto
// them, and what moves is the whole figure at once.
//
// The move is a similarity and nothing more: turn, scale, shift. What arrives here is a sculpted
// body, and a body cannot be stretched towards a star an anchor failed to reach without becoming a
// different body from every other angle. The line art this replaced could be warped a little
// because it was a drawing and a drawing has no far side; a model has one, so the fit either
// reaches a star or leaves it to a Glyph Lead.
//
// Everything here is in chart space, where the constellation's Solar Systems sit inside the unit
// circle with the farthest one on it.

export type FitPoint = readonly [number, number];
export type ChartStar = { systemId: number; x: number; y: number };

/** Turn, scale and shift, in the constellation's own plane. */
export type Placement = { scale: number; rotation: number; tx: number; ty: number };

export type AnchorFit = {
  placement: Placement;
  /** Which star each anchor was matched to, by index into the input points; -1 for none. */
  matched: readonly number[];
};

// A figure has an inherent upright. The Glyph Chart already carries a stable sense of up from the
// galactic axis, so the fit is allowed to tilt a figure only this far: a crown rotated to lie on
// its side stops being a crown, which is exactly how the first fitted sheet failed.
export const MAX_TILT = (24 * Math.PI) / 180;

// Total reach allowed, matching what Glyph Occlusion reserves around the footprint.
export const FIGURE_EXTENT = 1.35;

// A star further than this from the drawing gets a lead line, so every Solar System is visibly part
// of the glyph even when no anchor reached it.
export const LEAD_THRESHOLD = 0.06;

const INITIAL_TILTS = 7;
const REFINEMENT_PASSES = 6;

export function fitAnchors(anchors: readonly FitPoint[], stars: readonly ChartStar[]): AnchorFit | null {
  if (anchors.length === 0 || stars.length === 0) return null;
  return bestAlignment(anchors, stars.map((star): FitPoint => [star.x, star.y]));
}

export function placePoint(point: FitPoint, placement: Placement): FitPoint {
  const cos = Math.cos(placement.rotation) * placement.scale;
  const sin = Math.sin(placement.rotation) * placement.scale;
  return [cos * point[0] - sin * point[1] + placement.tx, sin * point[0] + cos * point[1] + placement.ty];
}

// Correspondence between anchors and stars is unknown, so start from several rotations, greedily
// pair each anchor with its nearest free star, refit, and keep whichever start settles best.
function bestAlignment(anchors: readonly FitPoint[], stars: readonly FitPoint[]): AnchorFit {
  const anchorCentre = centroid(anchors);
  const starCentre = centroid(stars);
  const anchorSpread = Math.max(1e-6, rootMeanSquare(anchors, anchorCentre));
  const starSpread = Math.max(1e-6, rootMeanSquare(stars, starCentre));

  let best: { placement: Placement; matched: number[]; cost: number } | null = null;

  for (let step = 0; step < INITIAL_TILTS; step += 1) {
    const rotation = -MAX_TILT + (2 * MAX_TILT * step) / (INITIAL_TILTS - 1);
    let placement: Placement = {
      scale: starSpread / anchorSpread,
      rotation,
      tx: starCentre[0] - (starSpread / anchorSpread) * (Math.cos(rotation) * anchorCentre[0] - Math.sin(rotation) * anchorCentre[1]),
      ty: starCentre[1] - (starSpread / anchorSpread) * (Math.sin(rotation) * anchorCentre[0] + Math.cos(rotation) * anchorCentre[1]),
    };
    let matched = matchAnchors(anchors, stars, placement);

    for (let pass = 0; pass < REFINEMENT_PASSES; pass += 1) {
      const refitted = refit(anchors, stars, matched, placement);
      const nextMatched = matchAnchors(anchors, stars, refitted);
      placement = refitted;
      if (nextMatched.every((value, index) => value === matched[index])) break;
      matched = nextMatched;
    }

    const cost = matchCost(anchors, stars, matched, placement);
    if (!best || cost < best.cost) best = { placement, matched, cost };
  }

  return { placement: best!.placement, matched: best!.matched };
}

function matchAnchors(anchors: readonly FitPoint[], stars: readonly FitPoint[], placement: Placement): number[] {
  const pairs: { anchor: number; star: number; cost: number }[] = [];
  for (let anchor = 0; anchor < anchors.length; anchor += 1) {
    const placed = placePoint(anchors[anchor], placement);
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
function refit(anchors: readonly FitPoint[], stars: readonly FitPoint[], matched: readonly number[], fallback: Placement): Placement {
  const pairs = matched
    .map((star, anchor) => ({ from: anchors[anchor], to: star < 0 ? null : stars[star] }))
    .filter((pair): pair is { from: FitPoint; to: FitPoint } => pair.to !== null);
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

function matchCost(anchors: readonly FitPoint[], stars: readonly FitPoint[], matched: readonly number[], placement: Placement): number {
  let total = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    if (matched[index] < 0) continue;
    total += squaredDistance(placePoint(anchors[index], placement), stars[matched[index]]);
  }
  // An unmatched star is a star the figure ignored; penalise it so a pose that reaches more of the
  // constellation wins over one that huddles around a few.
  const reached = new Set(matched.filter((value) => value >= 0));
  return total + (stars.length - reached.size) * 0.05;
}

function centroid(points: readonly FitPoint[]): FitPoint {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0] / points.length;
    y += point[1] / points.length;
  }
  return [x, y];
}

function rootMeanSquare(points: readonly FitPoint[], centre: FitPoint): number {
  let total = 0;
  for (const point of points) total += squaredDistance(point, centre) / points.length;
  return Math.sqrt(total);
}

function squaredDistance(left: FitPoint, right: FitPoint): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}
