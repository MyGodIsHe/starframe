import { travelSkyProgress, type TravelFrame } from "../travelCoordinates";
import type { Vector3 } from "../universe/generateUniverse";
import { boundsOf, centreOf, selectVisibleConstellationIds, type GlyphBounds } from "./glyphVisibility";
import { buildGlyphShape, type GlyphShape } from "./glyphShape";
import { glyphDepthSpan, glyphRelief } from "./glyphRelief";
import { drawnEdges } from "./glyphSolid";
import { figureForConstellation } from "./sigilMotifs";
import type { SigilModel } from "./sigilModel";

export const CELESTIAL_MAP_RADIUS = 24;
const DEPTH_CUE_DISTANCE = 37_840_000_000_000_000;
const MIN_VISIBLE_OPACITY = 0.001;

// The one documented exception to Glyph Integrity. A Solar System the observer is standing inside
// has no direction in the sky at all, so it hands off to the local Solar System Map over this
// distance instead of being given a fabricated direction. It is a pure function of the observer
// position, which is what keeps the last arriving travel frame identical to the first stationary
// destination frame. Nothing else in a glyph is ever hidden per star.
const COINCIDENCE_FADE_DISTANCE = 10_000_000_000_000;

// A glyph's strokes are straight lines in space, which project onto the dome as great-circle arcs.
// They are emitted as at most this much arc per segment so a long stroke follows the sky instead of
// cutting a chord through it.
const MAX_SEGMENT_RADIANS = 0.05;
const MAX_SEGMENTS_PER_STROKE = 12;

type ConstellationSystem = {
  id: number;
  constellationId: number;
  position: Vector3;
};

export type ConstellationGlyphIndex = {
  systemsById: ReadonlyMap<number, ConstellationSystem>;
  systemsByConstellation: ReadonlyMap<number, readonly ConstellationSystem[]>;
  shapeByConstellation: ReadonlyMap<number, GlyphShape>;
  boundsByConstellation: ReadonlyMap<number, GlyphBounds>;
};

export type ConstellationGlyphNode = {
  systemId: number;
  position: Vector3;
  opacity: number;
  proximity: number;
  /** Physical metres between the observer's Solar System and this one, before any projection. */
  distance: number;
};

// One drawn line of a glyph.
//
// "silhouette" is where the body turns away from the observer and "interior" is an edge on its near
// side; between them they are the sculpted figure seen from somewhere, and an edge behind the body
// is simply not here. Neither ever stands for a Stargate link.
export type ConstellationGlyphStroke = {
  kind: "silhouette" | "interior";
  from: Vector3;
  to: Vector3;
  opacity: number;
  proximity: number;
  /**
   * Where each end of this stroke stands through the figure's own depth: 1 at the body's nearest
   * point to the observer and 0 at its farthest. The two ends are kept apart because an edge
   * running away from the observer tapers along its own length, and that taper is most of what
   * reads as volume. See `glyphRelief`.
   */
  reliefStart: number;
  reliefEnd: number;
  /** False where this segment joins the previous part of the same projected stroke. */
  capStart?: boolean;
  /** False where this segment joins the next part of the same projected stroke. */
  capEnd?: boolean;
};

export type ConstellationGlyph = {
  constellationId: number;
  opacity: number;
  nodes: ConstellationGlyphNode[];
  strokes: ConstellationGlyphStroke[];
  /**
   * How far the figure reaches across its constellation, as a multiple of the distance to the
   * farthest member. A glyph wearing no artwork reports 0. The Celestial Map publishes it so the
   * size a figure came out at is something a test can read.
   */
  reach: number;
};

// Every glyph is built once per SDE build, in the constellation's own frame. Nothing here depends
// on where the observer is, which is what stops a figure from redrawing itself during travel.
export function compileConstellationGlyphIndex(
  systems: readonly ConstellationSystem[],
  assignedFigures: ReadonlyMap<number, SigilModel> = new Map(),
): ConstellationGlyphIndex {
  const sortedSystems = [...systems].sort((left, right) => left.id - right.id);
  const systemsById = new Map(sortedSystems.map((system) => [system.id, system]));
  const mutableSystemsByConstellation = new Map<number, ConstellationSystem[]>();

  for (const system of sortedSystems) {
    const constellationSystems = mutableSystemsByConstellation.get(system.constellationId) ?? [];
    constellationSystems.push(system);
    mutableSystemsByConstellation.set(system.constellationId, constellationSystems);
  }

  const shapeByConstellation = new Map<number, GlyphShape>();
  const boundsByConstellation = new Map<number, GlyphBounds>();
  for (const [constellationId, members] of mutableSystemsByConstellation) {
    const figure = assignedFigures.get(constellationId) ?? figureForConstellation(constellationId);
    const shape = figure && buildGlyphShape(members, figure);
    if (shape) shapeByConstellation.set(constellationId, shape);

    const extent = [
      ...members.map((member) => member.position),
      ...(shape?.solids.flatMap((solid) => solid.vertices as readonly Vector3[]) ?? []),
    ];
    // A shape already knows the constellation's centre, because that is what it was framed on; a
    // constellation too degenerate to carry a figure still has one to work out.
    const centre = shape?.centre ?? centreOf(members.map((member) => member.position));
    const bounds = centre && boundsOf(constellationId, centre, extent);
    if (bounds) boundsByConstellation.set(constellationId, bounds);
  }

  return {
    systemsById,
    systemsByConstellation: new Map<number, readonly ConstellationSystem[]>(mutableSystemsByConstellation),
    shapeByConstellation,
    boundsByConstellation,
  };
}

export function projectConstellationGlyphs(index: ConstellationGlyphIndex, activeSystemId: number): ConstellationGlyph[] {
  const activeSystem = index.systemsById.get(activeSystemId);
  if (!activeSystem) return [];

  const homeIds = new Set([activeSystem.constellationId]);
  return visibleConstellationIds(index, activeSystem.position, homeIds).map((constellationId) =>
    projectGlyph(index, activeSystem.position, constellationId, 1, homeIds.has(constellationId)),
  );
}

export function projectTravelConstellationGlyphs(index: ConstellationGlyphIndex, activeSystemId: number, travel: TravelFrame | null, now: number): ConstellationGlyph[] {
  const activeSystem = index.systemsById.get(activeSystemId);
  const origin = travel && index.systemsById.get(travel.originSystemId);
  const destination = travel && index.systemsById.get(travel.destinationSystemId);
  if (!travel || !origin || !destination || !activeSystem) return activeSystem ? projectConstellationGlyphs(index, activeSystem.id) : [];

  const progress = travelSkyProgress(travel, now);
  const observerPosition: Vector3 = [
    origin.position[0] + (destination.position[0] - origin.position[0]) * progress,
    origin.position[1] + (destination.position[1] - origin.position[1]) * progress,
    origin.position[2] + (destination.position[2] - origin.position[2]) * progress,
  ];

  // Visibility is decided at the two stationary endpoints, never at the moving observer: a greedy
  // packing re-run every frame could reorder two near-equidistant constellations and pop a whole
  // glyph mid-flight. The endpoint sets cross-fade instead, which is also what makes the last
  // arriving frame identical to the first stationary destination frame.
  const originIds = new Set(visibleConstellationIds(index, origin.position, new Set([origin.constellationId])));
  const destinationIds = new Set(visibleConstellationIds(index, destination.position, new Set([destination.constellationId])));
  const opacityById = new Map(
    [...new Set([...originIds, ...destinationIds])].sort((left, right) => left - right).map((constellationId) => [
      constellationId,
      originIds.has(constellationId) && destinationIds.has(constellationId)
        ? 1
        : destinationIds.has(constellationId) ? progress : 1 - progress,
    ]),
  );

  const homeIds = new Set([origin.constellationId, destination.constellationId]);
  return [...opacityById.keys()]
    .filter((constellationId) => opacityById.get(constellationId)! > MIN_VISIBLE_OPACITY)
    .map((constellationId) => projectGlyph(index, observerPosition, constellationId, opacityById.get(constellationId)!, homeIds.has(constellationId)));
}

// The constellation the observer stands in surrounds them rather than occupying a compact patch of
// sky, so it never competes for sky room: it is drawn regardless and claims nothing.
function visibleConstellationIds(index: ConstellationGlyphIndex, observerPosition: Vector3, homeIds: ReadonlySet<number>): number[] {
  const selected = selectVisibleConstellationIds(index.boundsByConstellation, observerPosition, homeIds);
  return [...new Set([...homeIds, ...selected])].sort((left, right) => left - right);
}

function projectGlyph(index: ConstellationGlyphIndex, observerPosition: Vector3, constellationId: number, opacity: number, isHome: boolean): ConstellationGlyph {
  const systems = index.systemsByConstellation.get(constellationId) ?? [];
  const nodes = systems.map((system) => projectNode(system, observerPosition));
  const shape = index.shapeByConstellation.get(constellationId);
  const strokes = shape ? projectShape(shape, observerPosition, isHome, nodes, systems, opacity) : [];

  return {
    constellationId,
    opacity,
    nodes: nodes.map((node) => ({ ...node, opacity: node.opacity * opacity })),
    strokes,
    reach: shape && strokes.length > 0 ? shape.reach : 0,
  };
}

// The shape is fixed in space; only this projection moves. Travelling past a constellation turns
// its figure the way passing a real object does, and nothing is refitted.
//
// Which edges survive is decided here too, and from the observer's Solar System rather than from
// the camera. That is the whole reason a glyph can hide its own far side without breaking Glyph
// Parallax: orbiting the camera cannot change a single line, and travelling between stars turns
// the body and changes the outline. No vertex moves either way.
function projectShape(
  shape: GlyphShape,
  observerPosition: Vector3,
  isHome: boolean,
  nodes: readonly ConstellationGlyphNode[],
  systems: readonly ConstellationSystem[],
  opacity: number,
): ConstellationGlyphStroke[] {
  const samples = systems.map((system, index) => ({ position: system.position, proximity: nodes[index].proximity }));
  const strokes: ConstellationGlyphStroke[] = [];
  // The whole figure is one body, so its relief is measured against the depth of all of it at once
  // rather than per solid: a gear's hub and its teeth are the same object seen from one place.
  const depthSpan = glyphDepthSpan(shape.solids.flatMap((solid) => solid.vertices), observerPosition);

  const emit = (kind: ConstellationGlyphStroke["kind"], from: Vector3, to: Vector3): void => {
    const segments = segmentCount(direction(from, observerPosition), direction(to, observerPosition));
    for (let step = 0; step < segments; step += 1) {
      const start = lerp(from, to, step / segments);
      const end = lerp(from, to, (step + 1) / segments);
      strokes.push({
        kind,
        from: onCelestialSphere(start, observerPosition),
        to: onCelestialSphere(end, observerPosition),
        opacity,
        proximity: (sampleProximity(samples, start) + sampleProximity(samples, end)) / 2,
        // Measured where the line really is, not where it was projected to: every point of a glyph
        // lands on one sphere, so the sphere has nothing left to say about which end is nearer.
        reliefStart: glyphRelief(start, observerPosition, depthSpan),
        reliefEnd: glyphRelief(end, observerPosition, depthSpan),
        capStart: step === 0,
        capEnd: step === segments - 1,
      });
    }
  };

  // Standing inside a constellation there is no figure to read, only the systems around you, so the
  // home glyph wears no artwork.
  if (!isHome) {
    for (const solid of shape.solids) {
      // A structural edge holds the surface together and still decides what it hides; it was never
      // part of the drawing, and neither is any stretch of a line the body itself stands in front of.
      for (const line of drawnEdges(solid, observerPosition)) emit(line.kind, line.from as Vector3, line.to as Vector3);
    }
  }

  return strokes;
}

// A stroke's depth cue comes from the real Solar Systems it runs past, weighted by how closely it
// passes them, so the artwork inherits the depth of the part of the constellation it decorates
// rather than inventing a distance of its own.
function sampleProximity(samples: readonly { position: Vector3; proximity: number }[], point: Vector3): number {
  let weighted = 0;
  let total = 0;
  let scale = 0;
  for (const sample of samples) scale = Math.max(scale, Math.hypot(sample.position[0] - point[0], sample.position[1] - point[1], sample.position[2] - point[2]));
  const softening = (0.2 * scale) ** 2 + 1;

  for (const sample of samples) {
    const weight = 1 / (softening + (sample.position[0] - point[0]) ** 2 + (sample.position[1] - point[1]) ** 2 + (sample.position[2] - point[2]) ** 2);
    weighted += sample.proximity * weight;
    total += weight;
  }
  return total === 0 ? 0 : weighted / total;
}

function segmentCount(from: Vector3, to: Vector3): number {
  const cos = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  return Math.max(1, Math.min(MAX_SEGMENTS_PER_STROKE, Math.ceil(Math.acos(cos) / MAX_SEGMENT_RADIANS)));
}

function lerp(from: Vector3, to: Vector3, amount: number): Vector3 {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function direction(point: Vector3, observerPosition: Vector3): Vector3 {
  const dx = point[0] - observerPosition[0];
  const dy = point[1] - observerPosition[1];
  const dz = point[2] - observerPosition[2];
  const distance = Math.hypot(dx, dy, dz) || 1;
  return [dx / distance, dy / distance, dz / distance];
}

function onCelestialSphere(point: Vector3, observerPosition: Vector3): Vector3 {
  const unit = direction(point, observerPosition);
  return [unit[0] * CELESTIAL_MAP_RADIUS, unit[1] * CELESTIAL_MAP_RADIUS, unit[2] * CELESTIAL_MAP_RADIUS];
}

function projectNode(system: ConstellationSystem, observerPosition: Vector3): ConstellationGlyphNode {
  const offset: Vector3 = [
    system.position[0] - observerPosition[0],
    system.position[1] - observerPosition[1],
    system.position[2] - observerPosition[2],
  ];
  const distance = Math.hypot(offset[0], offset[1], offset[2]);
  const scale = distance === 0 ? 0 : CELESTIAL_MAP_RADIUS / distance;

  return {
    systemId: system.id,
    position: [offset[0] * scale, offset[1] * scale, offset[2] * scale],
    opacity: Math.min(1, distance / COINCIDENCE_FADE_DISTANCE),
    proximity: Math.max(0, 1 - distance / DEPTH_CUE_DISTANCE),
    distance,
  };
}
