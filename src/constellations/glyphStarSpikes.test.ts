import { describe, expect, it } from "vitest";
import { DISTANCE_CUE_DISTANCE } from "../interstellarProjection";
import {
  GLYPH_STAR_DIAMETER_PIXELS,
  GLYPH_STAR_SPIKE_COUNT,
  GLYPH_STAR_SPIKE_REACH_MAX,
  GLYPH_STAR_SPIKE_REACH_MIN,
  GLYPH_STAR_TWINKLE_PERIOD_SECONDS,
  glyphStarDiameter,
  glyphStarRayTint,
  glyphStarSpikePhase,
  glyphStarSpikeReach,
} from "./glyphStarSpikes";

const LONG_SET = 1;
const SHORT_SET = 0;

describe("glyph star spikes", () => {
  it("uses eight arms on a two and a half second twinkle", () => {
    expect(GLYPH_STAR_SPIKE_COUNT).toBe(8);
    expect(GLYPH_STAR_TWINKLE_PERIOD_SECONDS).toBe(2.5);
  });

  it("gives each system a stable bounded phase", () => {
    expect(glyphStarSpikePhase(30_002_187)).toBe(glyphStarSpikePhase(30_002_187));
    expect(glyphStarSpikePhase(30_002_187)).not.toBe(glyphStarSpikePhase(30_002_188));
    expect(glyphStarSpikePhase(30_002_187)).toBeGreaterThanOrEqual(0);
    expect(glyphStarSpikePhase(30_002_187)).toBeLessThan(Math.PI * 2);
  });

  it("trades the stretch between the two sets of four arms", () => {
    const quarter = GLYPH_STAR_TWINKLE_PERIOD_SECONDS / 4;
    expect(glyphStarSpikeReach(LONG_SET, quarter, 0)).toBeCloseTo(GLYPH_STAR_SPIKE_REACH_MAX);
    expect(glyphStarSpikeReach(SHORT_SET, quarter, 0)).toBeCloseTo(GLYPH_STAR_SPIKE_REACH_MIN);
    expect(glyphStarSpikeReach(LONG_SET, quarter * 3, 0)).toBeCloseTo(GLYPH_STAR_SPIKE_REACH_MIN);
    expect(glyphStarSpikeReach(SHORT_SET, quarter * 3, 0)).toBeCloseTo(GLYPH_STAR_SPIKE_REACH_MAX);
  });

  it("passes through a moment where all eight arms match", () => {
    expect(glyphStarSpikeReach(LONG_SET, 0, 0)).toBeCloseTo(glyphStarSpikeReach(SHORT_SET, 0, 0));
  });

  it("keeps the retreating arms long enough to stay visible", () => {
    expect(GLYPH_STAR_SPIKE_REACH_MIN).toBeGreaterThan(GLYPH_STAR_SPIKE_REACH_MAX * 0.6);
    expect(GLYPH_STAR_SPIKE_REACH_MAX).toBeLessThan(1);
  });

  it("repeats every period and never leaves the authored reach range", () => {
    for (let step = 0; step <= 40; step += 1) {
      const seconds = (step * GLYPH_STAR_TWINKLE_PERIOD_SECONDS) / 40;
      const phase = glyphStarSpikePhase(30_002_187);
      const reach = glyphStarSpikeReach(LONG_SET, seconds, phase);
      expect(reach).toBeGreaterThanOrEqual(GLYPH_STAR_SPIKE_REACH_MIN - 1e-9);
      expect(reach).toBeLessThanOrEqual(GLYPH_STAR_SPIKE_REACH_MAX + 1e-9);
      expect(reach).toBeCloseTo(glyphStarSpikeReach(LONG_SET, seconds + GLYPH_STAR_TWINKLE_PERIOD_SECONDS, phase));
    }
  });
});

const LIGHT_YEAR = DISTANCE_CUE_DISTANCE;
const CYAN = [0.41, 0.85, 1] as const;
const GREY = [0.5, 0.5, 0.5] as const;

describe("glyph star diameter", () => {
  it("shrinks with the distance to the active system without ever reaching the floor", () => {
    const [near, far] = GLYPH_STAR_DIAMETER_PIXELS.desktop;
    expect(glyphStarDiameter(0, "desktop")).toBeCloseTo(near);
    const widths = [1, 4, 12, 40].map((years) => glyphStarDiameter(years * LIGHT_YEAR, "desktop"));
    for (let step = 1; step < widths.length; step += 1) expect(widths[step]).toBeLessThan(widths[step - 1]);
    for (const width of widths) expect(width).toBeGreaterThan(far);
  });

  it("spends most of its range over the distances a glyph actually spans", () => {
    const [near, far] = GLYPH_STAR_DIAMETER_PIXELS.desktop;
    // Half of the stars a visible glyph draws stand within about four light years, which is the part
    // of the range the size cue has to tell apart; the rest only has to read as far away.
    expect(glyphStarDiameter(4 * LIGHT_YEAR, "desktop")).toBeLessThan((near + far) / 2);
    expect(glyphStarDiameter(4 * LIGHT_YEAR, "desktop")).toBeGreaterThan(far + (near - far) * 0.1);
  });

  it("draws a smaller star on a mobile profile at every distance", () => {
    for (const years of [0, 2, 10]) {
      expect(glyphStarDiameter(years * LIGHT_YEAR, "mobile")).toBeLessThan(glyphStarDiameter(years * LIGHT_YEAR, "desktop"));
    }
  });
});

describe("glyph star ray tint", () => {
  it("burns white at the core and keeps the glyph colour out along the arm", () => {
    const core = glyphStarRayTint(CYAN, 0);
    const body = glyphStarRayTint(CYAN, 0.6);
    const tip = glyphStarRayTint(CYAN, 1);
    expect(Math.min(...core)).toBeGreaterThan(0.85);
    expect(saturation(body)).toBeGreaterThan(saturation(core));
    expect(saturation(tip)).toBeGreaterThan(saturation(body));
  });

  it("spreads the channels apart along the arm the way a lens does", () => {
    // A neutral hue starts with its three channels equal, so anything that separates them further
    // out the arm is the chromatic spread itself and nothing about the colour.
    const core = glyphStarRayTint(GREY, 0);
    const halfway = glyphStarRayTint(GREY, 0.5);
    expect(core[0]).toBeCloseTo(core[2]);
    expect(halfway[0]).toBeLessThan(halfway[2]);
  });

  it("never leaves a channel outside the displayable range", () => {
    for (const hue of [CYAN, [1, 1, 1], [0.84, 0.52, 0.94], [0, 0, 0]] as const) {
      for (let step = 0; step <= 12; step += 1) {
        for (const channel of glyphStarRayTint(hue, step / 12)) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

function saturation(color: readonly [number, number, number]): number {
  return Math.max(...color) - Math.min(...color);
}
