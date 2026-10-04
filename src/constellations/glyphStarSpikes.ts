import { DISTANCE_CUE_DISTANCE } from "../interstellarProjection";
import type { RenderQuality } from "../renderQuality";

export const GLYPH_STAR_SPIKE_COUNT = 8;
export const GLYPH_STAR_TWINKLE_PERIOD_SECONDS = 2.5;

// How far an arm reaches across its billboard, as a fraction of the billboard's half-width. The
// retreating four never shrink far enough to lose their tips, so a star always shows eight arms.
export const GLYPH_STAR_SPIKE_REACH_MIN = 0.74;
export const GLYPH_STAR_SPIKE_REACH_MAX = 0.96;

// A Glyph Star's drawn diameter in CSS pixels: the first number is a star the observer all but
// stands inside, the second the farthest one a visible Glyph still reaches. The falloff shares
// DISTANCE_CUE_DISTANCE with the Celestial Map's Distance Cue, so a Glyph Star's size and a map
// star's brightness fade on the same distance scale rather than on two authored ones. It is
// hyperbolic rather than linear for the same reason the Distance Cue is: half of the stars a Glyph
// draws stand beyond four light years, and a linear ramp would hand all of them one size.
export const GLYPH_STAR_DIAMETER_PIXELS: Record<RenderQuality["name"], readonly [number, number]> = {
  desktop: [98, 36],
  mobile: [74, 28],
};

// The distance a Glyph Star is drawn at where there is no Solar System to measure one from - the
// workshop page, whose anchors are places on a model. One light year is the Distance Cue's own
// midpoint, so the page previews a star of ordinary size rather than the nearest or farthest one.
export const GLYPH_STAR_PREVIEW_DISTANCE = DISTANCE_CUE_DISTANCE;

// The ray's colour ramp, as fractions of the way from the Glyph's own colour to white, and the
// saturation the tip is deepened by. The core burns white, the body of an arm carries the Glyph
// colour, and the tip deepens into it - a flare reads as light with a temperature across it, not as
// one flat fill.
export const GLYPH_STAR_CORE_WHITENING = 0.82;
export const GLYPH_STAR_BODY_WHITENING = 0.26;
export const GLYPH_STAR_TIP_SATURATION = 1.3;

// Real optics spread a flare's colour along its arms. The red channel runs the ramp slightly ahead
// of the green and the blue slightly behind, so an arm's far half carries a faint chromatic
// gradient instead of a single hue stretched out to the tip.
export const GLYPH_STAR_CHROMATIC_SPREAD = 0.14;

export const GLYPH_STAR_WHITE_FADE: readonly [number, number] = [0.02, 0.44];
export const GLYPH_STAR_DEEPEN_FADE: readonly [number, number] = [0.36, 1];

// A stable phase keeps neighbouring glyph stars from flashing in lockstep while ensuring that a
// system retains the same rhythm when its constellation leaves and later returns to the sky.
export function glyphStarSpikePhase(systemId: number): number {
  let hash = systemId | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash ^= hash >>> 16;
  return ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2;
}

// Mirrors the reach term of the spike shader in ConstellationGlyphs.tsx, so the twinkle's shape can
// be reasoned about and tested outside the GPU. `alternate` tells the two sets of arms apart: 1 on
// the four aligned with the optical axes, 0 on the four between them. Over one period the sine hands
// the stretch from one set to the other and back, so four arms grow while four draw in, and then
// they trade - a twinkle, rather than the whole star breathing in and out together.
export function glyphStarSpikeReach(alternate: number, seconds: number, phase: number): number {
  const swap = Math.sin((seconds * Math.PI * 2) / GLYPH_STAR_TWINKLE_PERIOD_SECONDS + phase);
  const stretch = 0.5 + (alternate - 0.5) * swap;
  return GLYPH_STAR_SPIKE_REACH_MIN + (GLYPH_STAR_SPIKE_REACH_MAX - GLYPH_STAR_SPIKE_REACH_MIN) * stretch;
}

// How wide a Glyph Star is drawn, from the physical distance between the observer's Solar System
// and the star's own. Nothing here is normalized against the glyphs currently in the sky: a star
// keeps its size when its neighbours leave the sky, and growing means the observer came closer.
export function glyphStarDiameter(distance: number, profile: RenderQuality["name"]): number {
  const [near, far] = GLYPH_STAR_DIAMETER_PIXELS[profile];
  return far + (near - far) / (1 + Math.max(0, distance) / DISTANCE_CUE_DISTANCE);
}

// Mirrors the tint ramp of the spike shader, so the colour an arm carries along its length can be
// reasoned about and tested outside the GPU. `along` is how far out the arm the light being tinted
// sits, 0 at the core and 1 at the tip.
export function glyphStarRayTint(hue: readonly [number, number, number], along: number): [number, number, number] {
  return [0, 1, 2].map((channel) => {
    const ramp = clamp(along * (1 + (1 - channel) * GLYPH_STAR_CHROMATIC_SPREAD), 0, 1);
    const hot = whiten(hue[channel], GLYPH_STAR_CORE_WHITENING);
    const body = whiten(hue[channel], GLYPH_STAR_BODY_WHITENING);
    const tip = clamp(hue[channel] * hue[channel] * GLYPH_STAR_TIP_SATURATION, 0, 1);
    const near = mix(hot, body, smoothstep(GLYPH_STAR_WHITE_FADE[0], GLYPH_STAR_WHITE_FADE[1], ramp));
    return mix(near, tip, smoothstep(GLYPH_STAR_DEEPEN_FADE[0], GLYPH_STAR_DEEPEN_FADE[1], ramp));
  }) as [number, number, number];
}

function whiten(channel: number, amount: number): number {
  return channel + (1 - channel) * amount;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const scaled = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return scaled * scaled * (3 - 2 * scaled);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
