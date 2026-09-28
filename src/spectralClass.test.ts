import { describe, expect, it } from "vitest";
import { DEFAULT_SPECTRAL_CLASS_LETTER, desaturateTowardWhite, parseSpectralClassLetter, spectralClassColor } from "./spectralClass";

describe("parseSpectralClassLetter", () => {
  it.each([
    ["O5 V", "O"],
    ["B2 III", "B"],
    ["A0 V", "A"],
    ["F8 V", "F"],
    ["G2 V", "G"],
    ["K3 V", "K"],
    ["M1 V", "M"],
    ["k3 v", "K"],
  ] as const)("reads the leading letter of %s as %s", (spectralClass, letter) => {
    expect(parseSpectralClassLetter(spectralClass)).toBe(letter);
  });

  it.each([undefined, null, "", "  ", "X9 V", "?"])("falls back to the safe default for %j", (spectralClass) => {
    expect(parseSpectralClassLetter(spectralClass)).toBe(DEFAULT_SPECTRAL_CLASS_LETTER);
  });
});

describe("spectralClassColor", () => {
  it("returns a distinct, bounded color per known class", () => {
    const colors = (["O", "B", "A", "F", "G", "K", "M"] as const).map((letter) => spectralClassColor(`${letter}0 V`));

    for (const color of colors) {
      for (const channel of color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
    expect(new Set(colors.map((color) => color.join(","))).size).toBe(colors.length);
  });

  it("uses the same restrained color for an unknown class as for the default class", () => {
    expect(spectralClassColor("Q9 V")).toEqual(spectralClassColor("G0 V"));
  });

  it("keeps a stable order of temperature hues from cold to warm across every letter", () => {
    // Blue channel should fall (cold -> warm) and red should rise, monotonically, across O..M.
    const colors = (["O", "B", "A", "F", "G", "K", "M"] as const).map((letter) => spectralClassColor(`${letter}0 V`));
    for (let index = 1; index < colors.length; index += 1) {
      expect(colors[index][0]).toBeGreaterThanOrEqual(colors[index - 1][0]);
      expect(colors[index][2]).toBeLessThanOrEqual(colors[index - 1][2]);
    }
  });
});

describe("desaturateTowardWhite", () => {
  it("leaves the color unchanged at factor 0", () => {
    const color = spectralClassColor("M0 V");
    expect(desaturateTowardWhite(color, 0)).toEqual(color);
  });

  it("returns pure white at factor 1", () => {
    expect(desaturateTowardWhite(spectralClassColor("M0 V"), 1)).toEqual([1, 1, 1]);
  });

  it("moves every channel monotonically closer to white as the factor grows, without overshooting", () => {
    const color = spectralClassColor("O0 V");
    const light = desaturateTowardWhite(color, 0.4);
    const lighter = desaturateTowardWhite(color, 0.8);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs(1 - light[channel])).toBeLessThanOrEqual(Math.abs(1 - color[channel]));
      expect(Math.abs(1 - lighter[channel])).toBeLessThanOrEqual(Math.abs(1 - light[channel]));
      expect(light[channel]).toBeLessThanOrEqual(1);
      expect(light[channel]).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps an out-of-range factor instead of overshooting past white or the original color", () => {
    const color = spectralClassColor("K0 V");
    expect(desaturateTowardWhite(color, 2)).toEqual([1, 1, 1]);
    expect(desaturateTowardWhite(color, -1)).toEqual(color);
  });
});
