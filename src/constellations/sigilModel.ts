import { buildModelSolid, type GlyphSolid, type SolidPoint } from "./glyphSolid";
import { buildAtom } from "./sigilAtom";
import { buildBolt } from "./sigilBolt";
import { buildCheese } from "./sigilCheese";
import { buildHammer } from "./sigilHammer";
import { buildRing } from "./sigilRing";

// A Sigil Figure whose body was sculpted instead of drawn.
//
// Generating the volume never worked. A figure authored as flat line art has to be given depth by
// rule - extrude it, turn it about its upright, or vary its thickness along an authored side view -
// and every one of those rules is a guess about a shape nobody drew. A wolf came out a slab with a
// wolf printed on it, and no amount of refitting fixes that, because the information was never
// there. So the body comes from a real model: somebody already sculpted this animal from every
// side, and the import keeps that and throws away only the resolution a print needed.
//
// What arrives here is already in the Sigil Figure's own space - upright, centred, farthest point
// on the unit sphere - and already reduced to a few hundred triangles with its creases marked. The
// app only has to hand it to `glyphSolid`, which is the one kind of body there is: the facing test,
// the outline, Glyph Depth Cue and Glyph Parallax know nothing else.
//
// Offline half: `scripts/import-sigil-model.ts`.

/** A point a real Solar System is meant to land on, and the vertex of the body it stands at. */
export type SigilAnchor = { vertex: number; position: SolidPoint };

export type SigilModel = {
  /** Matches the Sigil Figure in the library whose body this is. */
  name: string;
  /** Where the model came from, so a figure in the sky can be traced back to a file. */
  source: string;
  solid: GlyphSolid;
  /** The model's own extremities, where a real Solar System is meant to land. */
  anchors: readonly SigilAnchor[];
};

type RawModel = {
  name?: unknown;
  source?: { file?: unknown };
  vertices?: unknown;
  triangles?: unknown;
  drawn?: unknown;
  anchors?: unknown;
};

// Generated data, so it is narrowed rather than asserted: a model with a malformed triangle, an
// index pointing at no vertex or a surface that will not close is dropped instead of reaching the
// sky, where a body with a hole in it would quietly stop hiding its own far side.
export function readSigilModel(raw: unknown): SigilModel | null {
  const model = (raw ?? {}) as RawModel;
  if (typeof model.name !== "string" || model.name.length === 0) return null;

  const vertices = asPoints(model.vertices);
  const triangles = asIndexTriples(model.triangles, vertices.length);
  const drawn = asIndexPairs(model.drawn, vertices.length);
  if (vertices.length < 4 || triangles.length < 4) return null;

  const solid = buildModelSolid(vertices, triangles, drawn);
  if (!solid) return null;

  const anchors = asIndices(model.anchors, vertices.length).map((vertex): SigilAnchor => ({ vertex, position: vertices[vertex] }));
  return { name: model.name, source: typeof model.source?.file === "string" ? model.source.file : "unknown", solid, anchors };
}

// The sculpted bodies this build ships with.
//
// Five generated ones - a bolt, an atom, a ring, a hammer and a wedge of cheese - because each is a
// subject a rule describes exactly rather than approximately: a zigzag forged as a bar, a core with
// two shells set square to each other, a torus of two radii and two counts, a block lofted along the
// axis it strikes on and hafted on a grip, a circular sector with shallow holes in its sides. None
// of them costs anybody's work, and all five go through the same door an imported model does.
//
// No imported model is committed. One is a reduction of somebody else's sculpture, and whoever made
// it decides whether it may be redistributed - which is not a question a star map should answer on
// their behalf. Importing is therefore a step each build takes for itself: run
// `scripts/import-sigil-model.ts` over a model you have the right to use, then add the file it
// writes to this list.
//
//   import wolf from "../data/sigil-models/wolf.json" with { type: "json" };
//   const IMPORTED: readonly unknown[] = [wolf];
const IMPORTED: readonly unknown[] = [];

export const SIGIL_MODELS: readonly SigilModel[] = [buildBolt(), buildAtom(), buildRing(), buildHammer(), buildCheese(), ...IMPORTED].flatMap((raw) => {
  const model = readSigilModel(raw);
  return model ? [model] : [];
});

const modelsByName = new Map(SIGIL_MODELS.map((model) => [model.name, model]));

/** The body of the named Sigil Figure, or null when this build has no such figure. */
export function modelForFigure(name: string): SigilModel | null {
  return modelsByName.get(name) ?? null;
}

function asPoints(value: unknown): SolidPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SolidPoint[] =>
    Array.isArray(entry) && entry.length >= 3 && entry.slice(0, 3).every((number) => typeof number === "number" && Number.isFinite(number))
      ? [[entry[0] as number, entry[1] as number, entry[2] as number]]
      : []);
}

function asIndexTriples(value: unknown, limit: number): [number, number, number][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): [number, number, number][] => {
    const indices = asIndices(entry, limit);
    return indices.length === 3 && new Set(indices).size === 3 ? [[indices[0], indices[1], indices[2]]] : [];
  });
}

function asIndexPairs(value: unknown, limit: number): [number, number][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): [number, number][] => {
    const indices = asIndices(entry, limit);
    return indices.length === 2 && indices[0] !== indices[1] ? [[indices[0], indices[1]]] : [];
  });
}

function asIndices(value: unknown, limit: number): number[] {
  if (!Array.isArray(value)) return [];
  const indices = value.filter((index): index is number => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < limit);
  return indices.length === value.length ? indices : [];
}
