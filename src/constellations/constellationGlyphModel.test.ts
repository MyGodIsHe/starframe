import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CELESTIAL_MAP_RADIUS, compileConstellationGlyphIndex, depthCueProximity, projectConstellationGlyphs, projectTravelConstellationGlyphs, type ConstellationGlyph } from "./constellationGlyphModel";
import { GLYPH_PEN_MAX, glyphStrokeIntensity } from "./glyphLineStyle";
import { boundsOf, clearsFootprint, computeGlyphFootprint } from "./glyphVisibility";

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

  it("marks only the real ends of a segmented stroke for rounded glow caps", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    const strokes = projectConstellationGlyphs(index, UNIVERSE_SYSTEMS[0].id)
      .flatMap((glyph) => glyph.strokes) as Array<{ capStart?: boolean; capEnd?: boolean }>;

    expect(strokes.some((stroke) => stroke.capStart === false)).toBe(true);
    expect(strokes.some((stroke) => stroke.capEnd === false)).toBe(true);
    expect(strokes.some((stroke) => stroke.capStart === true && stroke.capEnd === true)).toBe(true);
  });

  it("hands every figure its own depth, so a body is drawn with the volume it has", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    const glyphs = projectConstellationGlyphs(index, UNIVERSE_SYSTEMS[0].id).filter((glyph) => glyph.strokes.length > 0);

    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      const relief = glyph.strokes.flatMap((stroke) => [stroke.reliefStart, stroke.reliefEnd]);
      // A figure has a near side and a far side, and it spends the ladder on them: something of it
      // is drawn at the front of its own depth and something well behind that. The outline is where
      // the body turns away, so nothing reaches the very back - that is the hidden side.
      expect(Math.max(...relief)).toBeGreaterThan(0.8);
      expect(Math.min(...relief)).toBeLessThan(0.5);
      for (const value of relief) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not draw ties from sigils to their constellation stars", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);
    const strokes = projectConstellationGlyphs(index, UNIVERSE_SYSTEMS[0].id).flatMap((glyph) => glyph.strokes);

    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes.map((stroke) => stroke.kind)).not.toContain("lead");
  });

  it("keeps offline fitting leads out of the drawn glyph footprint", () => {
    const index = compileConstellationGlyphIndex(UNIVERSE_SYSTEMS);

    for (const [constellationId, shape] of index.shapeByConstellation) {
      const members = index.systemsByConstellation.get(constellationId)!;
      const drawnExtent = [
        ...members.map((member) => member.position),
        ...shape.solids.flatMap((solid) => solid.vertices.map((vertex) => [...vertex] as [number, number, number])),
      ];
      expect(index.boundsByConstellation.get(constellationId)).toEqual(boundsOf(constellationId, shape.centre, drawnExtent));
    }
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
    expect(shared.strokes.length).toBeGreaterThan(0);
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
          .strokes.map((stroke) => stroke.from);

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
    const drawnBy = (observerId: number) =>
      new Map(projectConstellationGlyphs(index, observerId).map((glyph) => [
        glyph.constellationId,
        glyph.strokes,
      ]));

    // Two Solar Systems of one Constellation look out on nearly the same sky, so they share glyphs
    // to compare - and stand far enough apart to see them from different sides. Which pair shares
    // anything depends on Glyph Occlusion, so the pair is searched for rather than assumed.
    let compared = 0;
    let turned = 0;

    for (const first of UNIVERSE_OBSERVERS) {
      const second = UNIVERSE_SYSTEMS.find((system) => system.constellationId === first.constellationId && system.id !== first.id);
      if (!second) continue;

      const here = drawnBy(first.id);
      const there = drawnBy(second.id);

      for (const constellationId of [...here.keys()].filter((id) => there.has(id) && id !== first.constellationId)) {
        const edges = index.shapeByConstellation.get(constellationId)!.solids.reduce((total, solid) => total + solid.edges.length, 0);
        compared += 1;

        // Part of the body is always missing - that is the far side - and never all of it.
        expect(here.get(constellationId)!.length).toBeGreaterThan(0);
        expect(here.get(constellationId)!.length).toBeLessThan(edges * MAX_SEGMENTS_PER_EDGE);
        if (here.get(constellationId)!.length !== there.get(constellationId)!.length) turned += 1;
      }
    }

    expect(compared).toBeGreaterThan(0);
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

  // The complaint this answers: a far sigil read brighter than a near one. A stroke's width is in
  // screen pixels, so until the Glyph Pen a figure drawn small on the sky put the same 16-pixel
  // halo on lines that fell a few pixels apart, its glows piled on each other additively, and a
  // glyph ten light years out came out up to ten times brighter per patch of sky than one two light
  // years away. Measured here as what a glyph actually puts on the sky - every stroke's arc, times
  // the pen it is drawn with, times the light the Depth Cue gives it - over the sky its own Glyph
  // Footprint covers.
  it("never draws a far sigil brighter per patch of sky than a near one", () => {
    for (const constellationId of [20000435, 20000334, 20000203, 20000737]) {
      const views = viewsAcrossDistance(constellationId);
      const nearest = views[0];
      const farthest = views[views.length - 1];

      expect(farthest.distance).toBeGreaterThan(nearest.distance * 4);
      expect(farthest.light).toBeLessThan(nearest.light * 0.7);
      expect(farthest.pen).toBeLessThan(nearest.pen);
      // And it falls the whole way, which is the shape the old ladder got exactly backwards: it rose
      // steadily with distance. The one view allowed to sit below its neighbour is a sky-filling
      // glyph whose pen the clamp held back from the width proportionality asked for.
      for (let step = 1; step < views.length; step += 1) {
        if (views[step - 1].pen === GLYPH_PEN_MAX) continue;
        expect(views[step].light).toBeLessThan(views[step - 1].light);
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

describe("depthCueProximity", () => {
  it("spends its whole range over the distances a glyph is really drawn at", () => {
    // The ramp it replaced was linear over four light years, which put every glyph past four light
    // years at exactly 0: a glyph at five light years and one at twenty-four were handed the same
    // light. A drawn glyph stands between 1.3 and 41 light years out in the real SDE build.
    const LIGHT_YEAR = 9_460_000_000_000_000;
    const distances = [1.3, 2, 4, 6, 10, 16, 25, 41].map((years) => years * LIGHT_YEAR);
    const proximities = distances.map(depthCueProximity);

    for (let step = 1; step < proximities.length; step += 1) {
      expect(proximities[step]).toBeLessThan(proximities[step - 1]);
    }
    // Every step has to be worth seeing, not just be in the right order.
    expect(depthCueProximity(5 * LIGHT_YEAR) - depthCueProximity(24 * LIGHT_YEAR)).toBeGreaterThan(0.3);
    expect(proximities[0]).toBeGreaterThan(0.6);
  });

  it("stays inside the ladder at both ends", () => {
    expect(depthCueProximity(0)).toBe(1);
    expect(depthCueProximity(Number.MAX_VALUE)).toBe(0);
  });
});

/** The sky a glyph covers, in steradians, from its own Glyph Footprint radius. */
const skyArea = (radius: number): number => Math.PI * radius * radius;

// What one glyph puts on the sky per patch of it: every stroke's arc, weighted by the pen the glyph
// is drawn with and the light the Glyph Depth Cue gives that stroke, over its own footprint. Widths
// are in screen pixels and the halos add, so this is the quantity the eye reads as how bright a
// sigil is - not any single stroke's opacity.
function lightPerSky(glyph: ConstellationGlyph, footprintRadius: number): number {
  const light = glyph.strokes.reduce((total, stroke) => {
    const arc = distanceBetween(stroke.from, stroke.to) / CELESTIAL_MAP_RADIUS;
    return total + arc * glyph.pen * glyphStrokeIntensity(stroke.kind, stroke.opacity, stroke.proximity);
  }, 0);
  return light / skyArea(footprintRadius);
}

// One real Constellation seen from a line of observers walking away from it, nearest first. The
// figure, its Glyph Frame and its Solar Systems are the real ones out of the SDE build; only the
// observer is placed, so nothing between two views differs but distance.
//
// The observers are given a Constellation each so that none of them stands inside the one under
// test, and a lone Solar System reserves no sky, so Glyph Occlusion never drops the figure and the
// sweep reaches the far end of the band. Walking real Solar Systems instead would: only one in
// twenty of the ones at the right distance has a clear line to it.
//
// The band walked is where a figure is read as a figure: from the Legibility Floor out to 55
// degrees, where nine in ten drawn glyphs sit. A glyph wrapping most of the sky is not looked at so
// much as stood inside, and the sky it covers then grows faster than the drawing on it, so it says
// nothing about how one sigil reads against another.
function viewsAcrossDistance(constellationId: number): { degrees: number; distance: number; pen: number; light: number }[] {
  const members = UNIVERSE_SYSTEMS.filter((system) => system.constellationId === constellationId);
  const { centre, radius } = compileConstellationGlyphIndex(members).boundsByConstellation.get(constellationId)!;
  const bearing = [0.48, 0.63, 0.61];
  const length = Math.hypot(bearing[0], bearing[1], bearing[2]);
  const band = [50, 40, 32, 25, 19, 14, 10];

  // Each stop is the distance at which the glyph covers that much sky, so the sweep walks the band
  // evenly rather than wherever a run of light years happens to land.
  const observers = band.map((degrees, step) => ({
    id: 900_000 + step,
    constellationId: 990_000 + step,
    position: centre.map((axis, axisIndex) => axis + (bearing[axisIndex] / length) * (radius / Math.sin((degrees * Math.PI) / 180))) as [number, number, number],
  }));

  const index = compileConstellationGlyphIndex([...members, ...observers]);
  const bounds = index.boundsByConstellation.get(constellationId)!;

  return observers.map((observer, step) => {
    const glyph = projectConstellationGlyphs(index, observer.id).find((entry) => entry.constellationId === constellationId)!;
    return {
      degrees: band[step],
      distance: distanceBetween(bounds.centre, observer.position),
      pen: glyph.pen,
      light: lightPerSky(glyph, computeGlyphFootprint(bounds, observer.position)!.radius),
    };
  });
}
