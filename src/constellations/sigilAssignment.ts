import type { Vector3 } from "../universe/generateUniverse";
import { computeGlyphFootprint, LEGIBILITY_FLOOR_RADIANS, selectVisibleConstellationIds, type GlyphBounds } from "./glyphVisibility";

export type SigilConflictGraph = ReadonlyMap<number, ReadonlyMap<number, number>>;

type ObserverSystem = {
  constellationId: number;
  position: Vector3;
};

const SCORE_EPSILON = 1e-9;

// Every edge says that two Constellations can share a stationary sky. Its weight says how hard a
// repeated figure would be to miss: a close angular pair costs more, and seeing the pair from many
// Solar Systems adds those costs together. This is built once at startup, never while looking
// around, so the figure a Constellation receives remains its identity everywhere in New Eden.
export function buildSigilConflictGraph(
  boundsByConstellation: ReadonlyMap<number, GlyphBounds>,
  observers: readonly ObserverSystem[],
): Map<number, Map<number, number>> {
  const graph = new Map<number, Map<number, number>>(
    [...boundsByConstellation.keys()].map((constellationId) => [constellationId, new Map()]),
  );

  for (const observer of observers) {
    const ids = selectVisibleConstellationIds(
      boundsByConstellation,
      observer.position,
      new Set([observer.constellationId]),
    );
    const footprints = new Map(ids.flatMap((id) => {
      const bounds = boundsByConstellation.get(id);
      const footprint = bounds && computeGlyphFootprint(bounds, observer.position);
      return footprint ? [[id, footprint] as const] : [];
    }));

    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const left = ids[leftIndex];
        const right = ids[rightIndex];
        const separation = angularDistance(footprints.get(left)!.center, footprints.get(right)!.center);
        const weight = 1 + (Math.PI / Math.max(separation, 1e-6)) ** 2;
        graph.get(left)!.set(right, (graph.get(left)!.get(right) ?? 0) + weight);
        graph.get(right)!.set(left, (graph.get(right)!.get(left) ?? 0) + weight);
      }
    }
  }

  return graph;
}

// The offline generator uses the largest bounds any figure can give each Constellation and joins
// every pair which is simultaneously legible, before occlusion chooses a subset. This conservative
// graph is independent of the eventual assignment and contains every pair the app can actually
// draw together, avoiding a slow figure-assignment/occlusion fixed-point loop.
export function buildPotentialSigilConflictGraph(
  boundsByConstellation: ReadonlyMap<number, GlyphBounds>,
  observers: readonly ObserverSystem[],
): Map<number, Map<number, number>> {
  const graph = new Map<number, Map<number, number>>(
    [...boundsByConstellation.keys()].map((constellationId) => [constellationId, new Map()]),
  );

  for (const observer of observers) {
    const footprints = [...boundsByConstellation].flatMap(([id, bounds]) => {
      if (id === observer.constellationId) return [];
      const footprint = computeGlyphFootprint(bounds, observer.position);
      return footprint && footprint.radius >= LEGIBILITY_FLOOR_RADIANS ? [{ id, footprint }] : [];
    });
    for (let leftIndex = 0; leftIndex < footprints.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < footprints.length; rightIndex += 1) {
        const left = footprints[leftIndex];
        const right = footprints[rightIndex];
        const separation = angularDistance(left.footprint.center, right.footprint.center);
        const weight = 1 + (Math.PI / Math.max(separation, 1e-6)) ** 2;
        graph.get(left.id)!.set(right.id, (graph.get(left.id)!.get(right.id) ?? 0) + weight);
        graph.get(right.id)!.set(left.id, (graph.get(right.id)!.get(left.id) ?? 0) + weight);
      }
    }
  }

  return graph;
}

// Starts with one figure and opens one new slot at a time. Each accepted move strictly lowers the
// weighted cost, so adding a figure to the library cannot make the distribution worse. When enough
// slots exist the score reaches zero, which is an ordinary proper colouring of the co-visibility
// graph; until then, the unavoidable repeats are pushed toward rare, widely separated pairs.
export function assignGlobalSigilSlots(graph: SigilConflictGraph, slotCount: number): Map<number, number> {
  if (slotCount < 1) throw new Error("A Sigil library needs at least one figure");
  let assignment = new Map([...graph.keys()].sort((left, right) => left - right).map((id) => [id, 0]));

  for (let available = 2; available <= slotCount; available += 1) {
    openSlot(graph, assignment, available - 1);
    const greedy = greedyAssignment(graph, available);
    improveAssignment(graph, greedy, available, 3);
    if (assignmentConflictScore(graph, greedy) < assignmentConflictScore(graph, assignment)) assignment = greedy;
    if (assignmentConflictScore(graph, assignment) <= SCORE_EPSILON) break;
  }
  return assignment;
}

// Splitting an existing colour class into a newly available slot is enough to establish the
// monotonic baseline: every move is accepted only when it removes more weighted conflicts than it
// creates with vertices already moved into the new slot.
function openSlot(graph: SigilConflictGraph, assignment: Map<number, number>, slot: number): void {
  const conflict = new Map([...graph.keys()].map((id) => [id, localConflict(graph, assignment, id, assignment.get(id)!)]));
  const ids = [...graph.keys()].sort((left, right) => conflict.get(right)! - conflict.get(left)! || left - right);
  for (const id of ids) {
    const current = assignment.get(id)!;
    if (localConflict(graph, assignment, id, slot) < localConflict(graph, assignment, id, current) - SCORE_EPSILON) {
      assignment.set(id, slot);
    }
  }
}

export function assignmentConflictScore(graph: SigilConflictGraph, assignment: ReadonlyMap<number, number>): number {
  let score = 0;
  for (const [left, neighbors] of graph) {
    for (const [right, weight] of neighbors) {
      if (right > left && assignment.get(left) === assignment.get(right)) score += weight;
    }
  }
  return score;
}

function improveAssignment(graph: SigilConflictGraph, assignment: Map<number, number>, slotCount: number, passLimit: number): void {
  const ids = [...graph.keys()].sort((left, right) => left - right);
  for (let pass = 0; pass < passLimit; pass += 1) {
    let moved = false;
    const conflict = new Map(ids.map((id) => [id, localConflict(graph, assignment, id, assignment.get(id)!)]));
    ids.sort((left, right) => conflict.get(right)! - conflict.get(left)! || left - right);

    for (const id of ids) {
      const current = assignment.get(id)!;
      const currentCost = localConflict(graph, assignment, id, current);
      let best = current;
      let bestCost = currentCost;
      for (let slot = 0; slot < slotCount; slot += 1) {
        const cost = localConflict(graph, assignment, id, slot);
        if (cost < bestCost - SCORE_EPSILON || (Math.abs(cost - bestCost) <= SCORE_EPSILON && slot < best)) {
          best = slot;
          bestCost = cost;
        }
      }
      if (bestCost < currentCost - SCORE_EPSILON) {
        assignment.set(id, best);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// Weighted DSATUR: settle the most constrained Constellation first, then choose the figure carrying
// the least already-visible conflict. This avoids the long tail of one-at-a-time local moves on the
// forty-thousand-edge New Eden graph while leaving the bounded refinement above to clean it up.
function greedyAssignment(graph: SigilConflictGraph, slotCount: number): Map<number, number> {
  const assignment = new Map<number, number>();
  const pending = new Set(graph.keys());
  const saturation = new Map([...graph.keys()].map((id) => [id, new Set<number>()]));
  const degree = new Map([...graph].map(([id, neighbors]) => [id, neighbors.size]));

  while (pending.size > 0) {
    let chosen: number | null = null;
    let chosenSaturation = -1;
    let chosenDegree = -1;
    for (const id of pending) {
      const saturationSize = saturation.get(id)!.size;
      const weightedDegree = degree.get(id)!;
      if (saturationSize > chosenSaturation
        || (saturationSize === chosenSaturation && weightedDegree > chosenDegree)
        || (saturationSize === chosenSaturation && weightedDegree === chosenDegree && (chosen === null || id < chosen))) {
        chosen = id;
        chosenSaturation = saturationSize;
        chosenDegree = weightedDegree;
      }
    }

    const id = chosen!;
    let bestSlot = 0;
    let bestCost = Infinity;
    for (let slot = 0; slot < slotCount; slot += 1) {
      const cost = localConflict(graph, assignment, id, slot);
      if (cost < bestCost - SCORE_EPSILON || (Math.abs(cost - bestCost) <= SCORE_EPSILON && slot < bestSlot)) {
        bestSlot = slot;
        bestCost = cost;
      }
    }
    assignment.set(id, bestSlot);
    pending.delete(id);
    for (const neighbor of graph.get(id)?.keys() ?? []) if (pending.has(neighbor)) saturation.get(neighbor)!.add(bestSlot);
  }

  return assignment;
}

function localConflict(graph: SigilConflictGraph, assignment: ReadonlyMap<number, number>, id: number, slot: number): number {
  let score = 0;
  for (const [neighbor, weight] of graph.get(id) ?? []) if (assignment.get(neighbor) === slot) score += weight;
  return score;
}

function angularDistance(left: Vector3, right: Vector3): number {
  const cosine = Math.max(-1, Math.min(1, left[0] * right[0] + left[1] * right[1] + left[2] * right[2]));
  return Math.acos(cosine);
}
