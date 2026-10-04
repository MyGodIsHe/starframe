import { describe, expect, it } from "vitest";
import {
  GLYPH_BUCKET_BY_KIND,
  GLYPH_PEN_MAX,
  GLYPH_PEN_MIN,
  GLYPH_PEN_REFERENCE_RADIANS,
  glyphBucketStyles,
  glyphPenScale,
  glyphStrokeIntensity,
  writeGlyphColor,
} from "./glyphLineStyle";
import { LEGIBILITY_FLOOR_RADIANS } from "./glyphVisibility";

describe("glyphBucketStyles", () => {
  it("builds each neon line from a core and two successively wider glows", () => {
    for (const profile of ["desktop", "mobile"] as const) {
      for (const style of glyphBucketStyles(profile)) {
        expect(style.coreWidth).toBeLessThan(style.haloWidth);
        expect(style.haloWidth).toBeLessThan(style.outerWidth);
        expect(style.outerOpacity).toBeLessThan(style.haloOpacity);
        expect(style.haloOpacity).toBeLessThan(style.coreOpacity);
      }
    }
  });

  it("keeps mobile glows tighter than desktop glows", () => {
    const desktop = glyphBucketStyles("desktop");
    const mobile = glyphBucketStyles("mobile");

    expect(desktop).toHaveLength(Object.keys(GLYPH_BUCKET_BY_KIND).length);
    for (let bucket = 0; bucket < desktop.length; bucket += 1) {
      expect(mobile[bucket].outerWidth).toBeLessThan(desktop[bucket].outerWidth);
    }
  });
});

describe("writeGlyphColor", () => {
  it("keeps a glyph's hue distinct from another palette colour", () => {
    const colors = new Float32Array(6);
    writeGlyphColor(colors, 0, 0.5, 0);
    writeGlyphColor(colors, 3, 0.5, 3);

    expect([...colors.slice(0, 3)]).not.toEqual([...colors.slice(3, 6)]);
  });

  it("uses lightness rather than a cyan-violet hue swap to show depth", () => {
    const colors = new Float32Array(6);
    writeGlyphColor(colors, 0, 0, 2);
    writeGlyphColor(colors, 3, 1, 2);

    for (let channel = 0; channel < 3; channel += 1) expect(colors[channel + 3]).toBeGreaterThan(colors[channel]);
  });
});

describe("glyphPenScale", () => {
  it("draws the glyph in the middle of the sky's range at the width the ladder authored", () => {
    expect(glyphPenScale(GLYPH_PEN_REFERENCE_RADIANS)).toBeCloseTo(1);
  });

  it("keeps a drawing a scale model of itself, so halving a figure halves its line widths", () => {
    // What the pen is for: a stroke's width is in screen pixels, so without this a figure drawn
    // across 8 degrees of sky got the same halo as one across 60 and piled its own glows into a
    // knot. Inside the clamps the pen is strictly proportional, which is what keeps two lines as
    // far apart relative to their own width however large the figure comes out.
    expect(glyphPenScale(GLYPH_PEN_REFERENCE_RADIANS) / glyphPenScale(GLYPH_PEN_REFERENCE_RADIANS / 2)).toBeCloseTo(2);
  });

  it("holds the smallest glyph worth drawing above a sub-pixel line and the sky-filling ones below a blot", () => {
    expect(glyphPenScale(LEGIBILITY_FLOOR_RADIANS)).toBe(GLYPH_PEN_MIN);
    expect(glyphPenScale(Math.PI / 2)).toBe(GLYPH_PEN_MAX);
    for (const radius of [0.1, 0.2, 0.4, 0.8, 1.5]) {
      expect(glyphPenScale(radius)).toBeGreaterThanOrEqual(GLYPH_PEN_MIN);
      expect(glyphPenScale(radius)).toBeLessThanOrEqual(GLYPH_PEN_MAX);
    }
  });
});

describe("glyphStrokeIntensity", () => {
  it("hands depth most of a stroke's light, so a near glyph is read as the brighter one", () => {
    for (const kind of ["silhouette", "interior"] as const) {
      const near = glyphStrokeIntensity(kind, 1, 1);
      const far = glyphStrokeIntensity(kind, 1, 0);
      expect(far).toBeLessThan(near * 0.25);
      expect(far).toBeGreaterThan(0);
    }
  });

  it("keeps the outline above the detail inside it at every depth", () => {
    for (const proximity of [0, 0.25, 0.5, 0.75, 1]) {
      expect(glyphStrokeIntensity("silhouette", 1, proximity)).toBeGreaterThan(glyphStrokeIntensity("interior", 1, proximity));
    }
  });
});
