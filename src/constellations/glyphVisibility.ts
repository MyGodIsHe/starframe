import type { Vector3 } from "../universe/generateUniverse";

// What a Constellation Glyph occupies in space, computed once from the SDE build: the centre of a
// sphere enclosing everything the glyph draws - its Solar Systems and its figure alike - and that
// sphere's radius. Bounding the artwork rather than the bare star cloud is what lets Glyph
// Occlusion promise that two drawn glyphs never overlap.
export type GlyphBounds = {
  constellationId: number;
  centre: Vector3;
  radius: number;
};

// The sky region that sphere covers, seen from one observer.
export type GlyphFootprint = {
  constellationId: number;
  center: Vector3;
  radius: number;
  nearestDistance: number;
};

// Below this apparent size a glyph cannot be read as a figure, so it is not drawn at all. Measured
// against the real universe: the median constellation subtends only ~3 degrees, and drawing those
// is what turns the sky into overlapping scribble.
export const LEGIBILITY_FLOOR_RADIANS = (8 * Math.PI) / 180;

// Clear sky kept between two drawn glyphs, on top of their own radii.
export const GLYPH_SEPARATION_RADIANS = (3 * Math.PI) / 180;

export function boundsOf(constellationId: number, points: readonly Vector3[]): GlyphBounds | null {
  if (points.length === 0) return null;

  const centre: Vector3 = [0, 0, 0];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) centre[axis] += point[axis] / points.length;

  let radius = 0;
  for (const point of points) {
    radius = Math.max(radius, Math.hypot(point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]));
  }
  return { constellationId, centre, radius };
}

export function computeGlyphFootprint(bounds: GlyphBounds, observerPosition: Vector3): GlyphFootprint | null {
  const dx = bounds.centre[0] - observerPosition[0];
  const dy = bounds.centre[1] - observerPosition[1];
  const dz = bounds.centre[2] - observerPosition[2];
  const distance = Math.hypot(dx, dy, dz);

  // An observer inside the sphere is surrounded by the glyph rather than looking at it; that is the
  // home constellation, which is drawn a different way and claims no sky.
  if (distance <= bounds.radius || distance === 0) return null;

  return {
    constellationId: bounds.constellationId,
    center: [dx / distance, dy / distance, dz / distance],
    radius: Math.asin(Math.min(1, bounds.radius / distance)),
    nearestDistance: distance - bounds.radius,
  };
}

// Foreground glyphs hide the ones behind them, whole. Candidates are walked nearest first, and each
// is kept only when its sky region clears every already-kept glyph's region - so an accepted set
// never overlaps, and a blocked constellation is dropped entirely rather than losing the few stars
// that happen to line up behind something.
export function selectVisibleConstellationIds(
  boundsByConstellation: ReadonlyMap<number, GlyphBounds>,
  observerPosition: Vector3,
  excludedConstellationIds: ReadonlySet<number>,
): number[] {
  const candidates: GlyphFootprint[] = [];
  for (const [constellationId, bounds] of boundsByConstellation) {
    if (excludedConstellationIds.has(constellationId)) continue;
    const footprint = computeGlyphFootprint(bounds, observerPosition);
    if (footprint && footprint.radius >= LEGIBILITY_FLOOR_RADIANS) candidates.push(footprint);
  }

  candidates.sort((left, right) => left.nearestDistance - right.nearestDistance || left.constellationId - right.constellationId);

  const accepted: GlyphFootprint[] = [];
  for (const candidate of candidates) {
    if (accepted.every((kept) => clearsFootprint(kept, candidate))) accepted.push(candidate);
  }

  return accepted.map((footprint) => footprint.constellationId).sort((left, right) => left - right);
}

export function clearsFootprint(left: GlyphFootprint, right: GlyphFootprint): boolean {
  const cos = Math.max(-1, Math.min(1, left.center[0] * right.center[0] + left.center[1] * right.center[1] + left.center[2] * right.center[2]));
  return Math.acos(cos) >= left.radius + right.radius + GLYPH_SEPARATION_RADIANS;
}
