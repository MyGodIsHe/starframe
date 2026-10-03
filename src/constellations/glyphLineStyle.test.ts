import { describe, expect, it } from "vitest";
import { GLYPH_BUCKET_BY_KIND, glyphBucketStyles } from "./glyphLineStyle";

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

  it("keeps leads quieter than the figure and mobile glows tighter than desktop glows", () => {
    const desktop = glyphBucketStyles("desktop");
    const mobile = glyphBucketStyles("mobile");
    const lead = GLYPH_BUCKET_BY_KIND.lead;

    expect(desktop[lead].coreOpacity).toBeLessThan(desktop[GLYPH_BUCKET_BY_KIND.interior].coreOpacity);
    expect(desktop[lead].outerWidth).toBeLessThan(desktop[GLYPH_BUCKET_BY_KIND.silhouette].outerWidth);
    for (let bucket = 0; bucket < desktop.length; bucket += 1) {
      expect(mobile[bucket].outerWidth).toBeLessThan(desktop[bucket].outerWidth);
    }
  });
});
