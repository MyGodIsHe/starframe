import { CELESTIAL_MAP_RADIUS } from "./constellations/constellationGlyphModel";
import { distanceCueBrightness, OBSERVER_FADE_DISTANCE, type InterstellarSystem } from "./interstellarProjection";
import { desaturateTowardWhite, spectralClassColor } from "./spectralClass";
import type { Vector3 } from "./universe/generateUniverse";

export type StarFieldSystem = InterstellarSystem & { spectralClass: string };

// Narrows a full RenderQuality profile down to only the fields the Celestial Star Field renderer
// needs, so its model stays independent from the rest of the scene's quality controls.
export function toStarFieldQualityBudget(quality: { starHaloMaxSize: number; starHaloIntensity: number; starHaloEdgeScaleMax: number }): StarFieldQualityBudget {
  return {
    haloMaxSize: quality.starHaloMaxSize,
    haloIntensity: quality.starHaloIntensity,
    haloEdgeScaleMax: quality.starHaloEdgeScaleMax,
  };
}

export type StarFieldQualityBudget = {
  haloMaxSize: number;
  haloIntensity: number;
  haloEdgeScaleMax: number;
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

// Every Celestial Map star is drawn at four fifths of the brightness its Distance Cue asks for.
// The sky a Constellation Glyph stands in front of is also the sky its own Glyph Stars have to be
// read against, and at full strength the field of ordinary stars - thousands of them, each with a
// halo that sums with its neighbours' - carries enough light to flatten that difference. Dimming
// the whole field by one factor keeps the Distance Cue's near/far story exactly as it was: every
// star loses the same fifth, so none of them trades places with another. The procedural background
// stars are dimmed by this same factor (see DECORATIVE_STAR_MAX_OPACITY in SpaceScene.tsx), so
// Minimum Map Brightness still reads above them and every real Solar System stays distinguishable.
export const BACKGROUND_STAR_DIMMING = 0.8;

// A perspective projection spreads a fixed solid angle over screen area proportional to
// 1 / cos(theta)^3. Scaling a round halo diameter by cos(theta)^-1.5 preserves its coverage and
// therefore its additive overlap as it moves away from the optical axis. The core remains a
// fixed-size screen cue; only the density-forming halo needs this compensation.
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
  out.coreOpacity = intensity * lerp(CORE_WEIGHT_NEAR, CORE_WEIGHT_FAR, t) * BACKGROUND_STAR_DIMMING;
  out.haloSize = Math.min(quality.haloMaxSize, lerp(HALO_SIZE_NEAR_PX, HALO_SIZE_FAR_PX, t));
  out.haloOpacity = intensity * lerp(HALO_WEIGHT_NEAR, HALO_WEIGHT_FAR, t) * quality.haloIntensity * BACKGROUND_STAR_DIMMING;
  return out;
}

// Core keeps the full spectral hue; halo is desaturated so overlapping halos in dense regions don't
// paint a large sky area an aggressive color.
const HALO_COLOR_DESATURATION = 0.45;

export function createSpectralColorBuffer(systems: readonly Pick<StarFieldSystem, "spectralClass">[], desaturation = 0): Float32Array {
  const colors = new Float32Array(systems.length * 3);
  systems.forEach((system, index) => colors.set(desaturateTowardWhite(spectralClassColor(system.spectralClass), desaturation), index * 3));
  return colors;
}

export function createHaloColorBuffer(systems: readonly Pick<StarFieldSystem, "spectralClass">[]): Float32Array {
  return createSpectralColorBuffer(systems, HALO_COLOR_DESATURATION);
}

export type StarFieldBuffers = {
  readonly positions: Float32Array;
  readonly coreSizes: Float32Array;
  readonly coreOpacities: Float32Array;
  readonly haloSizes: Float32Array;
  readonly haloOpacities: Float32Array;
};

export function createStarFieldBuffers(count: number): StarFieldBuffers {
  return {
    positions: new Float32Array(count * 3),
    coreSizes: new Float32Array(count),
    coreOpacities: new Float32Array(count),
    haloSizes: new Float32Array(count),
    haloOpacities: new Float32Array(count),
  };
}

// The single per-frame pass over every real Solar System: computes direction, physical distance,
// Distance Cue and visual attributes together, and writes straight into the
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
  }
}
