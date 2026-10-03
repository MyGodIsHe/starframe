import { describe, expect, it } from "vitest";
import { planetAppearance, SCENE_PALETTE } from "./scenePalette";

describe("scene palette", () => {
  it("keeps enough distinct cool hues to colour a local glyph graph", () => {
    expect(SCENE_PALETTE.glyph).toHaveLength(6);
    expect(new Set(SCENE_PALETTE.glyph).size).toBe(SCENE_PALETTE.glyph.length);
  });

  it("assigns a distinct cartographic appearance to every SDE planet class", () => {
    const typeIds = [11, 12, 13, 2014, 2015, 2016, 2017, 2063];
    const appearances = typeIds.map(planetAppearance);

    expect(new Set(appearances.map((appearance) => appearance.surface)).size).toBe(typeIds.length);
    expect(new Set(appearances.map((appearance) => appearance.marker)).size).toBe(typeIds.length);
  });

  it("uses a stable neutral fallback for unknown planet types", () => {
    expect(planetAppearance(-1)).toEqual(planetAppearance(Number.MAX_SAFE_INTEGER));
  });

  it("keeps moving ships, infrastructure, and orbit geometry in separate hues", () => {
    expect(SCENE_PALETTE.flightTrail.core).not.toBe(SCENE_PALETTE.gate.idle);
    expect(SCENE_PALETTE.flightTrail.core).not.toBe(SCENE_PALETTE.orbit.trail);
    expect(SCENE_PALETTE.gate.idle).not.toBe(SCENE_PALETTE.orbit.trail);
  });
});
