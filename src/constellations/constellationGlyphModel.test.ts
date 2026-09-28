import { describe, expect, it } from "vitest";
import { buildConstellationTopology, CELESTIAL_MAP_RADIUS, compileConstellationGlyphIndex, projectConstellationGlyphs, projectTravelConstellationGlyphs } from "./constellationGlyphModel";

const systems = [
  { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
  { id: 2, constellationId: 10, position: [2, 0, 0] as [number, number, number] },
  { id: 3, constellationId: 10, position: [0, 2, 0] as [number, number, number] },
  { id: 4, constellationId: 20, position: [-2, 0, 0] as [number, number, number] },
  { id: 5, constellationId: 20, position: [-2, 2, 0] as [number, number, number] },
  { id: 6, constellationId: 30, position: [200_000_000_000_000_000, 0, 2] as [number, number, number] },
];

const CUBE_SYSTEMS = [
  { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
  { id: 2, constellationId: 10, position: [1, 0, 0] as [number, number, number] },
  { id: 3, constellationId: 10, position: [0, 1, 0] as [number, number, number] },
  { id: 4, constellationId: 10, position: [1, 1, 0] as [number, number, number] },
  { id: 5, constellationId: 10, position: [0, 0, 1] as [number, number, number] },
  { id: 6, constellationId: 10, position: [1, 0, 1] as [number, number, number] },
  { id: 7, constellationId: 10, position: [0, 1, 1] as [number, number, number] },
  { id: 8, constellationId: 10, position: [1, 1, 1] as [number, number, number] },
];
const CUBE_EDGES = [
  [1, 2], [1, 3], [1, 5],
  [2, 4], [2, 6],
  [3, 4], [3, 7],
  [4, 8],
  [5, 6], [5, 7],
  [6, 8],
  [7, 8],
];

const TETRAHEDRON_SYSTEMS = [
  { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
  { id: 2, constellationId: 10, position: [1, 0, 0] as [number, number, number] },
  { id: 3, constellationId: 10, position: [0, 1, 0] as [number, number, number] },
  { id: 4, constellationId: 10, position: [0, 0, 1] as [number, number, number] },
];
const TETRAHEDRON_EDGES = [
  [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
];

const SQUARE_SYSTEMS = [
  { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
  { id: 2, constellationId: 10, position: [1, 0, 0] as [number, number, number] },
  { id: 3, constellationId: 10, position: [1, 1, 0] as [number, number, number] },
  { id: 4, constellationId: 10, position: [0, 1, 0] as [number, number, number] },
];
const SQUARE_EDGES = [[1, 2], [1, 4], [2, 3], [3, 4]];

describe("constellation glyph topology", () => {
  it("wraps four non-coplanar points as a tetrahedron with exactly six edges", () => {
    expect(buildConstellationTopology(TETRAHEDRON_SYSTEMS)).toEqual(TETRAHEDRON_EDGES);
  });

  it("wraps eight cube corners as exactly twelve edges with no face diagonals", () => {
    const edges = buildConstellationTopology(CUBE_SYSTEMS);
    expect(edges).toEqual(CUBE_EDGES);
    expect(edges.length).toBe(12);
  });

  it("returns the four boundary edges of a flat square, without its diagonal", () => {
    expect(buildConstellationTopology(SQUARE_SYSTEMS)).toEqual(SQUARE_EDGES);
  });

  it("keeps a point inside the hull as a node without giving it any edges", () => {
    const squareWithCenter = [...SQUARE_SYSTEMS, { id: 5, constellationId: 10, position: [0.5, 0.5, 0] as [number, number, number] }];
    const squareEdges = buildConstellationTopology(squareWithCenter);
    expect(squareEdges).toEqual(SQUARE_EDGES);
    expect(squareEdges.some((edge) => edge.includes(5))).toBe(false);

    const cubeWithCenter = [...CUBE_SYSTEMS, { id: 9, constellationId: 10, position: [0.5, 0.5, 0.5] as [number, number, number] }];
    const cubeEdges = buildConstellationTopology(cubeWithCenter);
    expect(cubeEdges).toEqual(CUBE_EDGES);
    expect(cubeEdges.some((edge) => edge.includes(9))).toBe(false);
  });

  it("connects collinear points sequentially in spatial order, not input or id order", () => {
    const collinearSystems = [
      { id: 1, constellationId: 10, position: [2, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
      { id: 3, constellationId: 10, position: [1, 0, 0] as [number, number, number] },
    ];

    expect(buildConstellationTopology(collinearSystems)).toEqual([[1, 3], [2, 3]]);
  });

  it("handles coincident positions without throwing or producing nondeterministic edges", () => {
    const coincidentSystems = [
      { id: 1, constellationId: 10, position: [5, 5, 5] as [number, number, number] },
      { id: 2, constellationId: 10, position: [5, 5, 5] as [number, number, number] },
      { id: 3, constellationId: 10, position: [5, 5, 5] as [number, number, number] },
    ];
    expect(() => buildConstellationTopology(coincidentSystems)).not.toThrow();
    expect(buildConstellationTopology(coincidentSystems)).toEqual([]);

    const tetrahedronWithDuplicate = [...TETRAHEDRON_SYSTEMS, { id: 5, constellationId: 10, position: [0, 0, 0] as [number, number, number] }];
    expect(buildConstellationTopology(tetrahedronWithDuplicate)).toEqual(TETRAHEDRON_EDGES);
  });

  it("handles very small system counts without throwing", () => {
    expect(buildConstellationTopology([])).toEqual([]);
    expect(buildConstellationTopology([{ id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] }])).toEqual([]);
    expect(
      buildConstellationTopology([
        { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
        { id: 2, constellationId: 10, position: [1, 2, 3] as [number, number, number] },
      ]),
    ).toEqual([[1, 2]]);
  });

  it("is deterministic when input order changes", () => {
    expect(buildConstellationTopology([...CUBE_SYSTEMS].reverse())).toEqual(buildConstellationTopology(CUBE_SYSTEMS));
    expect(buildConstellationTopology([...TETRAHEDRON_SYSTEMS].reverse())).toEqual(buildConstellationTopology(TETRAHEDRON_SYSTEMS));
    expect(buildConstellationTopology([...systems].reverse())).toEqual(buildConstellationTopology(systems));
  });
});

describe("projectConstellationGlyphs", () => {
  it("shows every constellation within the nearby radius and excludes ones far beyond it, regardless of stargate connectivity", () => {
    const index = compileConstellationGlyphIndex(systems);
    const glyphs = projectConstellationGlyphs(index, 1);

    expect(glyphs.map((glyph) => glyph.constellationId)).toEqual([10, 20]);
  });

  it("places every visible node directly over its real celestial-map star", () => {
    const index = compileConstellationGlyphIndex(systems);
    const glyphs = projectConstellationGlyphs(index, 1);

    for (const glyph of glyphs) {
      for (const node of glyph.nodes.filter((entry) => entry.systemId !== 1)) {
        const system = systems.find((entry) => entry.id === node.systemId)!;
        const length = Math.hypot(...system.position);
        expect(node.position).toEqual(system.position.map((coordinate) => coordinate / length * CELESTIAL_MAP_RADIUS));
        expect(Math.hypot(...node.position)).toBeCloseTo(CELESTIAL_MAP_RADIUS);
      }
    }
  });

  it("hides edges incident to the observer instead of drawing them through the local system", () => {
    const index = compileConstellationGlyphIndex(systems);
    const glyph = projectConstellationGlyphs(index, 1)[0];

    expect(glyph.nodes.find((node) => node.systemId === 1)?.opacity).toBe(0);
    expect(glyph.edges.filter((edge) => edge.systems.includes(1)).every((edge) => edge.opacity === 0)).toBe(true);
  });

  it("keeps topology continuous through travel while blending origin and destination contexts", () => {
    // Origin and destination are 1.2e17 apart - further than NEARBY_CONSTELLATION_RADIUS (1e17), so
    // their own home constellations are each only in range of one side of the trip; constellation 20
    // sits at the midpoint, comfortably within range of both; constellation 40 is far off-axis from
    // both and never becomes a candidate at all, regardless of the trip.
    const travelSystems = [
      { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 10, position: [0, 40_000_000_000_000_000, 0] as [number, number, number] },
      { id: 3, constellationId: 20, position: [60_000_000_000_000_000, 0, 0] as [number, number, number] },
      { id: 4, constellationId: 20, position: [60_000_000_000_000_000, 40_000_000_000_000_000, 0] as [number, number, number] },
      { id: 5, constellationId: 30, position: [120_000_000_000_000_000, 0, 0] as [number, number, number] },
      { id: 6, constellationId: 30, position: [120_000_000_000_000_000, 40_000_000_000_000_000, 0] as [number, number, number] },
      { id: 7, constellationId: 40, position: [0, 300_000_000_000_000_000, 0] as [number, number, number] },
    ];
    const index = compileConstellationGlyphIndex(travelSystems);
    const travel = { originSystemId: 1, destinationSystemId: 5, routeDirection: [120_000_000_000_000_000, 0, 0] as [number, number, number], phase: "decelerating" as const, startedAt: 1_000 };

    const arriving = projectTravelConstellationGlyphs(index, 5, travel, 6_200);
    const stationary = projectConstellationGlyphs(index, 5);
    expect(arriving.map((glyph) => glyph.constellationId)).toEqual([20, 30]);
    expect(arriving.filter((glyph) => glyph.opacity > 0)).toEqual(stationary);

    const transit = projectTravelConstellationGlyphs(index, 1, { ...travel, startedAt: 0 }, 3_186);
    expect(transit.map((glyph) => glyph.constellationId)).toEqual([10, 20, 30]);
    expect(transit.find((glyph) => glyph.constellationId === 10)?.opacity).toBeCloseTo(0.3);
    expect(transit.find((glyph) => glyph.constellationId === 20)?.opacity).toBe(1);
    expect(transit.find((glyph) => glyph.constellationId === 30)?.opacity).toBeCloseTo(0.7);
    expect(transit.find((glyph) => glyph.constellationId === 20)?.edges.map((edge) => edge.systems)).toEqual(
      stationary.find((glyph) => glyph.constellationId === 20)?.edges.map((edge) => edge.systems),
    );
  });
});

describe("constellation glyph occlusion", () => {
  it("hides only the star directly behind a nearer one, chained through multiple aligned stars, while an off-axis star and its own constellation stay visible", () => {
    const chainSystems = [
      { id: 1, constellationId: 1, position: [0, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 2, position: [10, 0, 0] as [number, number, number] },
      { id: 3, constellationId: 3, position: [20, 0, 0] as [number, number, number] },
      { id: 4, constellationId: 4, position: [0, 10, 0] as [number, number, number] },
      { id: 5, constellationId: 5, position: [30, 0, 0] as [number, number, number] },
    ];
    const index = compileConstellationGlyphIndex(chainSystems);

    const glyphs = projectConstellationGlyphs(index, 1);
    // Every candidate constellation still projects a glyph - occlusion only zeroes individual stars.
    expect(glyphs.map((glyph) => glyph.constellationId)).toEqual([1, 2, 3, 4, 5]);

    const nodes = glyphs.flatMap((glyph) => glyph.nodes);
    expect(nodes.find((node) => node.systemId === 2)?.opacity).toBeGreaterThan(0);
    expect(nodes.find((node) => node.systemId === 4)?.opacity).toBeGreaterThan(0);
    expect(nodes.find((node) => node.systemId === 3)?.opacity).toBe(0);
    expect(nodes.find((node) => node.systemId === 5)?.opacity).toBe(0);
  });

  it("also fades the edge attached to an occluded star, while its other endpoint keeps rendering", () => {
    const edgeSystems = [
      { id: 1, constellationId: 1, position: [0, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 2, position: [10, 0, 0] as [number, number, number] },
      { id: 3, constellationId: 3, position: [20, 0, 0] as [number, number, number] },
      { id: 4, constellationId: 3, position: [20, 5, 0] as [number, number, number] },
    ];
    const index = compileConstellationGlyphIndex(edgeSystems);

    const glyphs = projectConstellationGlyphs(index, 1);
    const nodes = glyphs.flatMap((glyph) => glyph.nodes);
    const edges = glyphs.flatMap((glyph) => glyph.edges);

    expect(nodes.find((node) => node.systemId === 3)?.opacity).toBe(0);
    expect(nodes.find((node) => node.systemId === 4)?.opacity).toBeGreaterThan(0);
    expect(edges.find((edge) => edge.systems.includes(3))?.opacity).toBe(0);
  });

  it("does not let a constellation's own stars occlude each other", () => {
    const selfAlignedSystems = [
      { id: 1, constellationId: 1, position: [0, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 2, position: [10, 0, 0] as [number, number, number] },
      { id: 3, constellationId: 2, position: [20, 0, 0] as [number, number, number] },
    ];
    const index = compileConstellationGlyphIndex(selfAlignedSystems);

    const glyphs = projectConstellationGlyphs(index, 1);
    const nodes = glyphs.flatMap((glyph) => glyph.nodes);

    expect(nodes.find((node) => node.systemId === 2)?.opacity).toBeGreaterThan(0);
    expect(nodes.find((node) => node.systemId === 3)?.opacity).toBeGreaterThan(0);
  });

  it("never hides the active constellation's own stars, even when they sit behind a nearer neighbour", () => {
    const homeSystems = [
      { id: 1, constellationId: 1, position: [0, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 1, position: [100, 0, 0] as [number, number, number] },
      { id: 3, constellationId: 2, position: [10, 0, 0] as [number, number, number] },
    ];
    const index = compileConstellationGlyphIndex(homeSystems);

    const glyphs = projectConstellationGlyphs(index, 1);
    const nodes = glyphs.flatMap((glyph) => glyph.nodes);

    expect(nodes.find((node) => node.systemId === 2)?.opacity).toBeGreaterThan(0);
    expect(nodes.find((node) => node.systemId === 3)?.opacity).toBeGreaterThan(0);
  });
});
