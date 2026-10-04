import type { Vector3 } from "../universe/generateUniverse";
import type { ConstellationGlyph } from "./constellationGlyphModel";

export type GlyphColoring = ReadonlyMap<number, number>;
export type GlyphAdjacency = ReadonlyMap<number, ReadonlySet<number>>;

const DIRECTION_EPSILON = 1e-9;

// Colours belong to the currently visible patch of sky, not permanently to all 799
// constellations. A Relative Neighbourhood Graph captures the pairs which read as neighbours: two
// glyphs are joined unless a third glyph is closer to both. It is deliberately less eager than
// joining every visible pair, which would demand dozens of indistinguishable colours as the pilot
// crosses New Eden.
export function buildGlyphAdjacency(frames: readonly (readonly ConstellationGlyph[])[]): GlyphAdjacency {
  const mutable = new Map<number, Set<number>>();

  for (const frame of frames) {
    const centers = frame.flatMap((glyph) => {
      const center = glyphCenter(glyph);
      if (!center) return [];
      if (!mutable.has(glyph.constellationId)) mutable.set(glyph.constellationId, new Set());
      return [{ id: glyph.constellationId, center }];
    });

    for (let left = 0; left < centers.length; left += 1) {
      for (let right = left + 1; right < centers.length; right += 1) {
        const separation = angularDistance(centers[left].center, centers[right].center);
        const blocked = centers.some((candidate, index) => index !== left && index !== right
          && angularDistance(centers[left].center, candidate.center) < separation - DIRECTION_EPSILON
          && angularDistance(centers[right].center, candidate.center) < separation - DIRECTION_EPSILON);
        if (blocked) continue;
        mutable.get(centers[left].id)!.add(centers[right].id);
        mutable.get(centers[right].id)!.add(centers[left].id);
      }
    }
  }

  // A figure in the workshop can have no meaningful sky centre. It still needs a stable colour.
  for (const glyph of frames.flat()) if (!mutable.has(glyph.constellationId)) mutable.set(glyph.constellationId, new Set());
  return mutable;
}

// Keep every existing colour when that remains a valid colouring of the whole journey. If motion
// makes two formerly non-neighbouring glyphs neighbours, recolour at the jump boundary and prefer
// the old colours while searching. The returned map is then held unchanged for every travel frame.
export function assignGlyphColors(frames: readonly (readonly ConstellationGlyph[])[], previous: GlyphColoring, colorCount: number): Map<number, number> {
  if (colorCount < 1) throw new Error("A glyph palette needs at least one colour");
  const graph = buildGlyphAdjacency(frames);
  const retained = new Map([...previous].filter(([id, color]) => graph.has(id) && color >= 0 && color < colorCount));
  const withRetained = colorGraph(graph, colorCount, retained, previous);
  if (withRetained) return withRetained;

  // A pair which only becomes adjacent during the jump may already share a colour. Unlock the
  // smaller possible set instead of repainting the whole sky at the travel boundary.
  const relaxed = new Map(retained);
  while (true) {
    const conflict = [...relaxed].find(([id, color]) => [...(graph.get(id) ?? [])].some((neighbor) => neighbor > id && relaxed.get(neighbor) === color));
    if (!conflict) break;
    const [left] = conflict;
    const right = [...(graph.get(left) ?? [])].find((neighbor) => neighbor > left && relaxed.get(neighbor) === relaxed.get(left))!;
    const victim = (graph.get(left)?.size ?? 0) < (graph.get(right)?.size ?? 0) ? left : right;
    relaxed.delete(victim);
  }
  while (relaxed.size > 0) {
    const partiallyRetained = colorGraph(graph, colorCount, relaxed, previous);
    if (partiallyRetained) return partiallyRetained;
    const victim = [...relaxed.keys()].sort((left, right) => (graph.get(right)?.size ?? 0) - (graph.get(left)?.size ?? 0) || right - left)[0];
    relaxed.delete(victim);
  }

  const recolored = colorGraph(graph, colorCount, new Map(), previous);
  if (recolored) return recolored;
  throw new Error(`Glyph adjacency needs more than ${colorCount} colours`);
}

function colorGraph(graph: GlyphAdjacency, colorCount: number, locked: ReadonlyMap<number, number>, preferred: GlyphColoring): Map<number, number> | null {
  const colors = new Map(locked);
  for (const [id, color] of locked) {
    if ([...(graph.get(id) ?? [])].some((neighbor) => colors.get(neighbor) === color)) return null;
  }

  const visit = (): boolean => {
    if (colors.size === graph.size) return true;
    const id = [...graph.keys()].filter((candidate) => !colors.has(candidate)).sort((left, right) => {
      const saturation = (candidate: number) => new Set([...(graph.get(candidate) ?? [])].flatMap((neighbor) => colors.has(neighbor) ? [colors.get(neighbor)!] : [])).size;
      return saturation(right) - saturation(left)
        || (graph.get(right)?.size ?? 0) - (graph.get(left)?.size ?? 0)
        || left - right;
    })[0];
    const unavailable = new Set([...(graph.get(id) ?? [])].flatMap((neighbor) => colors.has(neighbor) ? [colors.get(neighbor)!] : []));
    const wanted = preferred.get(id) ?? stablePaletteSlot(id, colorCount);
    const choices = Array.from({ length: colorCount }, (_, color) => color).sort((left, right) => {
      return Number(right === wanted) - Number(left === wanted)
        || ((left - wanted + colorCount) % colorCount) - ((right - wanted + colorCount) % colorCount);
    });

    for (const color of choices) {
      if (unavailable.has(color)) continue;
      colors.set(id, color);
      if (visit()) return true;
      colors.delete(id);
    }
    return false;
  };

  return visit() ? colors : null;
}

function stablePaletteSlot(id: number, colorCount: number): number {
  let mixed = id | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) % colorCount;
}

function glyphCenter(glyph: ConstellationGlyph): Vector3 | null {
  const points: Vector3[] = glyph.strokes.length > 0
    ? glyph.strokes.flatMap((stroke) => [stroke.from, stroke.to])
    : glyph.nodes.map((node) => node.position);
  const center: Vector3 = [0, 0, 0];
  for (const point of points) {
    const length = Math.hypot(point[0], point[1], point[2]);
    if (length === 0) continue;
    center[0] += point[0] / length;
    center[1] += point[1] / length;
    center[2] += point[2] / length;
  }
  const length = Math.hypot(center[0], center[1], center[2]);
  return length <= DIRECTION_EPSILON ? null : [center[0] / length, center[1] / length, center[2] / length];
}

function angularDistance(left: Vector3, right: Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, left[0] * right[0] + left[1] * right[1] + left[2] * right[2])));
}
