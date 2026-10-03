import type { RenderQuality } from "../renderQuality";
import type { ConstellationGlyphStroke } from "./constellationGlyphModel";

// The ladder a Constellation Glyph is drawn on, in one place.
//
// One bucket per kind of line, ordered the way the drawing reads: the outline where the body turns
// away is the strongest and most haloed line, an edge on the near side is subordinate to it, and a
// lead is barely there - a tie is bookkeeping, and it must never compete with either the artwork or
// the stars themselves.
//
// The ladder used to run on depth instead, but a glyph's strokes nearly all share one depth: 77% of
// drawn glyphs put every stroke in a single bucket, so the width and weight never varied inside a
// figure. Depth still rides along, in colour and in each stroke's own opacity.
//
// It lives apart from the renderer because the sky is not the only place a glyph is drawn: the
// workshop page shows one sigil on its own, and a second set of numbers there would drift from this
// one and quietly stop being a preview of anything.

export type GlyphStrokeKind = ConstellationGlyphStroke["kind"];

export const GLYPH_BUCKET_COUNT = 3;
export const GLYPH_BUCKET_BY_KIND: Record<GlyphStrokeKind, number> = { interior: 0, silhouette: 1, lead: 2 };
export const GLYPH_STROKE_FLOOR: Record<GlyphStrokeKind, number> = { silhouette: 0.62, interior: 0.42, lead: 0.26 };
export const GLYPH_STROKE_DEPTH_GAIN: Record<GlyphStrokeKind, number> = { silhouette: 0.38, interior: 0.4, lead: 0.3 };

export type GlyphBucketStyle = { coreWidth: number; haloWidth: number; coreOpacity: number; haloOpacity: number };

// The outline carries the glow, so the halo climbs with the ladder instead of standing in for
// distance.
const CORE_OPACITIES = [0.68, 0.9, 0.34];
const HALO_OPACITIES = [0.14, 0.22, 0.05];

export function glyphBucketStyles(profile: RenderQuality["name"]): GlyphBucketStyle[] {
  const coreWidths = profile === "mobile" ? [0.8, 1.15, 0.42] : [1.05, 1.5, 0.55];
  const haloWidths = profile === "mobile" ? [2.3, 2.7, 1.2] : [3, 3.5, 1.6];
  return Array.from({ length: GLYPH_BUCKET_COUNT }, (_, bucket) => ({
    coreWidth: coreWidths[bucket],
    haloWidth: haloWidths[bucket],
    coreOpacity: CORE_OPACITIES[bucket],
    haloOpacity: HALO_OPACITIES[bucket],
  }));
}

// Each kind keeps a floor of its own, so a far glyph still reads as an outline with detail inside it
// rather than dissolving into one even wash.
export function glyphStrokeIntensity(kind: GlyphStrokeKind, opacity: number, proximity: number): number {
  return opacity * (GLYPH_STROKE_FLOOR[kind] + proximity * GLYPH_STROKE_DEPTH_GAIN[kind]);
}

// Glyph Depth Cue as a colour: a stroke physically nearer the observer is sharper cyan, a distant
// one violet.
export function writeGlyphColor(target: Float32Array, offset: number, proximity: number, isOrnament = false): void {
  const red = 98 + (85 - 98) * proximity;
  const green = 91 + (223 - 91) * proximity;
  const blue = 220 + (255 - 220) * proximity;
  // A lead line shares the depth ramp but sits closer to mid-grey, so it reads as a faint tie
  // rather than as part of the drawing.
  const mix = isOrnament ? 0.45 : 0;
  const grey = (red + green + blue) / 3;
  target[offset] = (red + (grey - red) * mix) / 255;
  target[offset + 1] = (green + (grey - green) * mix) / 255;
  target[offset + 2] = (blue + (grey - blue) * mix) / 255;
}
