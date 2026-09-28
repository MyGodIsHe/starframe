import { describe, expect, it } from "vitest";
import { selectRoutePreview } from "./routePreview";

describe("selectRoutePreview", () => {
  it("builds every available branch through three jumps in deterministic breadth-first order", () => {
    expect(selectRoutePreview([
      [1, 2],
      [2, 4],
      [2, 3],
      [3, 5],
      [4, 6],
    ], 1, 2)).toEqual({
      systems: [2, 3, 4, 5, 6],
      edges: [[1, 2], [2, 3], [2, 4], [3, 5], [4, 6]],
    });
  });

  it("keeps only each system's first shortest discovered branch", () => {
    expect(selectRoutePreview([
      [1, 2],
      [2, 3],
      [2, 4],
      [3, 5],
      [4, 5],
      [5, 6],
    ], 1, 2)).toEqual({
      systems: [2, 3, 4, 5],
      edges: [[1, 2], [2, 3], [2, 4], [3, 5]],
    });
  });

  it("returns the destination without a branch at a dead end", () => {
    expect(selectRoutePreview([[1, 2]], 1, 2)).toEqual({ systems: [2], edges: [[1, 2]] });
  });

  it("does not repeat the origin or cycle members", () => {
    expect(selectRoutePreview([[1, 2], [2, 3], [3, 4], [4, 2]], 1, 2)).toEqual({
      systems: [2, 3, 4],
      edges: [[1, 2], [2, 3], [2, 4]],
    });
  });
});
