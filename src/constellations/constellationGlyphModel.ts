import { Vector3 as ThreeVector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { travelSkyProgress, type TravelFrame } from "../travelCoordinates";
import type { Vector3 } from "../universe/generateUniverse";

export const CELESTIAL_MAP_RADIUS = 24;
const DEPTH_CUE_DISTANCE = 37_840_000_000_000_000;
const MIN_VISIBLE_OPACITY = 0.001;

// A system's star is hidden once another, nearer system (from a different constellation) sits on
// (almost) the same line of sight from the observer - approximates a star's apparent size in the
// sky, independent of the current camera zoom.
const OCCLUSION_ANGLE_RADIANS = (2 * Math.PI) / 180;
const OCCLUSION_COS_THRESHOLD = Math.cos(OCCLUSION_ANGLE_RADIANS);

// Which constellations are candidates to draw at all: everything within this real distance of the
// observer, regardless of stargate topology (a constellation one jump away can be behind you, and
// one many jumps away can be right in front of you). Measured against the real universe data: past
// this radius, going further stops revealing any more of the sky (the remaining gaps are genuinely
// empty space out there), while staying comfortably small enough to run the occlusion pass on every
// frame during travel.
const NEARBY_CONSTELLATION_RADIUS = 100_000_000_000_000_000;

type ConstellationSystem = {
  id: number;
  constellationId: number;
  position: Vector3;
};

export type ConstellationGlyphIndex = {
  systemsById: ReadonlyMap<number, ConstellationSystem>;
  systemsByConstellation: ReadonlyMap<number, readonly ConstellationSystem[]>;
  topologyByConstellation: ReadonlyMap<number, readonly (readonly [number, number])[]>;
};

export type ConstellationGlyphNode = {
  systemId: number;
  position: Vector3;
  opacity: number;
  proximity: number;
};

export type ConstellationGlyphEdge = {
  systems: readonly [number, number];
  from: Vector3;
  to: Vector3;
  opacity: number;
  proximity: number;
};

export type ConstellationGlyph = {
  constellationId: number;
  opacity: number;
  nodes: ConstellationGlyphNode[];
  edges: ConstellationGlyphEdge[];
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

  const systemsByConstellation = new Map<number, readonly ConstellationSystem[]>(mutableSystemsByConstellation);
  const topologyByConstellation = new Map<number, readonly (readonly [number, number])[]>(
    [...systemsByConstellation].map(([id, constellationSystems]) => [id, buildConstellationTopology(constellationSystems)]),
  );

  return { systemsById, systemsByConstellation, topologyByConstellation };
}

// A wireframe convex hull over each constellation's real 3D positions: a fully spatial cluster
// becomes a closed polyhedron with its triangulation diagonals stripped out, a coplanar cluster
// becomes a flat polygon outline, a collinear cluster becomes a sequential line, and interior
// points stay visible as unconnected nodes. Coordinates are recentred and rescaled first so the
// geometry is independent of the SDE's very large absolute values.
export function buildConstellationTopology(systems: readonly ConstellationSystem[]): (readonly [number, number])[] {
  const sortedSystems = [...systems].sort((left, right) => left.id - right.id);
  if (sortedSystems.length < 2) return [];

  const centroid = centroidOf(sortedSystems.map((system) => system.position));
  const centered = sortedSystems.map((system): Point3 => vsub(system.position, centroid));
  const referenceMagnitude = Math.max(1, ...sortedSystems.flatMap((system) => system.position.map(Math.abs)));
  const spread = Math.max(...centered.map(vlen));
  if (spread <= referenceMagnitude * 1e-9) return [];

  const normalized = centered.map((point): Point3 => [point[0] / spread, point[1] / spread, point[2] / spread]);
  const uniquePoints = dedupePoints(sortedSystems, normalized);

  if (uniquePoints.length < 2) return [];
  if (uniquePoints.length === 2) return [sortPair([uniquePoints[0].representativeId, uniquePoints[1].representativeId])];

  const classification = classifyPoints(uniquePoints);
  if (classification.kind === "collinear") return dedupeAndSortEdges(chainEdges(classification.order));
  if (classification.kind === "coplanar") return dedupeAndSortEdges(loopEdges(classification.hull));
  return dedupeAndSortEdges(convexHullWireframeEdges(uniquePoints));
}

// Numeric tolerances below operate on the recentred point cloud, which is rescaled so its farthest
// point sits at distance 1 from the centroid - a fixed tolerance is therefore scale-independent.
const GEOMETRY_EPSILON = 1e-6;
const NORMAL_COPLANAR_EPSILON = 1e-6;

type Point3 = readonly [number, number, number];
type UniquePoint = { position: Point3; representativeId: number };
type PointClassification =
  | { kind: "collinear"; order: readonly UniquePoint[] }
  | { kind: "coplanar"; hull: readonly UniquePoint[] }
  | { kind: "volume" };

// Groups systems whose recentred positions coincide within tolerance, keeping the smallest system
// id (input is sorted by id) as the deterministic representative for that location.
function dedupePoints(sortedSystems: readonly ConstellationSystem[], normalized: readonly Point3[]): UniquePoint[] {
  const groups: UniquePoint[] = [];
  for (let index = 0; index < sortedSystems.length; index += 1) {
    const point = normalized[index];
    const existing = groups.find((group) => vlen(vsub(group.position, point)) <= GEOMETRY_EPSILON);
    if (!existing) groups.push({ position: point, representativeId: sortedSystems[index].id });
  }
  return groups;
}

function classifyPoints(points: readonly UniquePoint[]): PointClassification {
  const origin = points[0].position;

  let direction: Point3 | null = null;
  for (const point of points) {
    const offset = vsub(point.position, origin);
    if (vlen(offset) > GEOMETRY_EPSILON) {
      direction = vnorm(offset);
      break;
    }
  }
  if (!direction) return { kind: "collinear", order: points };

  let isCollinear = true;
  for (const point of points) {
    if (vlen(vcross(direction, vsub(point.position, origin))) > GEOMETRY_EPSILON) {
      isCollinear = false;
      break;
    }
  }
  if (isCollinear) {
    const order = [...points].sort((left, right) => vdot(vsub(left.position, origin), direction!) - vdot(vsub(right.position, origin), direction!));
    return { kind: "collinear", order };
  }

  let normal: Point3 | null = null;
  for (const point of points) {
    const cross = vcross(direction, vsub(point.position, origin));
    if (vlen(cross) > GEOMETRY_EPSILON) {
      normal = vnorm(cross);
      break;
    }
  }

  let isCoplanar = true;
  for (const point of points) {
    if (Math.abs(vdot(vsub(point.position, origin), normal!)) > GEOMETRY_EPSILON) {
      isCoplanar = false;
      break;
    }
  }
  if (isCoplanar) return { kind: "coplanar", hull: coplanarHull(points, origin, direction, normal!) };

  return { kind: "volume" };
}

// The 2D convex hull of the coplanar points, projected into an in-plane basis - only the outer
// boundary, in order, with no diagonals; points inside the boundary are left out entirely so they
// stay plain nodes.
function coplanarHull(points: readonly UniquePoint[], origin: Point3, axisU: Point3, normal: Point3): UniquePoint[] {
  const axisV = vcross(normal, axisU);
  const projected = points.map((point, index) => {
    const offset = vsub(point.position, origin);
    return { index, x: vdot(offset, axisU), y: vdot(offset, axisV) };
  });
  return convexHull2D(projected).map((index) => points[index]);
}

function convexHull2D(points: readonly { index: number; x: number; y: number }[]): number[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross2 = (o: typeof sorted[number], a: typeof sorted[number], b: typeof sorted[number]) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: (typeof sorted)[number][] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= GEOMETRY_EPSILON) lower.pop();
    lower.push(point);
  }

  const upper: (typeof sorted)[number][] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= GEOMETRY_EPSILON) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper].map((point) => point.index);
}

function chainEdges(order: readonly UniquePoint[]): (readonly [number, number])[] {
  const edges: (readonly [number, number])[] = [];
  for (let index = 0; index + 1 < order.length; index += 1) edges.push(sortPair([order[index].representativeId, order[index + 1].representativeId]));
  return edges;
}

function loopEdges(hull: readonly UniquePoint[]): (readonly [number, number])[] {
  const edges: (readonly [number, number])[] = [];
  for (let index = 0; index < hull.length; index += 1) {
    const next = hull[(index + 1) % hull.length];
    edges.push(sortPair([hull[index].representativeId, next.representativeId]));
  }
  return edges;
}

// Builds the 3D convex hull and keeps only edges shared by two faces with different normals - an
// edge shared by two faces with the (near-)same normal is a triangulation diagonal across a flat
// polyhedron face, not a visible wireframe edge.
function convexHullWireframeEdges(points: readonly UniquePoint[]): (readonly [number, number])[] {
  const vectors = points.map((point) => new ThreeVector3(point.position[0], point.position[1], point.position[2]));
  const hull = new ConvexHull().setFromPoints(vectors);
  const indexByVector = new Map(vectors.map((vector, index) => [vector, index]));

  const edgeFaceNormals = new Map<string, ThreeVector3[]>();
  for (const face of hull.faces) {
    const a = indexByVector.get(face.edge.tail().point)!;
    const b = indexByVector.get(face.edge.head().point)!;
    const c = indexByVector.get(face.edge.next.head().point)!;
    for (const [left, right] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(sortPair([left, right]));
      const normals = edgeFaceNormals.get(key);
      if (normals) normals.push(face.normal);
      else edgeFaceNormals.set(key, [face.normal]);
    }
  }

  const edges: (readonly [number, number])[] = [];
  for (const [key, normals] of edgeFaceNormals) {
    const isDiagonal = normals.length >= 2 && normals.every((normal) => Math.abs(1 - normal.dot(normals[0])) <= NORMAL_COPLANAR_EPSILON);
    if (isDiagonal) continue;
    const [leftIndex, rightIndex] = key.split(":").map(Number);
    edges.push(sortPair([points[leftIndex].representativeId, points[rightIndex].representativeId]));
  }

  return edges;
}

function centroidOf(positions: readonly Vector3[]): Point3 {
  const sum = positions.reduce<Point3>((acc, position) => [acc[0] + position[0], acc[1] + position[1], acc[2] + position[2]], [0, 0, 0]);
  return [sum[0] / positions.length, sum[1] / positions.length, sum[2] / positions.length];
}

function vsub(left: Point3, right: Point3): Point3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vcross(left: Point3, right: Point3): Point3 {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

function vdot(left: Point3, right: Point3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function vlen(point: Point3): number {
  return Math.hypot(point[0], point[1], point[2]);
}

function vnorm(point: Point3): Point3 {
  const length = vlen(point);
  return length === 0 ? [0, 0, 0] : [point[0] / length, point[1] / length, point[2] / length];
}

function sortPair([left, right]: readonly [number, number]): readonly [number, number] {
  return left <= right ? [left, right] : [right, left];
}

function dedupeAndSortEdges(edges: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const unique = new Map<string, readonly [number, number]>();
  for (const edge of edges) unique.set(edgeKey(edge), edge);
  return [...unique.values()].sort(compareEdges);
}

export function projectConstellationGlyphs(index: ConstellationGlyphIndex, activeSystemId: number): ConstellationGlyph[] {
  const activeSystem = index.systemsById.get(activeSystemId);
  if (!activeSystem) return [];

  const constellationIds = nearbyConstellationIds(index, activeSystem.position, new Set([activeSystem.constellationId]));
  const occluded = occludedSystemIds(index, activeSystem.position, constellationIds, new Set([activeSystem.constellationId]));
  return constellationIds.map((constellationId) => projectGlyph(index, activeSystem.position, constellationId, 1, occluded));
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
  const originIds = new Set(nearbyConstellationIds(index, origin.position, new Set([origin.constellationId])));
  const destinationIds = new Set(nearbyConstellationIds(index, destination.position, new Set([destination.constellationId])));
  const opacityById = new Map(
    [...new Set([...originIds, ...destinationIds])].sort((left, right) => left - right).map((constellationId) => [
      constellationId,
      originIds.has(constellationId) && destinationIds.has(constellationId)
        ? 1
        : destinationIds.has(constellationId) ? progress : 1 - progress,
    ]),
  );

  const candidateIds = [...opacityById.keys()].filter((constellationId) => opacityById.get(constellationId)! > MIN_VISIBLE_OPACITY);
  const homeIds = new Set([origin.constellationId, destination.constellationId]);
  const occluded = occludedSystemIds(index, observerPosition, candidateIds, homeIds);

  return candidateIds.map((constellationId) => projectGlyph(index, observerPosition, constellationId, opacityById.get(constellationId)!, occluded));
}

function projectGlyph(index: ConstellationGlyphIndex, observerPosition: Vector3, constellationId: number, opacity: number, occludedSystemIds: ReadonlySet<number>): ConstellationGlyph {
  const systems = index.systemsByConstellation.get(constellationId) ?? [];
  const nodes = systems.map((system) => projectNode(system, observerPosition, occludedSystemIds.has(system.id)));
  const nodesById = new Map(nodes.map((node) => [node.systemId, node]));
  const edges = (index.topologyByConstellation.get(constellationId) ?? []).map((systems): ConstellationGlyphEdge => {
    const from = nodesById.get(systems[0])!;
    const to = nodesById.get(systems[1])!;
    return {
      systems,
      from: from.position,
      to: to.position,
      opacity: opacity * Math.min(from.opacity, to.opacity),
      proximity: (from.proximity + to.proximity) / 2,
    };
  });

  return {
    constellationId,
    opacity,
    nodes: nodes.map((node) => ({ ...node, opacity: node.opacity * opacity })),
    edges,
  };
}

function projectNode(system: ConstellationSystem, observerPosition: Vector3, isOccluded: boolean): ConstellationGlyphNode {
  const offset: Vector3 = [
    system.position[0] - observerPosition[0],
    system.position[1] - observerPosition[1],
    system.position[2] - observerPosition[2],
  ];
  const distance = Math.hypot(...offset);
  const opacity = isOccluded ? 0 : Math.min(1, distance / 10_000_000_000_000);
  const scale = distance === 0 ? 0 : CELESTIAL_MAP_RADIUS / distance;

  return {
    systemId: system.id,
    position: [offset[0] * scale, offset[1] * scale, offset[2] * scale],
    opacity,
    proximity: Math.max(0, 1 - distance / DEPTH_CUE_DISTANCE),
  };
}

type SightLine = { systemId: number; constellationId: number; direction: Vector3; distance: number };

// Nearest-first pass over individual stars (not whole constellations): a star is hidden only if it
// personally lines up behind a nearer star from a *different* constellation, so a constellation's
// other, unrelated stars never disappear as collateral damage.
function occludedSystemIds(
  index: ConstellationGlyphIndex,
  observerPosition: Vector3,
  constellationIds: readonly number[],
  homeIds: ReadonlySet<number>,
): Set<number> {
  const ordered = constellationIds
    .flatMap((constellationId) => sightLinesFor(index, observerPosition, constellationId))
    .sort((left, right) => left.distance - right.distance);

  const visibleLines: SightLine[] = [];
  const hiddenSystemIds = new Set<number>();

  for (let i = 0; i < ordered.length; i += 1) {
    const line = ordered[i];
    const [lx, ly, lz] = line.direction;
    let isBlocked = false;
    for (let j = 0; j < visibleLines.length; j += 1) {
      const visible = visibleLines[j];
      if (visible.constellationId === line.constellationId) continue;
      const cos = visible.direction[0] * lx + visible.direction[1] * ly + visible.direction[2] * lz;
      if (cos > OCCLUSION_COS_THRESHOLD) {
        isBlocked = true;
        break;
      }
    }

    if (isBlocked && !homeIds.has(line.constellationId)) {
      hiddenSystemIds.add(line.systemId);
      continue;
    }
    visibleLines.push(line);
  }

  return hiddenSystemIds;
}

function sightLinesFor(index: ConstellationGlyphIndex, observerPosition: Vector3, constellationId: number): SightLine[] {
  const systems = index.systemsByConstellation.get(constellationId) ?? [];
  const lines: SightLine[] = [];
  for (const system of systems) {
    const offset: Vector3 = [
      system.position[0] - observerPosition[0],
      system.position[1] - observerPosition[1],
      system.position[2] - observerPosition[2],
    ];
    const distance = Math.hypot(...offset);
    if (distance === 0) continue;
    lines.push({ systemId: system.id, constellationId, direction: [offset[0] / distance, offset[1] / distance, offset[2] / distance], distance });
  }
  return lines;
}

// Every constellation with at least one system within NEARBY_CONSTELLATION_RADIUS of the observer,
// plus anything in alwaysIncluded regardless of distance (the constellation the observer is
// physically standing in must never be able to fall outside its own inclusion radius).
function nearbyConstellationIds(index: ConstellationGlyphIndex, observerPosition: Vector3, alwaysIncluded: ReadonlySet<number>): number[] {
  const ids: number[] = [];
  for (const [constellationId, members] of index.systemsByConstellation) {
    if (alwaysIncluded.has(constellationId) || nearestRealDistance(members, observerPosition) <= NEARBY_CONSTELLATION_RADIUS) {
      ids.push(constellationId);
    }
  }
  return ids.sort((left, right) => left - right);
}

function nearestRealDistance(members: readonly ConstellationSystem[], observerPosition: Vector3): number {
  let nearest = Infinity;
  for (const system of members) {
    const dx = system.position[0] - observerPosition[0];
    const dy = system.position[1] - observerPosition[1];
    const dz = system.position[2] - observerPosition[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

function edgeKey([left, right]: readonly [number, number]): string {
  return `${left}:${right}`;
}

function compareEdges(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}
