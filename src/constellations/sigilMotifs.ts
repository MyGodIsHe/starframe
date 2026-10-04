import motifTable from "../data/constellation-motifs.json" with { type: "json" };
import { SIGIL_MODELS, type SigilModel } from "./sigilModel";

// The legacy authored preference for a Constellation and its caption. The Celestial Map now assigns
// figures globally from co-visibility in `compileGloballyAssignedConstellationGlyphIndex`, because
// keeping repeated figures apart is more useful than the currently empty authored table. This
// lookup remains the deterministic seed used to discover that graph, and serves the figure workshop
// and small standalone indexes which do not represent the whole of New Eden.
//
// What it draws from is the sculpted library in `sigilModel`, which is the only library there is:
// a figure in the sky is a model somebody sculpted, the same one `/sigil.html` turns. A fresh clone
// has the generated ones, and every other is imported by hand, a figure at a time.
type AuthoredMotif = { figure: string; caption: string };

const authored = new Map<number, { figure: SigilModel; caption: string }>();
const modelsByName = new Map(SIGIL_MODELS.map((model) => [model.name, model]));

for (const [key, entry] of Object.entries((motifTable as { motifs: Record<string, AuthoredMotif> }).motifs)) {
  const constellationId = Number(key);
  const figure = modelsByName.get(entry.figure);
  if (!Number.isInteger(constellationId) || !figure) continue;
  authored.set(constellationId, { figure, caption: entry.caption });
}

export function figureForConstellation(constellationId: number): SigilModel | null {
  if (SIGIL_MODELS.length === 0) return null;
  return authored.get(constellationId)?.figure ?? SIGIL_MODELS[mix(constellationId) % SIGIL_MODELS.length];
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
