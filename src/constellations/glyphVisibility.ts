import type { Vector3 } from "../universe/generateUniverse";

type FootprintSystem = {
  id: number;
  position: Vector3;
};

// The sky region a constellation occupies, as a spherical cap: a unit direction towards the mean of
// its Solar System directions, plus the angular radius that reaches the farthest of them.
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

// A glyph's ornament reaches past its member Solar Systems by this factor of the footprint radius,
// so occlusion has to reserve the larger, drawn extent rather than the bare star cloud.
export const ORNAMENT_EXTENT = 1.35;

export function computeGlyphFootprint(
  constellationId: number,
  systems: readonly FootprintSystem[],
  observerPosition: Vector3,
  excludedSystemIds: ReadonlySet<number>,
): GlyphFootprint | null {
  const directions: Vector3[] = [];
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let nearestDistance = Infinity;

  for (const system of systems) {
    if (excludedSystemIds.has(system.id)) continue;
    const dx = system.position[0] - observerPosition[0];
    const dy = system.position[1] - observerPosition[1];
    const dz = system.position[2] - observerPosition[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance === 0) continue;
    const direction: Vector3 = [dx / distance, dy / distance, dz / distance];
    directions.push(direction);
    sumX += direction[0];
    sumY += direction[1];
    sumZ += direction[2];
    if (distance < nearestDistance) nearestDistance = distance;
  }

  if (directions.length < 2) return null;

  const meanLength = Math.hypot(sumX, sumY, sumZ);
  // Directions that cancel out exactly have no meaningful cap centre; the observer is effectively
  // surrounded by the constellation, which is the home-constellation case handled by the caller.
  if (meanLength === 0) return null;
  const center: Vector3 = [sumX / meanLength, sumY / meanLength, sumZ / meanLength];

  let radius = 0;
  for (const direction of directions) {
    const cos = Math.max(-1, Math.min(1, direction[0] * center[0] + direction[1] * center[1] + direction[2] * center[2]));
    const angle = Math.acos(cos);
    if (angle > radius) radius = angle;
  }

  return { constellationId, center, radius, nearestDistance };
}

// Foreground glyphs hide the ones behind them, whole. Candidates are walked nearest first, and each
// is kept only when its drawn extent clears every already-kept glyph's drawn extent - so an
// accepted set never overlaps, and a blocked constellation is dropped entirely rather than losing
// the few stars that happen to line up behind something.
export function selectVisibleConstellationIds(
  systemsByConstellation: ReadonlyMap<number, readonly FootprintSystem[]>,
  observerPosition: Vector3,
  excludedConstellationIds: ReadonlySet<number>,
  excludedSystemIds: ReadonlySet<number>,
): number[] {
  const candidates: GlyphFootprint[] = [];
  for (const [constellationId, systems] of systemsByConstellation) {
    if (excludedConstellationIds.has(constellationId)) continue;
    const footprint = computeGlyphFootprint(constellationId, systems, observerPosition, excludedSystemIds);
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
  const separation = Math.acos(cos);
  return separation >= left.radius * ORNAMENT_EXTENT + right.radius * ORNAMENT_EXTENT + GLYPH_SEPARATION_RADIANS;
}
