import type { RenderQuality } from "../renderQuality";
import { SCENE_PALETTE } from "../scenePalette";
import type { ConstellationGlyphStroke } from "./constellationGlyphModel";

// The ladder a Constellation Glyph is drawn on, in one place.
//
// One bucket per kind of line, ordered the way the drawing reads: the outline where the body turns
// away is the strongest and most haloed line, and an edge on the near side is subordinate to it.
//
// The ladder used to run on depth instead, but a glyph's strokes nearly all share one depth: 77% of
// drawn glyphs put every stroke in a single bucket, so the width and weight never varied inside a
// figure. Depth still rides along, in colour and in each stroke's own opacity.
//
// It lives apart from the renderer because the sky is not the only place a glyph is drawn: the
// workshop page shows one sigil on its own, and a second set of numbers there would drift from this
// one and quietly stop being a preview of anything.

export type GlyphStrokeKind = ConstellationGlyphStroke["kind"];

export const GLYPH_BUCKET_COUNT = 2;
export const GLYPH_BUCKET_BY_KIND: Record<GlyphStrokeKind, number> = { interior: 0, silhouette: 1 };
export const GLYPH_STROKE_FLOOR: Record<GlyphStrokeKind, number> = { silhouette: 0.62, interior: 0.42 };
export const GLYPH_STROKE_DEPTH_GAIN: Record<GlyphStrokeKind, number> = { silhouette: 0.38, interior: 0.4 };

export type GlyphBucketStyle = {
  coreWidth: number;
  haloWidth: number;
  outerWidth: number;
  coreOpacity: number;
  haloOpacity: number;
  outerOpacity: number;
};

// The outline carries the glow, so the halo climbs with the ladder instead of standing in for
// distance.
const CORE_OPACITIES = [0.76, 0.96];
const HALO_OPACITIES = [0.55, 0.75];
const OUTER_OPACITIES = [0.24, 0.34];

export function glyphBucketStyles(profile: RenderQuality["name"]): GlyphBucketStyle[] {
  const coreWidths = profile === "mobile" ? [0.8, 1.15] : [1.05, 1.5];
  const haloWidths = profile === "mobile" ? [3.4, 4.5] : [4.5, 6];
  const outerWidths = profile === "mobile" ? [8.5, 11] : [12, 16];
  return Array.from({ length: GLYPH_BUCKET_COUNT }, (_, bucket) => ({
    coreWidth: coreWidths[bucket],
    haloWidth: haloWidths[bucket],
    outerWidth: outerWidths[bucket],
    coreOpacity: CORE_OPACITIES[bucket],
    haloOpacity: HALO_OPACITIES[bucket],
    outerOpacity: OUTER_OPACITIES[bucket],
  }));
}

// Each kind keeps a floor of its own, so a far glyph still reads as an outline with detail inside it
// rather than dissolving into one even wash.
export function glyphStrokeIntensity(kind: GlyphStrokeKind, opacity: number, proximity: number): number {
  return opacity * (GLYPH_STROKE_FLOOR[kind] + proximity * GLYPH_STROKE_DEPTH_GAIN[kind]);
}

const GLYPH_COLORS = SCENE_PALETTE.glyph.map(hexColor);

// A glyph owns its hue while depth changes only how much light it appears to return. The small
// pull towards white close up reads as a sharper core without turning a violet glyph cyan during a
// jump.
export function writeGlyphColor(target: Float32Array, offset: number, proximity: number, colorIndex = 0): void {
  const color = GLYPH_COLORS[colorIndex % GLYPH_COLORS.length];
  const light = 0.72 + proximity * 0.2;
  const white = 0.04 + proximity * 0.1;
  target[offset] = color[0] * light * (1 - white) + white;
  target[offset + 1] = color[1] * light * (1 - white) + white;
  target[offset + 2] = color[2] * light * (1 - white) + white;
}

function hexColor(value: string): readonly [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}
