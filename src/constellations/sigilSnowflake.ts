import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

// A snowflake is one of the few figures whose sculpture is wholly described by a rule: six equal
// rays, each carrying the same paired branches. The whole outline is extruded as one shallow crystal.
// Earlier each ray and branch was a separate closed prism; their roots intersected, so coplanar rims
// were drawn over one another and opposite sides exposed different amounts of internal geometry.

export type SnowflakeBranchLevel = {
  /** Distance from the centre at which this pair of branches grows from its ray. */
  at: number;
  /** How much farther toward the ray's tip each branch reaches. */
  reach: number;
  /** How far the branch opens to either side of its ray. */
  spread: number;
};

export type SnowflakeOptions = {
  /** Equal radial rays. Six is the defining symmetry of a snow crystal. */
  arms: number;
  /** The repeated pairs of branches on every ray, from inner to outer. */
  branchLevels: readonly SnowflakeBranchLevel[];
  /** Radius of the polygonal crystal joining the rays into one silhouette. */
  hub: number;
  /** Half-width of a main ray at its root. */
  rayWidth: number;
  /** Half-width of a branch where it returns to the main ray. */
  branchWidth: number;
  /** Half-depth of the crystal, before the figure is normalized. */
  depth: number;
};

export const SNOWFLAKE: SnowflakeOptions = {
  arms: 6,
  branchLevels: [
    { at: 0.48, reach: 0.27, spread: 0.24 },
    { at: 0.68, reach: 0.22, spread: 0.18 },
  ],
  hub: 0.2,
  rayWidth: 0.085,
  branchWidth: 0.045,
  depth: 0.075,
};

type Triple = [number, number, number];
type Pair = [number, number];
type Point2 = [number, number];

export function buildSnowflake(options: SnowflakeOptions = SNOWFLAKE) {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];
  const profile = snowflakeProfile(options);
  const crystal = extrude(profile.points, options.depth, vertices, triangles, drawn, new Set(profile.depthCorners));

  const sized = intoFigureSpace(vertices);
  return {
    name: "snowflake",
    source: { file: `generated, ${options.arms} rays with ${options.branchLevels.length} paired branch levels` },
    vertices: sized,
    triangles,
    drawn,
    // Alternating faces avoids placing every Solar System on one side of the shallow body while
    // keeping each anchor at a different, characteristic ray tip.
    anchors: profile.tips.map((tip, index) => (index % 2 === 0 ? crystal.near[tip] : crystal.far[tip])),
  };
}

// The boundary of one arm walks from its lower root out through each branch, reaches the main tip,
// and returns along the mirrored upper side. Repeating that walk around the centre gives one simple
// outline: branches are points of that outline, not little solids pushed through the ray beneath.
function snowflakeProfile(options: SnowflakeOptions): { points: Point2[]; tips: number[]; depthCorners: number[] } {
  const points: Point2[] = [];
  const tips: number[] = [];
  const depthCorners: number[] = [];

  for (let arm = 0; arm < options.arms; arm += 1) {
    const angle = (2 * Math.PI * arm) / options.arms;
    const local: Point2[] = [[options.hub, -options.rayWidth]];

    for (const level of options.branchLevels) {
      depthCorners.push(points.length + local.length);
      local.push([level.at + level.reach, -level.spread], [level.at + options.branchWidth, -options.rayWidth]);
    }

    tips.push(points.length + local.length);
    depthCorners.push(points.length + local.length);
    local.push([1, 0]);

    for (const level of [...options.branchLevels].reverse()) {
      local.push([level.at + options.branchWidth, options.rayWidth]);
      depthCorners.push(points.length + local.length);
      local.push([level.at + level.reach, level.spread]);
    }
    local.push([options.hub, options.rayWidth]);

    for (const [x, y] of local) points.push([
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
    ]);
  }

  return { points, tips, depthCorners };
}

// Extrude one simple, possibly concave profile as a closed crystal. Both face contours are authored
// because either side can face the observer. Only the ray and branch tips are carried through the
// depth as explicit lines; marking every notch would turn an edge-on snowflake into a picket fence.
function extrude(
  profile: readonly Point2[],
  depth: number,
  vertices: SolidPoint[],
  triangles: Triple[],
  drawn: Pair[],
  depthCorners: ReadonlySet<number>,
): { near: number[]; far: number[] } {
  const near = profile.map(([x, y]) => vertices.push([x, y, depth]) - 1);
  const far = profile.map(([x, y]) => vertices.push([x, y, -depth]) - 1);

  for (const [a, b, c] of triangulate(profile)) {
    triangles.push([near[a], near[b], near[c]], [far[a], far[c], far[b]]);
  }

  for (let corner = 0; corner < profile.length; corner += 1) {
    const next = (corner + 1) % profile.length;
    triangles.push([near[corner], far[corner], far[next]], [near[corner], far[next], near[next]]);
    drawn.push([near[corner], near[next]], [far[corner], far[next]]);
    if (depthCorners.has(corner)) drawn.push([near[corner], far[corner]]);
  }

  return { near, far };
}

// Deterministic ear clipping keeps the two broad faces inside the concave outline. A fan from one
// boundary corner would cut straight across the notches between branches and recreate overlaps in
// the surface even though the contour itself was clean.
function triangulate(profile: readonly Point2[]): Triple[] {
  const remaining = profile.map((_, index) => index);
  const triangles: Triple[] = [];

  while (remaining.length > 3) {
    let clipped = false;
    for (let position = 0; position < remaining.length; position += 1) {
      const previous = remaining[(position - 1 + remaining.length) % remaining.length];
      const corner = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      if (turn(profile[previous], profile[corner], profile[next]) <= 1e-12) continue;
      if (remaining.some((candidate) => candidate !== previous && candidate !== corner && candidate !== next
        && insideTriangle(profile[candidate], profile[previous], profile[corner], profile[next]))) continue;

      triangles.push([previous, corner, next]);
      remaining.splice(position, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("snowflake profile is not a simple counter-clockwise polygon");
  }

  triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

function insideTriangle(point: Point2, a: Point2, b: Point2, c: Point2): boolean {
  return turn(a, b, point) >= -1e-12 && turn(b, c, point) >= -1e-12 && turn(c, a, point) >= -1e-12;
}

function turn(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
