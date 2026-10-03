import { describe, expect, it } from "vitest";
import {
  GLYPH_STAR_SPIKE_COUNT,
  GLYPH_STAR_SPIKE_REACH_MAX,
  GLYPH_STAR_SPIKE_REACH_MIN,
  GLYPH_STAR_TWINKLE_PERIOD_SECONDS,
  glyphStarSpikePhase,
  glyphStarSpikeReach,
} from "./glyphStarSpikes";

const LONG_SET = 1;
const SHORT_SET = 0;

describe("glyph star spikes", () => {
  it("uses eight arms on a five second twinkle", () => {
    expect(GLYPH_STAR_SPIKE_COUNT).toBe(8);
    expect(GLYPH_STAR_TWINKLE_PERIOD_SECONDS).toBe(5);
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
