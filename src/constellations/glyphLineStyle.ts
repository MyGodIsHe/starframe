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

// How much of a stroke's light the Glyph Depth Cue hands out, and how little is left at the far end
// of it. The floors used to be most of the brightness - 0.62 and 0.42 of it - which left depth a
// tenth of the ladder to work with and made a far glyph as bright as a near one. Depth now carries
// nearly all of it, and the floor is only what keeps the farthest drawn glyph from disappearing.
export const GLYPH_STROKE_FLOOR: Record<GlyphStrokeKind, number> = { silhouette: 0.14, interior: 0.1 };
export const GLYPH_STROKE_DEPTH_GAIN: Record<GlyphStrokeKind, number> = { silhouette: 0.86, interior: 0.82 };

// Glyph Pen: the width every stroke of one glyph is drawn at, as a multiple of the width its bucket
// on the ladder gives it, from how large the glyph stands on the sky.
//
// A stroke's width is in screen pixels, and nothing used to scale it with the figure it belongs to.
// So the same body drawn across 8 degrees of sky and across 60 got the same 16-pixel halo on every
// line, and the small one collapsed into a knot: its lines fell closer together than their own
// glows were wide, the additive halos piled on each other, and a glyph ten light years out came out
// up to ten times brighter per patch of sky than one two light years away. The Depth Cue cannot
// answer that, because the pile is geometry rather than light.
//
// So a glyph drawn small is drawn with a finer pen: the pen follows the Glyph Footprint radius, and
// the whole drawing is a scale model of itself. Lines then fall as far apart relative to their own
// width however far away the figure is, the piling stops tracking distance, and what is left for
// the eye to read as brightness is the Depth Cue - which is the one that knows what is near.
//
// What the proportionality is anchored on is a separate question from how steep it is, and only the
// steepness - the span between the clamps - settles the crowding. The anchor is set near the large
// end of the band, so the pen mostly thins small glyphs rather than fattening near ones: hung on the
// median instead, a glyph filling the sky came out drawn in white pipes, its core line wide enough
// that the whitened thread inside a neon stroke became the stroke.
//
// The clamps are the honest compromise at the two ends: a core line is only ~1.5 pixels to begin
// with, so full proportionality would take the smallest glyph below a pixel, and the few glyphs that
// wrap most of the sky do not need a 30-pixel pen to stop crowding themselves.
export const GLYPH_PEN_REFERENCE_RADIANS = (24 * Math.PI) / 180;
export const GLYPH_PEN_MIN = 0.42;
export const GLYPH_PEN_MAX = 1.8;

/** The pen a glyph of this Glyph Footprint radius is drawn with. */
export function glyphPenScale(footprintRadians: number): number {
  return Math.min(GLYPH_PEN_MAX, Math.max(GLYPH_PEN_MIN, footprintRadians / GLYPH_PEN_REFERENCE_RADIANS));
}

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
// rather than dissolving into one even wash. The pen is not in here: it widens a stroke rather than
// lighting it, and it is one number for a whole glyph.
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
