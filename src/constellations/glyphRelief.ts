// Glyph Relief: a Sigil Figure drawn as a body rather than as wire.
//
// Every stroke of a glyph is projected onto one sphere, so where a line lands on the sky says
// nothing at all about which part of the body is in front. The body's own depth has to be drawn
// instead, and the two marks a draughtsman uses for it are the two here: a line on the near side of
// the body is drawn wider, and a line towards its back is drawn softer.
//
// Both ride on one number, which is what keeps them agreeing - where a point stands through the
// body's own depth, 1 at its nearest point and 0 at its farthest. A true perspective taper was
// tried first and is the wrong tool: a figure a hundred light years out is barely deeper than it is
// far away, which came out as a width varying by a tenth, and a figure that small on the sky then
// reads as flat wire. Line weight by depth is a convention rather than a measurement, and it is
// measured inside the one body so that a near glyph and a far one are drawn with the same relief.
//
// It is not the Glyph Depth Cue. That one says how far away the Solar Systems a stroke runs past
// really are, and it is nearly one value for a whole figure; this says which side of its own body a
// line is on. And it is measured from the observer, never from the camera, so it turns with Glyph
// Parallax and an orbit of the camera cannot touch it.

type Point = readonly [number, number, number];

/** The near and far ends of a body's own depth, and the middle of it. */
export type GlyphDepthSpan = { near: number; far: number; middle: number };

// How wide a stroke is drawn, as a multiple of the width its bucket on the ladder gives it. The two
// ends are the body's own near and far points, so a figure always spends the whole range and the
// pair averages to roughly the width the ladder authored.
export const GLYPH_RELIEF_WIDTH_MIN = 0.62;
export const GLYPH_RELIEF_WIDTH_MAX = 1.42;

// Where the drawing is in focus, as a depth through the body: the front of it is read sharp, and
// everything behind that recedes. A near side softened along with the far side would be a camera's
// depth of field over a whole scene, which is not what a figure standing in the dark does.
export const GLYPH_RELIEF_FOCUS_DEPTH = 0.6;
export const GLYPH_RELIEF_BLUR_GAIN = 1.4;
export const GLYPH_RELIEF_BLUR_MAX = 0.62;

/**
 * How deep a body is from where the observer stands. Measured over the whole body, hidden points
 * included: a figure's far side is still what its near side is in front of.
 */
export function glyphDepthSpan(points: readonly Point[], observer: Point): GlyphDepthSpan {
  let near = Infinity;
  let far = 0;
  for (const point of points) {
    const distance = Math.hypot(point[0] - observer[0], point[1] - observer[1], point[2] - observer[2]);
    near = Math.min(near, distance);
    far = Math.max(far, distance);
  }
  return far === 0 ? { near: 0, far: 0, middle: 0 } : { near, far, middle: (near + far) / 2 };
}

/**
 * Where a point of the body stands through that depth: 1 at the body's nearest point, 0 at its
 * farthest. A body with no depth to show reports its middle rather than one of its ends, so it
 * comes out at the width the ladder gave it instead of at either extreme.
 */
export function glyphRelief(point: Point, observer: Point, span: GlyphDepthSpan): number {
  const depth = span.far - span.near;
  if (depth <= 0) return 0.5;
  const distance = Math.hypot(point[0] - observer[0], point[1] - observer[1], point[2] - observer[2]);
  return clamp((span.far - distance) / depth, 0, 1);
}

/** How far a point of the body stands from the observer, as a multiple of the body's middle depth. */
export function glyphRelativeDepth(point: Point, observer: Point, middleDepth: number): number {
  if (middleDepth <= 0) return 1;
  return Math.hypot(point[0] - observer[0], point[1] - observer[1], point[2] - observer[2]) / middleDepth;
}

/**
 * Mirrors the width term of the glyph line shader, so the taper can be reasoned about and tested
 * outside the GPU.
 */
export function glyphStrokeWidthScale(relief: number): number {
  return GLYPH_RELIEF_WIDTH_MIN + (GLYPH_RELIEF_WIDTH_MAX - GLYPH_RELIEF_WIDTH_MIN) * clamp(relief, 0, 1);
}

/**
 * Mirrors the blur term of the glyph line shader: nothing in the front of the body is softened at
 * all, and everything behind it loses focus the deeper it sits. It is a fraction of the stroke's
 * own drawn half-width, which is what makes it read as the same defocus on a thin interior line and
 * on a haloed outline.
 */
export function glyphStrokeBlur(relief: number): number {
  return clamp((GLYPH_RELIEF_FOCUS_DEPTH - relief) * GLYPH_RELIEF_BLUR_GAIN, 0, GLYPH_RELIEF_BLUR_MAX);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
