import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

// A snowflake is one of the few figures whose sculpture is wholly described by a rule: six equal
// rays, each carrying the same paired branches. The pieces overlap at their roots but each is a
// closed shallow crystal in its own right. That keeps the silhouette unmistakable while preserving
// honest volume and occlusion when Glyph Parallax turns the figure edge-on.

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
  /** Radius of the hexagonal crystal joining the rays into one silhouette. */
  hub: number;
  /** Half-width of a main ray at its root. */
  rayWidth: number;
  /** Half-width of a branch at its root. */
  branchWidth: number;
  /** Half-depth of every crystal, before the figure is normalized. */
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
  const tips: Array<{ near: number; far: number }> = [];

  // The centre is a hexagonal crystal rather than an empty crossing. Besides joining the six rays
  // visually, its two rims give the face-on drawing a characteristic little heart.
  const hub = Array.from({ length: options.arms }, (_, step): Point2 => {
    const angle = (2 * Math.PI * step) / options.arms;
    return [options.hub * Math.cos(angle), options.hub * Math.sin(angle)];
  });
  extrude(hub, options.depth, vertices, triangles, drawn, true);

  for (let arm = 0; arm < options.arms; arm += 1) {
    const angle = (2 * Math.PI * arm) / options.arms;
    const along: Point2 = [Math.cos(angle), Math.sin(angle)];
    const across: Point2 = [-along[1], along[0]];

    // A main ray is a long triangular crystal. Its broad root disappears into the hub and its point
    // remains exposed at radius one, so the six points own both the silhouette and the anchors.
    const root = pointAlong(along, options.hub * 0.55);
    const ray = needle(root, along, [along[0], along[1]], options.rayWidth);
    const rayVertices = extrude(ray, options.depth, vertices, triangles, drawn, false);
    tips.push({ near: rayVertices.near[2], far: rayVertices.far[2] });

    for (const level of options.branchLevels) {
      const branchRoot = pointAlong(along, level.at);
      for (const side of [-1, 1]) {
        const branchTip: Point2 = [
          along[0] * (level.at + level.reach) + across[0] * level.spread * side,
          along[1] * (level.at + level.reach) + across[1] * level.spread * side,
        ];
        const heading: Point2 = [branchTip[0] - branchRoot[0], branchTip[1] - branchRoot[1]];
        extrude(needle(branchRoot, heading, branchTip, options.branchWidth), options.depth, vertices, triangles, drawn, false);
      }
    }
  }

  const sized = intoFigureSpace(vertices);
  return {
    name: "snowflake",
    source: { file: `generated, ${options.arms} rays with ${options.branchLevels.length} paired branch levels` },
    vertices: sized,
    triangles,
    drawn,
    // Alternating faces avoids placing every Solar System on one side of the shallow body while
    // keeping each anchor at a different, characteristic ray tip.
    anchors: tips.map((tip, index) => (index % 2 === 0 ? tip.near : tip.far)),
  };
}

function pointAlong(direction: Point2, distance: number): Point2 {
  return [direction[0] * distance, direction[1] * distance];
}

/** A counter-clockwise triangular crystal: a flat root and one sharp, recognisable tip. */
function needle(root: Point2, heading: Point2, tip: Point2, halfWidth: number): Point2[] {
  const reach = Math.hypot(heading[0], heading[1]);
  const normal: Point2 = [-heading[1] / reach, heading[0] / reach];
  return [
    [root[0] + normal[0] * halfWidth, root[1] + normal[1] * halfWidth],
    [root[0] - normal[0] * halfWidth, root[1] - normal[1] * halfWidth],
    tip,
  ];
}

// Extrude one convex profile as a closed crystal. One face rim is marked, plus selected corner edges
// through its depth; the silhouette supplies the opposite rim and triangulation diagonals stay out.
function extrude(
  profile: readonly Point2[],
  depth: number,
  vertices: SolidPoint[],
  triangles: Triple[],
  drawn: Pair[],
  markEveryCorner: boolean,
): { near: number[]; far: number[] } {
  const near = profile.map(([x, y]) => vertices.push([x, y, depth]) - 1);
  const far = profile.map(([x, y]) => vertices.push([x, y, -depth]) - 1);

  for (let corner = 1; corner + 1 < profile.length; corner += 1) {
    triangles.push([near[0], near[corner], near[corner + 1]]);
    triangles.push([far[0], far[corner + 1], far[corner]]);
  }

  for (let corner = 0; corner < profile.length; corner += 1) {
    const next = (corner + 1) % profile.length;
    triangles.push([near[corner], far[corner], far[next]], [near[corner], far[next], near[next]]);
    drawn.push([near[corner], near[next]]);
    if (markEveryCorner || corner === profile.length - 1) drawn.push([near[corner], far[corner]]);
  }

  return { near, far };
}
