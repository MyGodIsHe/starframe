import figureLibrary from "../data/sigil-figures.json" with { type: "json" };
import motifTable from "../data/constellation-motifs.json" with { type: "json" };
import type { SigilFigure } from "./sigilFigure";

// Which figure a Constellation wears, and what to call it. The authored table is generated offline
// from each Constellation's real name and Region by scripts/generate-motifs.ts and committed, so
// the running app never calls out to anything. A Constellation with no entry yet gets a stable
// draw from its own id: varied and deterministic, while being honest that the choice means nothing
// in particular until it has been authored.
type AuthoredMotif = { figure: string; caption: string };

type RawFigure = { name: string; strokes: number[][][]; anchors: number[][]; symmetry?: string; side?: number[][] };

// The library is generated data, so it is narrowed rather than asserted: anything with a malformed
// point, an empty stroke or no anchors is dropped instead of reaching the fitter.
export const SIGIL_FIGURES: readonly SigilFigure[] = (figureLibrary as { figures: RawFigure[] }).figures
  .map((raw): SigilFigure => ({
    name: raw.name,
    strokes: raw.strokes.map((stroke) => stroke.filter(isPoint).map(toPoint)).filter((stroke) => stroke.length > 1),
    anchors: raw.anchors.filter(isPoint).map(toPoint),
    // An unrecognised symmetry is dropped rather than trusted: the figure then gets the default
    // body, which is always safe to build.
    ...(raw.symmetry === "revolve" || raw.symmetry === "bilateral" ? { symmetry: raw.symmetry } : {}),
    ...(raw.side && raw.side.filter(isPoint).length > 2 ? { side: raw.side.filter(isPoint).map(toPoint) } : {}),
  }))
  .filter((figure) => figure.strokes.length > 0 && figure.anchors.length > 0);

function isPoint(value: number[]): boolean {
  return value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function toPoint(value: number[]): readonly [number, number] {
  return [value[0], value[1]];
}

const figuresByName = new Map(SIGIL_FIGURES.map((figure) => [figure.name, figure]));
const authored = new Map<number, { figure: SigilFigure; caption: string }>();

for (const [key, entry] of Object.entries((motifTable as { motifs: Record<string, AuthoredMotif> }).motifs)) {
  const constellationId = Number(key);
  const figure = figuresByName.get(entry.figure);
  if (!Number.isInteger(constellationId) || !figure) continue;
  authored.set(constellationId, { figure, caption: entry.caption });
}

export function figureForConstellation(constellationId: number): SigilFigure | null {
  if (SIGIL_FIGURES.length === 0) return null;
  return authored.get(constellationId)?.figure ?? SIGIL_FIGURES[mix(constellationId) % SIGIL_FIGURES.length];
}

// The caption that lets a pilot read what the sigil is meant to be, for the accessible text beside
// the Constellation's name. Absent until the Constellation has an authored motif.
export function captionForConstellation(constellationId: number): string | null {
  return authored.get(constellationId)?.caption ?? null;
}

function mix(value: number): number {
  let hash = value >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}
