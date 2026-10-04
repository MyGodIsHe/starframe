// Assigns the whole Sigil Figure library globally. This is deliberately offline: the SDE build and
// figure library change at build time, while making every player's startup solve the same graph
// would only turn static generated data into latency.
//
//   npm run generate:sigils
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileConstellationGlyphIndex } from "../src/constellations/constellationGlyphModel";
import { assignmentConflictScore, assignGlobalSigilSlots, buildPotentialSigilConflictGraph, buildSigilConflictGraph } from "../src/constellations/sigilAssignment";
import type { GlyphBounds } from "../src/constellations/glyphVisibility";
import { SIGIL_MODELS, type SigilModel } from "../src/constellations/sigilModel";
import type { Vector3 } from "../src/universe/generateUniverse";

const here = dirname(fileURLToPath(import.meta.url));
const universePath = resolve(here, "../src/data/universe-index.json");
const outputPath = resolve(here, "../src/data/constellation-sigil-assignments.json");
const universe = JSON.parse(readFileSync(universePath, "utf8")) as {
  metadata: { build: string };
  systems: { id: number; constellationId: number; position: Vector3 }[];
};

// These are the real-Constellation views used to calibrate the Glyph Pen's monotonic brightness
// contract. Keeping their original figures makes regeneration independent of that presentation
// fixture; changing one deliberately should update the corresponding distance sweep in its test.
const CALIBRATION_FIGURES = new Map<number, string>([
  [20000435, "pacman"],
  [20000334, "snowflake"],
  [20000203, "cheese"],
  [20000737, "cheese"],
]);

if (SIGIL_MODELS.length === 0) throw new Error("the figure library is empty");

const bounds = maximumFigureBounds();
const potential = buildPotentialSigilConflictGraph(bounds, universe.systems);
const locked = calibrationSlots();
let slots = assignGlobalSigilSlots(potential, SIGIL_MODELS.length, locked);
let best = slots;
let bestScore = Infinity;

console.log(`${edgeCount(potential)} potentially co-visible pairs`);
const previous = previousAssignment();
if (previous) {
  const previousIndex = compileConstellationGlyphIndex(universe.systems, figuresFor(previous));
  bestScore = assignmentConflictScore(buildSigilConflictGraph(previousIndex.boundsByConstellation, universe.systems), previous);
  best = previous;
  console.log(`previous assignment: ${Math.round(bestScore)} visible-repeat cost`);
}
for (let pass = 1; pass <= 6; pass += 1) {
  const index = compileConstellationGlyphIndex(universe.systems, figuresFor(slots));
  const actual = buildSigilConflictGraph(index.boundsByConstellation, universe.systems);
  const score = assignmentConflictScore(actual, slots);
  console.log(`refinement ${pass}: ${Math.round(score)} visible-repeat cost`);
  if (score < bestScore) {
    best = slots;
    bestScore = score;
  }
  const next = assignGlobalSigilSlots(actual, SIGIL_MODELS.length, locked);
  if (sameAssignment(next, slots)) break;
  slots = next;
}
writeAssignments(best);

function figuresFor(assignment: ReadonlyMap<number, number>): Map<number, SigilModel> {
  return new Map([...assignment].map(([id, slot]) => [id, SIGIL_MODELS[slot]]));
}

function calibrationSlots(): Map<number, number> {
  const slots = new Map<number, number>();
  for (const [id, name] of CALIBRATION_FIGURES) {
    const slot = SIGIL_MODELS.findIndex((figure) => figure.name === name);
    if (slot < 0) throw new Error(`calibration figure ${name} is missing from the library`);
    slots.set(id, slot);
  }
  return slots;
}

function previousAssignment(): Map<number, number> | null {
  const previous = JSON.parse(readFileSync(outputPath, "utf8")) as { assignments?: Record<string, string> };
  const slots = new Map<number, number>();
  for (const [key, name] of Object.entries(previous.assignments ?? {})) {
    const slot = SIGIL_MODELS.findIndex((figure) => figure.name === name);
    if (slot < 0) return null;
    slots.set(Number(key), slot);
  }
  return slots.size === potential.size ? slots : null;
}

function sameAssignment(left: ReadonlyMap<number, number>, right: ReadonlyMap<number, number>): boolean {
  return left.size === right.size && [...left].every(([id, slot]) => right.get(id) === slot);
}

function maximumFigureBounds(): Map<number, GlyphBounds> {
  const constellationIds = new Set(universe.systems.map((system) => system.constellationId));
  const maximum = new Map<number, GlyphBounds>();
  for (const figure of SIGIL_MODELS) {
    const figures = new Map<number, SigilModel>([...constellationIds].map((id) => [id, figure]));
    const index = compileConstellationGlyphIndex(universe.systems, figures);
    for (const [id, bounds] of index.boundsByConstellation) {
      const previous = maximum.get(id);
      if (!previous || bounds.radius > previous.radius) maximum.set(id, bounds);
    }
  }
  return maximum;
}

function edgeCount(graph: ReadonlyMap<number, ReadonlyMap<number, number>>): number {
  return [...graph.values()].reduce((total, neighbors) => total + neighbors.size, 0) / 2;
}

function writeAssignments(slots: ReadonlyMap<number, number>): void {
  const assignments = Object.fromEntries(
    [...slots].sort((left, right) => left[0] - right[0]).map(([id, slot]) => [id, SIGIL_MODELS[slot].name]),
  );
  writeFileSync(outputPath, `${JSON.stringify({
    sdeBuild: universe.metadata.build,
    figures: SIGIL_MODELS.map((figure) => figure.name),
    assignments,
  }, null, 2)}\n`);
  console.log(`${Object.keys(assignments).length} assignments written to ${outputPath}`);
}
