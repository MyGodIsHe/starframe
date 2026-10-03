import { describe, expect, it } from "vitest";
import { GLYPH_BUCKET_BY_KIND, glyphBucketStyles, writeGlyphColor } from "./glyphLineStyle";

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
