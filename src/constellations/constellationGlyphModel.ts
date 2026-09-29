import { travelSkyProgress, type TravelFrame } from "../travelCoordinates";
import type { Vector3 } from "../universe/generateUniverse";
import { buildGlyphChart, chartDirection, type GlyphChart } from "./glyphChart";
import { selectVisibleConstellationIds } from "./glyphVisibility";
import { fitFigure, type FittedStroke } from "./sigilFigure";
import { figureForConstellation } from "./sigilMotifs";

export const CELESTIAL_MAP_RADIUS = 24;
const DEPTH_CUE_DISTANCE = 37_840_000_000_000_000;
const MIN_VISIBLE_OPACITY = 0.001;

// The one documented exception to Glyph Integrity. A Solar System the observer is standing inside
// has no direction in the sky at all, so it hands off to the local Solar System Map over this
// distance instead of being given a fabricated direction. It is a pure function of the observer
// position, which is what keeps the last arriving travel frame identical to the first stationary
// destination frame. Nothing else in a glyph is ever hidden per star.
const COINCIDENCE_FADE_DISTANCE = 10_000_000_000_000;

// A chart stroke is a straight line on the tangent plane, which is a great circle on the dome. It
// is emitted as at most this many radians of arc per segment, so a long stroke curves with the sky
// rather than cutting a chord through it.
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
};

export type ConstellationGlyphNode = {
  systemId: number;
  position: Vector3;
  opacity: number;
  proximity: number;
};

// One drawn line of a glyph. "figure" is the authored artwork; "lead" is the short tie from a real
// Solar System to it. Neither ever stands for a Stargate link.
export type ConstellationGlyphStroke = {
  kind: FittedStroke["kind"];
  from: Vector3;
  to: Vector3;
  opacity: number;
  proximity: number;
};

export type ConstellationGlyph = {
  constellationId: number;
  opacity: number;
  nodes: ConstellationGlyphNode[];
  strokes: ConstellationGlyphStroke[];
};

export function compileConstellationGlyphIndex(systems: readonly ConstellationSystem[]): ConstellationGlyphIndex {
  const sortedSystems = [...systems].sort((left, right) => left.id - right.id);
  const systemsById = new Map(sortedSystems.map((system) => [system.id, system]));
  const mutableSystemsByConstellation = new Map<number, ConstellationSystem[]>();

  for (const system of sortedSystems) {
    const constellationSystems = mutableSystemsByConstellation.get(system.constellationId) ?? [];
    constellationSystems.push(system);
    mutableSystemsByConstellation.set(system.constellationId, constellationSystems);
  }

  return { systemsById, systemsByConstellation: new Map<number, readonly ConstellationSystem[]>(mutableSystemsByConstellation) };
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
  const selected = selectVisibleConstellationIds(index.systemsByConstellation, observerPosition, homeIds, EMPTY_SYSTEM_IDS);
  return [...new Set([...homeIds, ...selected])].sort((left, right) => left - right);
}

const EMPTY_SYSTEM_IDS: ReadonlySet<number> = new Set<number>();

function projectGlyph(index: ConstellationGlyphIndex, observerPosition: Vector3, constellationId: number, opacity: number, isHome: boolean): ConstellationGlyph {
  const systems = index.systemsByConstellation.get(constellationId) ?? [];
  const nodes = systems.map((system) => projectNode(system, observerPosition));
  const chart = buildGlyphChart(systems, observerPosition);

  return {
    constellationId,
    opacity,
    nodes: nodes.map((node) => ({ ...node, opacity: node.opacity * opacity })),
    strokes: chart ? projectSigil(chart, constellationId, isHome, nodes, opacity) : [],
  };
}

function projectSigil(
  chart: GlyphChart,
  constellationId: number,
  isHome: boolean,
  nodes: readonly ConstellationGlyphNode[],
  opacity: number,
): ConstellationGlyphStroke[] {
  const figure = figureForConstellation(constellationId);
  if (!figure) return [];

  const fitted = fitFigure(figure, chart.points);
  const proximityById = new Map(nodes.map((node) => [node.systemId, node.proximity]));
  const samples = chart.points.map((point) => ({ x: point.x, y: point.y, proximity: proximityById.get(point.systemId) ?? 0 }));

  const strokes: ConstellationGlyphStroke[] = [];
  for (const stroke of fitted.strokes) {
    // Standing inside a constellation there is no figure to read, only the systems around you, so
    // the home glyph keeps its ties to the stars and wears no artwork.
    if (isHome && stroke.kind === "figure") continue;

    for (let index = 0; index + 1 < stroke.points.length; index += 1) {
      const [fromX, fromY] = stroke.points[index];
      const [toX, toY] = stroke.points[index + 1];
      const segments = segmentCount(chartDirection(chart, fromX, fromY), chartDirection(chart, toX, toY));

      for (let step = 0; step < segments; step += 1) {
        const startAmount = step / segments;
        const endAmount = (step + 1) / segments;
        const startX = fromX + (toX - fromX) * startAmount;
        const startY = fromY + (toY - fromY) * startAmount;
        const endX = fromX + (toX - fromX) * endAmount;
        const endY = fromY + (toY - fromY) * endAmount;

        strokes.push({
          kind: stroke.kind,
          from: scaleToMap(chartDirection(chart, startX, startY)),
          to: scaleToMap(chartDirection(chart, endX, endY)),
          opacity,
          proximity: (sampleProximity(samples, startX, startY) + sampleProximity(samples, endX, endY)) / 2,
        });
      }
    }
  }

  return strokes;
}

// A stroke's depth cue comes from the real Solar Systems it runs past, weighted by how closely it
// passes them, so ornament inherits the depth of the part of the constellation it decorates rather
// than inventing a distance of its own.
function sampleProximity(samples: readonly { x: number; y: number; proximity: number }[], x: number, y: number): number {
  let weighted = 0;
  let total = 0;
  for (const sample of samples) {
    const weight = 1 / (0.04 + (sample.x - x) ** 2 + (sample.y - y) ** 2);
    weighted += sample.proximity * weight;
    total += weight;
  }
  return total === 0 ? 0 : weighted / total;
}

function segmentCount(from: Vector3, to: Vector3): number {
  const cos = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  return Math.max(1, Math.min(MAX_SEGMENTS_PER_STROKE, Math.ceil(Math.acos(cos) / MAX_SEGMENT_RADIANS)));
}

function scaleToMap(direction: Vector3): Vector3 {
  return [direction[0] * CELESTIAL_MAP_RADIUS, direction[1] * CELESTIAL_MAP_RADIUS, direction[2] * CELESTIAL_MAP_RADIUS];
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
  };
}
