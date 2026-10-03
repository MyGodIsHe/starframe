// Maps a star's raw SDE spectral class (e.g. "K3 V") to a restrained, temperature-based Celestial
// Map color. Only the leading letter drives color - luminosity class and subclass digits are
// cartographic detail already shown elsewhere (see the local system HUD), not map color.

export type SpectralClassLetter = "O" | "B" | "A" | "F" | "G" | "K" | "M";

const SPECTRAL_CLASS_LETTERS: readonly SpectralClassLetter[] = ["O", "B", "A", "F", "G", "K", "M"];

// G (sunlike, near-white) is the safe fallback for missing or unrecognised data - closest to
// neutral among the seven classes, so an unknown star never reads as an outlier hue on the map.
export const DEFAULT_SPECTRAL_CLASS_LETTER: SpectralClassLetter = "G";

export function parseSpectralClassLetter(spectralClass: string | null | undefined): SpectralClassLetter {
  const letter = spectralClass?.trim().charAt(0).toUpperCase();
  const match = SPECTRAL_CLASS_LETTERS.find((candidate) => candidate === letter);
  return match ?? DEFAULT_SPECTRAL_CLASS_LETTER;
}

// Deliberately desaturated (every channel stays within ~0.55-1.0) so the map reads as starlight
// temperature variation rather than colorful noise once thousands of points overlap.
const SPECTRAL_CLASS_COLOR: Record<SpectralClassLetter, readonly [number, number, number]> = {
  O: [0.63, 0.73, 1.0],
  B: [0.71, 0.8, 1.0],
  A: [0.85, 0.9, 1.0],
  F: [0.97, 0.96, 0.91],
  G: [1.0, 0.94, 0.8],
  K: [1.0, 0.82, 0.64],
  M: [1.0, 0.66, 0.56],
};

export function spectralClassColor(spectralClass: string | null | undefined): readonly [number, number, number] {
  return SPECTRAL_CLASS_COLOR[parseSpectralClassLetter(spectralClass)];
}

// Mixes a spectral color toward white by `factor` (0 = unchanged, 1 = pure white) so a halo can
// share the core's base spectral temperature without painting large sky regions an aggressive hue.
// Never used to invent a new hue - always mixes toward neutral, never away from it.
export function desaturateTowardWhite(color: readonly [number, number, number], factor: number): readonly [number, number, number] {
  const clamped = Math.min(1, Math.max(0, factor));
  return [
    color[0] + (1 - color[0]) * clamped,
    color[1] + (1 - color[1]) * clamped,
    color[2] + (1 - color[2]) * clamped,
  ];
}
