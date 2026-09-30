import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CELESTIAL_MAP_RADIUS, compileConstellationGlyphIndex, projectConstellationGlyphs, projectTravelConstellationGlyphs } from "./constellationGlyphModel";
import { clearsFootprint, computeGlyphFootprint } from "./glyphVisibility";

// The real SDE build, so visibility assertions hold against the universe players actually fly in
// rather than a hand-picked arrangement: 5485 Solar Systems across 799 Constellations.
const UNIVERSE_SYSTEMS = (
  JSON.parse(readFileSync(new URL("../data/universe-index.json", import.meta.url), "utf8")) as {
    systems: { id: number; constellationId: number; position: [number, number, number] }[];
  }
).systems.map((system) => ({ id: system.id, constellationId: system.constellationId, position: system.position }));

const UNIVERSE_OBSERVERS = UNIVERSE_SYSTEMS.filter((_, position) => position % 211 === 0);

// A straight edge is emitted as several great-circle segments, so the drawn count is a multiple of
// the edge count rather than equal to it.
const MAX_SEGMENTS_PER_EDGE = 12;

const systems = [
  { id: 1, constellationId: 10, position: [0, 0, 0] as [number, number, number] },
  { id: 2, constellationId: 10, position: [2, 0, 0] as [number, number, number] },
  { id: 3, constellationId: 10, position: [0, 2, 0] as [number, number, number] },
  { id: 4, constellationId: 20, position: [-2, 0, 0] as [number, number, number] },
  { id: 5, constellationId: 20, position: [-2, 2, 0] as [number, number, number] },
  { id: 6, constellationId: 30, position: [200_000_000_000_000_000, 0, 2] as [number, number, number] },
];

describe("projectConstellationGlyphs", () => {
  it("draws the constellation the observer stands in plus the ones that clear it on the sky", () => {
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

  it("fades out the Solar System the observer is standing inside, which has no direction in the sky", () => {
    const index = compileConstellationGlyphIndex(systems);
    const glyph = projectConstellationGlyphs(index, 1)[0];

    expect(glyph.nodes.find((node) => node.systemId === 1)?.opacity).toBe(0);
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
    // The shared constellation stays one continuous landmark rather than being rebuilt: the same
    // members, still whole, still carrying a skeleton. Its stroke coordinates do move, because the
    // observer has moved - that is the point of projecting from a travelling position.
    const shared = transit.find((glyph) => glyph.constellationId === 20)!;
    expect(shared.nodes.map((node) => node.systemId)).toEqual(
      stationary.find((glyph) => glyph.constellationId === 20)!.nodes.map((node) => node.systemId),
    );
    expect(shared.strokes.some((stroke) => stroke.kind === "figure")).toBe(true);
  });
});

describe("Glyph Occlusion", () => {
  // Two constellations of equal size, one twice as far as the other, both centred on +x: the far
  // one sits squarely behind the near one.
  const behindSystems = [
    { id: 1, constellationId: 1, position: [0, 0, 0] as [number, number, number] },
    { id: 2, constellationId: 2, position: [10, -2, 0] as [number, number, number] },
    { id: 3, constellationId: 2, position: [10, 2, 0] as [number, number, number] },
    { id: 4, constellationId: 3, position: [20, -4, 0] as [number, number, number] },
    { id: 5, constellationId: 3, position: [20, 4, 0] as [number, number, number] },
  ];

  it("drops a constellation hidden behind a nearer one entirely, rather than trimming its stars", () => {
    const index = compileConstellationGlyphIndex(behindSystems);
    const glyphs = projectConstellationGlyphs(index, 1);

    expect(glyphs.map((glyph) => glyph.constellationId)).toEqual([1, 2]);
    expect(glyphs.flatMap((glyph) => glyph.nodes).map((node) => node.systemId)).toEqual([1, 2, 3]);
  });

  it("keeps the whole of a constellation that clears the nearer one's sky room", () => {
    // Constellation 3 moved a right angle away, still wide enough on the sky to be worth drawing.
    const asideSystems = behindSystems.map((system) =>
      system.constellationId === 3 ? { ...system, position: [0, system.position[1] * 1.5, 20] as [number, number, number] } : system,
    );
    const index = compileConstellationGlyphIndex(asideSystems);
    const glyphs = projectConstellationGlyphs(index, 1);

    expect(glyphs.map((glyph) => glyph.constellationId)).toEqual([1, 2, 3]);
    expect(glyphs.find((glyph) => glyph.constellationId === 3)?.nodes.map((node) => node.systemId)).toEqual([4, 5]);
  });

  it("never lets two drawn glyphs overlap, over every real observer in a wide sample", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);

    for (const observer of UNIVERSE_OBSERVERS) {
      const ids = projectConstellationGlyphs(index, observer.id)
        .map((glyph) => glyph.constellationId)
        .filter((constellationId) => constellationId !== observer.constellationId);
      const footprints = ids.map((constellationId) => computeGlyphFootprint(index.boundsByConstellation.get(constellationId)!, observer.position)!);

      for (let left = 0; left < footprints.length; left += 1) {
        for (let right = left + 1; right < footprints.length; right += 1) {
          expect(clearsFootprint(footprints[left], footprints[right])).toBe(true);
        }
      }
    }
  });

  it("leaves only a handful of glyphs on the sky instead of the whole neighbourhood", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    const counts = UNIVERSE_OBSERVERS.map((observer) => projectConstellationGlyphs(index, observer.id).length);

    expect(Math.max(...counts)).toBeLessThanOrEqual(16);
    expect(counts.reduce((total, count) => total + count, 0) / counts.length).toBeLessThan(10);
  });

  it("skips a constellation too small on the sky to read as a figure", () => {
    const index = compileConstellationGlyphIndex([
      { id: 1, constellationId: 1, position: [0, 0, 0] as [number, number, number] },
      { id: 2, constellationId: 1, position: [0, 1, 0] as [number, number, number] },
      { id: 3, constellationId: 2, position: [1_000, -1, 0] as [number, number, number] },
      { id: 4, constellationId: 2, position: [1_000, 1, 0] as [number, number, number] },
    ]);

    // Constellation 2 spans about 0.1 degrees from here - below the Legibility Floor.
    expect(projectConstellationGlyphs(index, 1).map((glyph) => glyph.constellationId)).toEqual([1]);
  });
});

describe("Glyph Shape stability", () => {
  // The failure this guards against: the figure used to be refitted in the observer's sky plane
  // every frame, so mid-flight the anchor-to-star matching would flip and the artwork visibly
  // redrew itself onto different systems. A glyph fixed in space can only turn.
  it("turns a glyph as the observer travels past it, instead of redrawing it", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    const origin = UNIVERSE_SYSTEMS[0];
    const destination = [...UNIVERSE_SYSTEMS]
      .filter((system) => system.constellationId !== origin.constellationId)
      .sort((left, right) => distanceBetween(origin.position, left.position) - distanceBetween(origin.position, right.position))[0];
    const travel = {
      originSystemId: origin.id,
      destinationSystemId: destination.id,
      routeDirection: destination.position,
      phase: "accelerating" as const,
      startedAt: 0,
    };

    const frames = Array.from({ length: 41 }, (_, step) =>
      projectTravelConstellationGlyphs(index, origin.id, travel, (step / 40) * 5_200),
    );
    const everywhere = frames[0]
      .map((glyph) => glyph.constellationId)
      .filter((constellationId) => frames.every((frame) => frame.some((glyph) => glyph.constellationId === constellationId)));
    expect(everywhere.length).toBeGreaterThan(0);

    for (const constellationId of everywhere) {
      let previous: [number, number, number][] | null = null;
      for (const frame of frames) {
        const current = frame
          .find((glyph) => glyph.constellationId === constellationId)!
          .strokes.filter((stroke) => stroke.kind !== "lead")
          .map((stroke) => stroke.from);

        if (previous && previous.length > 0 && current.length > 0) {
          // Each point of the drawing stays near a point of the previous frame's drawing. A refit
          // would tear the figure across the sky in a single step.
          for (const point of current) {
            const nearest = Math.min(...previous.map((earlier) => angleBetween(point, earlier)));
            expect(nearest).toBeLessThan(0.12);
          }
        }
        previous = current;
      }
    }
  });
});

describe("Glyph Hidden Lines", () => {
  // What the body is for: a figure that hides its own far side reads as an object, and the side it
  // shows has to be decided by where the pilot's Solar System is - never by where the camera looks,
  // which would put parallax inside a stationary view.
  it("shows a different side of the same fixed object from a different Solar System", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    // Two Solar Systems of one Constellation look out on nearly the same sky, so they share glyphs
    // to compare - and stand far enough apart to see them from different sides.
    const first = UNIVERSE_OBSERVERS[0];
    const second = UNIVERSE_SYSTEMS.find((system) => system.constellationId === first.constellationId && system.id !== first.id)!;

    const drawnBy = (observerId: number) =>
      new Map(projectConstellationGlyphs(index, observerId).map((glyph) => [
        glyph.constellationId,
        glyph.strokes.filter((stroke) => stroke.kind !== "lead"),
      ]));

    const here = drawnBy(first.id);
    const there = drawnBy(second.id);
    const shared = [...here.keys()].filter((constellationId) => there.has(constellationId) && constellationId !== first.constellationId);
    expect(shared.length).toBeGreaterThan(0);

    let turned = 0;
    for (const constellationId of shared) {
      const edges = index.shapeByConstellation.get(constellationId)!.solids.reduce((total, solid) => total + solid.edges.length, 0);

      // Part of the body is always missing - that is the far side - and never all of it.
      expect(here.get(constellationId)!.length).toBeGreaterThan(0);
      expect(here.get(constellationId)!.length).toBeLessThan(edges * MAX_SEGMENTS_PER_EDGE);
      if (here.get(constellationId)!.length !== there.get(constellationId)!.length) turned += 1;
    }
    expect(turned).toBeGreaterThan(0);
  });

  it("never moves a vertex to do it", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    const before = [...index.shapeByConstellation].map(([id, shape]) => [id, shape.solids.map((solid) => solid.vertices)] as const);

    for (const observer of UNIVERSE_OBSERVERS) projectConstellationGlyphs(index, observer.id);

    for (const [id, vertices] of before) expect(index.shapeByConstellation.get(id)!.solids.map((solid) => solid.vertices)).toEqual(vertices);
  });
});

describe("Glyph Integrity", () => {
  it("gives every node of a glyph the glyph's own opacity, with no per-star hiding", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);

    for (const observer of UNIVERSE_OBSERVERS) {
      for (const glyph of projectConstellationGlyphs(index, observer.id)) {
        for (const node of glyph.nodes) {
          // The system the observer is standing inside is the single documented exception: it has
          // no direction in the sky and hands off to the local Solar System Map.
          if (node.systemId === observer.id) continue;
          expect(node.opacity).toBe(glyph.opacity);
        }
      }
    }
  });

  it("draws every member of a visible constellation, never a subset", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);

    for (const observer of UNIVERSE_OBSERVERS) {
      for (const glyph of projectConstellationGlyphs(index, observer.id)) {
        const members = index.systemsByConstellation.get(glyph.constellationId)!.map((system) => system.id);
        expect(glyph.nodes.map((node) => node.systemId)).toEqual(members);
      }
    }
  });
});

function distanceBetween(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function angleBetween(left: readonly number[], right: readonly number[]): number {
  const leftLength = Math.hypot(left[0], left[1], left[2]) || 1;
  const rightLength = Math.hypot(right[0], right[1], right[2]) || 1;
  const cos = (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (leftLength * rightLength);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}
