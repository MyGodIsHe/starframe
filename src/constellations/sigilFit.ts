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
// reaches a star or leaves an offline fitting lead for review.
//
// Who decides what is the whole point. Scale and centre belong to the Constellation: a figure is
// framed on the Constellation's own centre and drawn out to exactly FIGURE_EXTENT of its radius, so
// a figure and its stars always occupy the same patch of sky. Only the turn is the anchors'
// business, and only within the slight tilt a figure's own upright allows.
//
// It used to be the other way round, and that quietly produced the two faults this replaced. The
// whole similarity was fitted by least squares to whichever stars the anchors greedily paired with;
// but with the turn clamped and the correspondence arbitrary, the cheapest thing least squares can
// do is shrink the body towards the centre of the pairs it matched, and the shift it lands is the
// matched pairs' centre rather than the figure's. Measured over the real universe, a figure came out
// at a median of 0.74 of its Constellation's radius and as little as 0.27, standing beside its own
// stars by up to half that radius. Neither is a thing a rule can get wrong, which is why both are
// now rules.
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

// The reach a figure is drawn to across the Constellation's plane, as a multiple of the
// Constellation's own radius. It is exact rather than a cap: every figure is framed out to it, which
// is what makes a glyph and its stars one object on the sky instead of artwork of its own size
// standing nearby.
//
// It says nothing about what Glyph Occlusion reserves. A sculpted body also has depth, and a thick
// figure's far corner stands further from the centre than its widest point does, so the reserve is
// measured off the body that was actually placed rather than restated from here.
export const FIGURE_EXTENT = 1.15;

// A star further than this from the drawing gets a fitting lead for offline review
// of the glyph even when no anchor reached it.
export const LEAD_THRESHOLD = 0.06;

// Turns tried across the allowed tilt, one per degree. The sweep runs once per figure in the
// library, so there is nothing to save by searching it more cleverly than by looking at all of it.
const TILT_STEPS = 49;

const DEGENERATE = 1e-9;

/**
 * Every way a figure may stand, before any constellation is consulted.
 *
 * `body` is every point of the sculpted body in its own plane; what gets framed is the drawn extent,
 * so it is the body rather than the anchors that settles how big a figure comes out. Because the
 * rule looks at nothing but the body and the turn, these are a property of the figure, worked out
 * once when it joins the library rather than again for each of the hundreds of Constellations
 * wearing it.
 */
export function framingsFor(body: readonly FitPoint[]): Placement[] {
  if (body.length === 0) return [];

  const framings: Placement[] = [];
  for (let step = 0; step < TILT_STEPS; step += 1) {
    const placement = frameAt(body, -MAX_TILT + (2 * MAX_TILT * step) / (TILT_STEPS - 1));
    if (placement) framings.push(placement);
  }
  return framings;
}

/** Which of a figure's framings this constellation gets, and which system each extremity claims. */
export function frameFigure(framings: readonly Placement[], anchors: readonly FitPoint[], stars: readonly ChartStar[]): AnchorFit | null {
  if (framings.length === 0 || anchors.length === 0 || stars.length === 0) return null;
  const starPoints = stars.map((star): FitPoint => [star.x, star.y]);

  let best: { placement: Placement; matched: number[]; cost: number } | null = null;
  for (const placement of framings) {
    const matched = matchAnchors(anchors, starPoints, placement);
    const cost = coverageCost(anchors, starPoints, placement, matched);
    // Ties go to the smaller tilt: an upright figure does not lean without a reason to.
    if (!best || cost < best.cost || (cost === best.cost && Math.abs(placement.rotation) < Math.abs(best.placement.rotation))) {
      best = { placement, matched, cost };
    }
  }
  if (!best) return null;

  return { placement: best.placement, matched: best.matched };
}

/**
 * What this constellation would cost a figure framed at one particular turn.
 *
 * Exported so the turn the sweep settled on can be checked against every other turn the tilt allows,
 * including the ones between its own steps; nothing in the app calls it.
 */
export function turnCost(body: readonly FitPoint[], anchors: readonly FitPoint[], stars: readonly ChartStar[], rotation: number): number | null {
  const placement = frameAt(body, rotation);
  if (!placement || anchors.length === 0 || stars.length === 0) return null;

  const starPoints = stars.map((star): FitPoint => [star.x, star.y]);
  return coverageCost(anchors, starPoints, placement, matchAnchors(anchors, starPoints, placement));
}

export function placePoint(point: FitPoint, placement: Placement): FitPoint {
  const cos = Math.cos(placement.rotation) * placement.scale;
  const sin = Math.sin(placement.rotation) * placement.scale;
  return [cos * point[0] - sin * point[1] + placement.tx, sin * point[0] + cos * point[1] + placement.ty];
}

// The framing rule, for one turn: the body is centred on the chart origin - which is the
// Constellation's own centre - and scaled until its farthest point is exactly FIGURE_EXTENT out.
// Which constellation that is never comes into it, which is why these are worked out per figure.
//
// What it is centred on is the middle of the turned body's bounding box, not the centre of its
// smallest enclosing circle. A figure already arrives centred on its own bounding box
// (`sigilVectors.intoFigureSpace`), so after a tilt of at most 24 degrees the two differ very
// little - and the bounding box is a plain function of the points, while the smallest enclosing
// circle is normally found by a randomised search. A glyph has to come out the same body on every
// machine that builds it.
function frameAt(body: readonly FitPoint[], rotation: number): Placement | null {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const turned = body.map((point): FitPoint => [cos * point[0] - sin * point[1], sin * point[0] + cos * point[1]]);

  const middle: FitPoint = [middleOf(turned, 0), middleOf(turned, 1)];

  let reach = 0;
  for (const point of turned) reach = Math.max(reach, Math.hypot(point[0] - middle[0], point[1] - middle[1]));
  if (reach <= DEGENERATE) return null;

  const scale = FIGURE_EXTENT / reach;
  return { scale, rotation, tx: -scale * middle[0], ty: -scale * middle[1] };
}

function middleOf(points: readonly FitPoint[], axis: 0 | 1): number {
  let least = Infinity;
  let most = -Infinity;
  for (const point of points) {
    least = Math.min(least, point[axis]);
    most = Math.max(most, point[axis]);
  }
  return (least + most) / 2;
}

// What a turn is judged on, now that the turn is all it decides: how well the figure's extremities
// and the Constellation's Solar Systems answer each other, read in both directions.
//
// Anchor to star is the atlas promise, and it is read through the matching rather than through each
// anchor's nearest star, because every extremity is supposed to claim a system of its own - a pose
// that piles four anchors onto one convenient star has not put the lion's paw anywhere.
//
// Star to anchor is what the retired cost only claimed to do: it counted the stars no anchor
// reached, but greedy matching pairs the same number of them whatever pose it is handed, so that
// term was a constant and sorted nothing. Here a system left in empty sky really is dearer than one
// some limb reaches towards.
//
// Plain distances, not squared: squaring hands the whole decision to the one system furthest from
// the drawing, and each direction is averaged rather than summed, so a figure with four anchors and
// a constellation with thirteen stars still weigh the same against each other.
function coverageCost(anchors: readonly FitPoint[], stars: readonly FitPoint[], placement: Placement, matched: readonly number[]): number {
  const placed = anchors.map((anchor) => placePoint(anchor, placement));

  let claimed = 0;
  let fromAnchors = 0;
  for (const [index, point] of placed.entries()) {
    if (matched[index] < 0) continue;
    fromAnchors += distance(point, stars[matched[index]]);
    claimed += 1;
  }

  let fromStars = 0;
  for (const star of stars) fromStars += nearestDistance(star, placed) / stars.length;

  return (claimed === 0 ? 0 : fromAnchors / claimed) + fromStars;
}

function nearestDistance(point: FitPoint, candidates: readonly FitPoint[]): number {
  let nearest = Infinity;
  for (const candidate of candidates) nearest = Math.min(nearest, distance(point, candidate));
  return nearest;
}

// Which Solar System each extremity claims: the closest free pair, then the closest of what is left,
// and so on. Ties go to the earlier anchor and then the earlier star, which is why `glyphShape`
// sorts the Solar Systems before it starts - the claim has to be a pure function of the SDE build.
//
// Taken a pair at a time rather than by sorting every pair, because this runs for each turn of each
// figure on each of New Eden's constellations and there are only ever a handful of each.
function matchAnchors(anchors: readonly FitPoint[], stars: readonly FitPoint[], placement: Placement): number[] {
  const placed = anchors.map((anchor) => placePoint(anchor, placement));
  const matched = anchors.map(() => -1);
  const takenStars = stars.map(() => false);

  for (let round = 0; round < Math.min(anchors.length, stars.length); round += 1) {
    let bestAnchor = -1;
    let bestStar = -1;
    let bestCost = Infinity;

    for (let anchor = 0; anchor < placed.length; anchor += 1) {
      if (matched[anchor] !== -1) continue;
      for (let star = 0; star < stars.length; star += 1) {
        if (takenStars[star]) continue;
        const cost = squaredDistance(placed[anchor], stars[star]);
        if (cost < bestCost) {
          bestCost = cost;
          bestAnchor = anchor;
          bestStar = star;
        }
      }
    }
    if (bestAnchor < 0) break;

    matched[bestAnchor] = bestStar;
    takenStars[bestStar] = true;
  }
  return matched;
}

function distance(left: FitPoint, right: FitPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function squaredDistance(left: FitPoint, right: FitPoint): number {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}
