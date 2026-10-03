export const GLYPH_STAR_SPIKE_COUNT = 8;
export const GLYPH_STAR_TWINKLE_PERIOD_SECONDS = 5;

// How far an arm reaches across its billboard, as a fraction of the billboard's half-width. The
// retreating four never shrink far enough to lose their tips, so a star always shows eight arms.
export const GLYPH_STAR_SPIKE_REACH_MIN = 0.74;
export const GLYPH_STAR_SPIKE_REACH_MAX = 0.96;

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
