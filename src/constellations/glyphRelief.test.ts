import { describe, expect, it } from "vitest";
import {
  GLYPH_RELIEF_BLUR_MAX,
  GLYPH_RELIEF_WIDTH_MAX,
  GLYPH_RELIEF_WIDTH_MIN,
  glyphDepthSpan,
  glyphRelativeDepth,
  glyphRelief,
  glyphStrokeBlur,
  glyphStrokeWidthScale,
} from "./glyphRelief";

const UNIT_CUBE: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

const OBSERVER: readonly [number, number, number] = [0, 0, 6];

describe("glyphDepthSpan", () => {
  it("reaches from the body's nearest point to its farthest, hidden ones included", () => {
    const span = glyphDepthSpan(UNIT_CUBE, OBSERVER);

    expect(span.near).toBeCloseTo(Math.hypot(1, 1, 5));
    expect(span.far).toBeCloseTo(Math.hypot(1, 1, 7));
    expect(span.middle).toBeCloseTo((span.near + span.far) / 2);
  });

  it("reports nothing for a body with no points, so no depth is invented", () => {
    expect(glyphDepthSpan([], OBSERVER)).toEqual({ near: 0, far: 0, middle: 0 });
  });
});

describe("glyphRelief", () => {
  it("puts the body's nearest point at 1 and its farthest at 0", () => {
    const span = glyphDepthSpan(UNIT_CUBE, OBSERVER);
    const relief = UNIT_CUBE.map((vertex) => glyphRelief(vertex, OBSERVER, span));

    expect(Math.max(...relief)).toBeCloseTo(1);
    expect(Math.min(...relief)).toBeCloseTo(0);
  });

  it("reads the same on a near body and a far one, so a figure is drawn with its own depth", () => {
    const far = UNIT_CUBE.map((vertex) => [vertex[0], vertex[1], vertex[2] - 400] as const);
    const nearSpan = glyphDepthSpan(UNIT_CUBE, OBSERVER);
    const farSpan = glyphDepthSpan(far, OBSERVER);

    for (const index of UNIT_CUBE.keys()) {
      expect(glyphRelief(far[index], OBSERVER, farSpan)).toBeCloseTo(glyphRelief(UNIT_CUBE[index], OBSERVER, nearSpan), 2);
    }
  });

  it("hands a body with no depth its own middle rather than an end of the ladder", () => {
    expect(glyphRelief([0, 0, 0], OBSERVER, { near: 4, far: 4, middle: 4 })).toBe(0.5);
    expect(glyphStrokeWidthScale(0.5)).toBeGreaterThan(0.9);
    expect(glyphStrokeWidthScale(0.5)).toBeLessThan(1.1);
  });
});

describe("glyphRelativeDepth", () => {
  it("measures a point against the middle of the body's depth", () => {
    const span = glyphDepthSpan(UNIT_CUBE, OBSERVER);

    expect(glyphRelativeDepth([0, 0, 1], OBSERVER, span.middle)).toBeLessThan(1);
    expect(glyphRelativeDepth([0, 0, -1], OBSERVER, span.middle)).toBeGreaterThan(1);
  });

  it("hands a body with no depth one distance rather than dividing by nothing", () => {
    expect(glyphRelativeDepth([0, 0, 0], OBSERVER, 0)).toBe(1);
  });
});

describe("glyphStrokeWidthScale", () => {
  it("draws the near side of the body wider than its far side", () => {
    expect(glyphStrokeWidthScale(1)).toBe(GLYPH_RELIEF_WIDTH_MAX);
    expect(glyphStrokeWidthScale(0)).toBe(GLYPH_RELIEF_WIDTH_MIN);
    expect(glyphStrokeWidthScale(0.75)).toBeGreaterThan(glyphStrokeWidthScale(0.25));
  });

  it("stays on the ladder however far off the end a relief lands", () => {
    expect(glyphStrokeWidthScale(4)).toBe(GLYPH_RELIEF_WIDTH_MAX);
    expect(glyphStrokeWidthScale(-3)).toBe(GLYPH_RELIEF_WIDTH_MIN);
  });

  it("widens the near side by more than half again over the far side, which is what reads as volume", () => {
    expect(GLYPH_RELIEF_WIDTH_MAX / GLYPH_RELIEF_WIDTH_MIN).toBeGreaterThan(1.5);
  });
});

describe("glyphStrokeBlur", () => {
  it("holds the front of the body in focus", () => {
    expect(glyphStrokeBlur(1)).toBe(0);
    expect(glyphStrokeBlur(0.6)).toBe(0);
  });

  it("softens deeper into the body, up to its own ceiling", () => {
    expect(glyphStrokeBlur(0.4)).toBeGreaterThan(0);
    expect(glyphStrokeBlur(0.1)).toBeGreaterThan(glyphStrokeBlur(0.4));
    expect(glyphStrokeBlur(0)).toBe(GLYPH_RELIEF_BLUR_MAX);
  });

  it("never blurs a stroke away entirely", () => {
    expect(GLYPH_RELIEF_BLUR_MAX).toBeLessThan(1);
  });
});
