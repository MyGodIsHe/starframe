import { describe, expect, it } from "vitest";
import { assignGlobalSigilSlots, assignmentConflictScore, type SigilConflictGraph } from "./sigilAssignment";

function graph(edges: readonly (readonly [number, number, number])[]): SigilConflictGraph {
  const result = new Map<number, Map<number, number>>();
  for (const [left, right, weight] of edges) {
    if (!result.has(left)) result.set(left, new Map());
    if (!result.has(right)) result.set(right, new Map());
    result.get(left)!.set(right, weight);
    result.get(right)!.set(left, weight);
  }
  return result;
}

describe("global Sigil assignment", () => {
  it("gives a triangle three different figures when the library has room", () => {
    const conflicts = graph([[1, 2, 1], [2, 3, 1], [1, 3, 1]]);
    const assignment = assignGlobalSigilSlots(conflicts, 3);

    expect(new Set(assignment.values())).toHaveLength(3);
    expect(assignmentConflictScore(conflicts, assignment)).toBe(0);
  });

  it("spends a scarce figure on the pair whose repetition would be most conspicuous", () => {
    const conflicts = graph([
      [1, 2, 100],
      [2, 3, 1],
      [1, 3, 1],
    ]);
    const assignment = assignGlobalSigilSlots(conflicts, 2);

    expect(assignment.get(1)).not.toBe(assignment.get(2));
    expect(assignmentConflictScore(conflicts, assignment)).toBe(1);
  });

  it("can only improve as figures are added to the library", () => {
    const conflicts = graph([
      [1, 2, 8], [1, 3, 5], [1, 4, 3],
      [2, 3, 4], [2, 4, 6], [3, 4, 7],
    ]);
    const scores = Array.from({ length: 4 }, (_, index) =>
      assignmentConflictScore(conflicts, assignGlobalSigilSlots(conflicts, index + 1)),
    );

    expect(scores).toEqual([...scores].sort((left, right) => right - left));
    expect(scores.at(-1)).toBe(0);
  });

  it("is deterministic", () => {
    const conflicts = graph([[20, 30, 2], [10, 20, 4], [10, 30, 1]]);

    expect(assignGlobalSigilSlots(conflicts, 2)).toEqual(assignGlobalSigilSlots(conflicts, 2));
  });
});
