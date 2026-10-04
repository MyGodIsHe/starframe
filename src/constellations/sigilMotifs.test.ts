import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import assignmentTable from "../data/constellation-sigil-assignments.json" with { type: "json" };
import { figureForConstellation } from "./sigilMotifs";
import { SIGIL_MODELS } from "./sigilModel";

const universe = JSON.parse(readFileSync(new URL("../data/universe-index.json", import.meta.url), "utf8")) as {
  metadata: { build: string };
  regions: { constellations: { id: number }[] }[];
};

describe("generated global Sigil Motifs", () => {
  it("matches the current SDE build and complete figure library", () => {
    expect(assignmentTable.sdeBuild).toBe(universe.metadata.build);
    expect(assignmentTable.figures).toEqual(SIGIL_MODELS.map((figure) => figure.name));
  });

  it("assigns one valid figure to every Constellation", () => {
    const constellationIds = universe.regions.flatMap((region) => region.constellations.map((constellation) => constellation.id));

    expect(Object.keys(assignmentTable.assignments)).toHaveLength(constellationIds.length);
    for (const id of constellationIds) expect(figureForConstellation(id)?.name).toBe(assignmentTable.assignments[id.toString() as keyof typeof assignmentTable.assignments]);
  });
});
