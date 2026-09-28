import { CELESTIAL_MAP_RADIUS } from "./constellations/constellationGlyphModel";
import { distanceCueBrightness, OBSERVER_FADE_DISTANCE, type InterstellarSystem } from "./interstellarProjection";
import { desaturateTowardWhite, spectralClassColor } from "./spectralClass";
import type { Vector3 } from "./universe/generateUniverse";

export type StarFieldSystem = InterstellarSystem & { spectralClass: string; radius: number };

// Narrows a full RenderQuality profile down to only the fields this module needs, in one place, so
// SpaceScene.tsx's diagnostic candidate count and CelestialStarField.tsx's renderer read the exact
// same budget shape instead of two independently-maintained field lists.
export function toStarFieldQualityBudget(quality: { starHaloMaxSize: number; starHaloIntensity: number; starHaloEdgeScaleMax: number; diffractionThreshold: number; diffractionSpriteSize: number; diffractionIntensity: number }): StarFieldQualityBudget {
  return {
    haloMaxSize: quality.starHaloMaxSize,
    haloIntensity: quality.starHaloIntensity,
    haloEdgeScaleMax: quality.starHaloEdgeScaleMax,
    diffractionThreshold: quality.diffractionThreshold,
    diffractionSpriteSize: quality.diffractionSpriteSize,
    diffractionIntensity: quality.diffractionIntensity,
  };
}

export type StarFieldQualityBudget = {
  haloMaxSize: number;
  haloIntensity: number;
  haloEdgeScaleMax: number;
  // See "Rare diffraction spikes" below: diffractionThreshold is where the Visible Brightness ramp
  // starts, diffractionSpriteSize is the on-screen sprite diameter cap, diffractionIntensity is a
  // 0-1 output multiplier a stricter profile (mobile) can use to dim the cue without moving the
  // threshold that decides *which* stars qualify.
  diffractionThreshold: number;
  diffractionSpriteSize: number;
  diffractionIntensity: number;
};

// Fixed physical thresholds (not a per-dataset min/max) so one irrelevant far or near system can
// never change how any other system looks. Chosen from the real SDE distance distribution: a
// system's own constellation neighbours sit mostly within ~1.5 ly (median nearest-neighbour
// distance is ~0.77 ly), matching the existing Constellation Glyph "nearby" radius of ~10.6 ly
// (NEARBY_CONSTELLATION_RADIUS in constellationGlyphModel.ts). NEAR sits inside that local
// cluster; FAR sits past it, where the bulk of the New Eden systems (up to ~1400 ly away) should
// aggregate into halo glow rather than compete individually with nearby stars.
const LIGHT_YEAR_METERS = 9_460_000_000_000_000;
export const NEAR_STAR_DISTANCE = 2 * LIGHT_YEAR_METERS;
export const FAR_STAR_DISTANCE = 40 * LIGHT_YEAR_METERS;

const CORE_SIZE_NEAR_PX = 3.6;
const CORE_SIZE_FAR_PX = 2;
const CORE_WEIGHT_NEAR = 1;
const CORE_WEIGHT_FAR = 0.55;
const HALO_SIZE_NEAR_PX = 7;
const HALO_SIZE_FAR_PX = 26;
const HALO_WEIGHT_NEAR = 0.45;
const HALO_WEIGHT_FAR = 1;

// A perspective projection spreads a fixed solid angle over screen area proportional to
// 1 / cos(theta)^3. Scaling a round halo diameter by cos(theta)^-1.5 preserves its coverage and
// therefore its additive overlap as it moves away from the optical axis. Core and diffraction
// remain fixed-size screen cues; only the density-forming halo needs this compensation.
export const PERSPECTIVE_HALO_SCALE_EXPONENT = 1.5;

export function computePerspectiveHaloScale(viewCosine: number, maxScale: number): number {
  const cosine = clamp(viewCosine, Number.EPSILON, 1);
  return Math.min(maxScale, cosine ** -PERSPECTIVE_HALO_SCALE_EXPONENT);
}

export type StarVisualAttributes = {
  coreSize: number;
  coreOpacity: number;
  haloSize: number;
  haloOpacity: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

// A continuous near/mid/far blend driven by fixed physical distance, not dataset normalization:
// smoothstep keeps the transition smooth across the two thresholds instead of a hard cutoff.
function distanceMix(distance: number): number {
  return smoothstep(NEAR_STAR_DISTANCE, FAR_STAR_DISTANCE, distance);
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// `intensity` is the system's Distance Cue brightness * opacity (see interstellarProjection.ts) -
// the same value that already drives the plain point cloud's vertex color today. `out` lets the
// per-frame star field writer reuse a single scratch object across every system instead of
// allocating one per star per frame.
export function computeStarVisualAttributes(distance: number, intensity: number, quality: StarFieldQualityBudget, out: StarVisualAttributes = { coreSize: 0, coreOpacity: 0, haloSize: 0, haloOpacity: 0 }): StarVisualAttributes {
  const t = distanceMix(distance);
  out.coreSize = lerp(CORE_SIZE_NEAR_PX, CORE_SIZE_FAR_PX, t);
  out.coreOpacity = intensity * lerp(CORE_WEIGHT_NEAR, CORE_WEIGHT_FAR, t);
  out.haloSize = Math.min(quality.haloMaxSize, lerp(HALO_SIZE_NEAR_PX, HALO_SIZE_FAR_PX, t));
  out.haloOpacity = intensity * lerp(HALO_WEIGHT_NEAR, HALO_WEIGHT_FAR, t) * quality.haloIntensity;
  return out;
}

// Core keeps the full spectral hue; halo is desaturated so overlapping halos in dense regions don't
// paint a large sky area an aggressive color; diffraction desaturates further still, since the rare
// spike cue should read as bright starlight, only faintly tinted by the source's temperature.
const HALO_COLOR_DESATURATION = 0.45;
const DIFFRACTION_COLOR_DESATURATION = 0.75;

export function createSpectralColorBuffer(systems: readonly Pick<StarFieldSystem, "spectralClass">[], desaturation = 0): Float32Array {
  const colors = new Float32Array(systems.length * 3);
  systems.forEach((system, index) => colors.set(desaturateTowardWhite(spectralClassColor(system.spectralClass), desaturation), index * 3));
  return colors;
}

export function createHaloColorBuffer(systems: readonly Pick<StarFieldSystem, "spectralClass">[]): Float32Array {
  return createSpectralColorBuffer(systems, HALO_COLOR_DESATURATION);
}

export function createDiffractionColorBuffer(systems: readonly Pick<StarFieldSystem, "spectralClass">[]): Float32Array {
  return createSpectralColorBuffer(systems, DIFFRACTION_COLOR_DESATURATION);
}

// Visible Brightness: a single per-star presentation cue for "how bright does this individual point
// source look", used only to decide diffraction eligibility. It is a fixed function of a star's own
// distance and its own SDE radius - never of neighbour count, halo accumulation or a framebuffer
// read - so a dense cluster of dim stars can never trigger it and one irrelevant extreme system can
// never change another star's value. Radius is a minimal, explicitly non-physical stand-in for
// luminosity (the SDE has no luminosity field): REFERENCE_STAR_RADIUS_METERS is a fixed constant
// close to the real SDE median star radius (~309,300,000 m across all 8,089 systems), not a
// per-dataset min/max, so the factor is stable if systems are added or removed. The factor is
// clamped to a fixed range for the same reason distance thresholds are fixed elsewhere in this
// module - it bounds the presentation, it does not normalize against the current dataset.
export const REFERENCE_STAR_RADIUS_METERS = 300_000_000;
const MIN_RADIUS_FACTOR = 0.3;
const MAX_RADIUS_FACTOR = 8;

function starRadiusFactor(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 1;
  return clamp(radius / REFERENCE_STAR_RADIUS_METERS, MIN_RADIUS_FACTOR, MAX_RADIUS_FACTOR);
}

const MAX_VISIBLE_BRIGHTNESS = MAX_RADIUS_FACTOR;

export function computeVisibleBrightness(distance: number, radius: number): number {
  const opacity = Math.min(1, distance / OBSERVER_FADE_DISTANCE);
  return clamp(distanceCueBrightness(distance) * opacity * starRadiusFactor(radius), 0, MAX_VISIBLE_BRIGHTNESS);
}

// Rare diffraction spikes: a fixed Visible Brightness threshold, chosen against the real SDE radius
// distribution so that, universe-wide, only the largest ~0.5% of stars ever reach full spike
// intensity - see CelestialStarField.tsx and the final report for the measured candidate counts.
// The smoothstep width is fixed (not per-quality) so every profile shares the same steep ramp shape;
// only where that ramp sits (diffractionThreshold) and how strongly it reads (diffractionIntensity)
// differ per RenderQuality profile. This never reads density, halo accumulation or dataset extremes -
// only the star's own Visible Brightness - so a bright star crosses it and a dim one never does,
// regardless of how many neighbours surround either one.
const DIFFRACTION_SMOOTH_WIDTH = 0.9;

export function computeDiffractionIntensity(visibleBrightness: number, quality: Pick<StarFieldQualityBudget, "diffractionThreshold" | "diffractionIntensity">): number {
  const low = quality.diffractionThreshold - DIFFRACTION_SMOOTH_WIDTH / 2;
  const high = quality.diffractionThreshold + DIFFRACTION_SMOOTH_WIDTH / 2;
  return smoothstep(low, high, visibleBrightness) * quality.diffractionIntensity;
}

export type StarFieldBuffers = {
  readonly positions: Float32Array;
  readonly coreSizes: Float32Array;
  readonly coreOpacities: Float32Array;
  readonly haloSizes: Float32Array;
  readonly haloOpacities: Float32Array;
  readonly diffractionIntensities: Float32Array;
};

export function createStarFieldBuffers(count: number): StarFieldBuffers {
  return {
    positions: new Float32Array(count * 3),
    coreSizes: new Float32Array(count),
    coreOpacities: new Float32Array(count),
    haloSizes: new Float32Array(count),
    haloOpacities: new Float32Array(count),
    diffractionIntensities: new Float32Array(count),
  };
}

// The single per-frame pass over every real Solar System: computes direction, physical distance,
// Distance Cue, visual attributes and diffraction eligibility together, and writes straight into the
// reused typed arrays. Deliberately duplicates interstellarProjection.ts's Distance Cue formula call
// instead of calling projectInterstellarProjection, which would allocate a marker object and a
// direction array per system on every Stargate travel frame - see celestialStarFieldModel.test.ts's
// parity test for the guard against the two formulas drifting apart.
export function writeStarFieldFrame(systems: readonly StarFieldSystem[], observerPosition: Vector3, quality: StarFieldQualityBudget, buffers: StarFieldBuffers): void {
  const [observerX, observerY, observerZ] = observerPosition;
  const scratch: StarVisualAttributes = { coreSize: 0, coreOpacity: 0, haloSize: 0, haloOpacity: 0 };

  for (let index = 0; index < systems.length; index += 1) {
    const system = systems[index];
    const position = system.position;
    const dx = position[0] - observerX;
    const dy = position[1] - observerY;
    const dz = position[2] - observerZ;
    const distance = Math.hypot(dx, dy, dz);
    const opacity = Math.min(1, distance / OBSERVER_FADE_DISTANCE);
    const brightness = distanceCueBrightness(distance);
    const inverseDistance = distance === 0 ? 0 : CELESTIAL_MAP_RADIUS / distance;

    const offset = index * 3;
    buffers.positions[offset] = dx * inverseDistance;
    buffers.positions[offset + 1] = dy * inverseDistance;
    buffers.positions[offset + 2] = dz * inverseDistance;

    computeStarVisualAttributes(distance, brightness * opacity, quality, scratch);
    buffers.coreSizes[index] = scratch.coreSize;
    buffers.coreOpacities[index] = scratch.coreOpacity;
    buffers.haloSizes[index] = scratch.haloSize;
    buffers.haloOpacities[index] = scratch.haloOpacity;

    buffers.diffractionIntensities[index] = computeDiffractionIntensity(computeVisibleBrightness(distance, system.radius), quality);
  }
}

// Diagnostic count of how many systems currently clear the diffraction threshold at all (any
// nonzero intensity), independent of the renderer - see CelestialStarField.tsx's use as a `data-*`
// attribute for Playwright coverage without exposing shader internals to production UI.
export function countDiffractionCandidates(systems: readonly StarFieldSystem[], observerPosition: Vector3, quality: StarFieldQualityBudget): number {
  const [observerX, observerY, observerZ] = observerPosition;
  let count = 0;
  for (const system of systems) {
    const dx = system.position[0] - observerX;
    const dy = system.position[1] - observerY;
    const dz = system.position[2] - observerZ;
    const distance = Math.hypot(dx, dy, dz);
    if (computeDiffractionIntensity(computeVisibleBrightness(distance, system.radius), quality) > 0) count += 1;
  }
  return count;
}
