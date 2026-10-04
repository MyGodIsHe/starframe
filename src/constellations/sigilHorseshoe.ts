import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

type Triple = [number, number, number];
type Pair = [number, number];

export type HorseshoeOptions = {
  /** Facets along the U-shaped sweep. */
  around: number;
  /** The first and last angles of the long arc, in degrees. */
  from: number;
  to: number;
  /** Four radii make three strips; nail holes occupy the middle strip. */
  radii: readonly [number, number, number, number];
  /** Half the depth through the figure. */
  depth: number;
  /** Angular cells removed through the middle strip to make nail holes. */
  holes: readonly number[];
};

export const HORSESHOE: HorseshoeOptions = {
  around: 27,
  from: 135,
  to: 405,
  radii: [0.52, 0.64, 0.82, 1],
  depth: 0.13,
  holes: [3, 7, 11, 15, 19, 23],
};

/**
 * A broad iron shoe, bent through three quarters of a circle and pierced by six nail holes.
 *
 * The surface is a polar grid. Removing one middle cell and closing its four exposed sides makes a
 * genuine hole through the body, rather than a circle painted onto its face. The two shallow strips
 * on either side of the holes keep one continuous piece of iron around every opening.
 */
export function buildHorseshoe(options: HorseshoeOptions = HORSESHOE) {
  const { around, from, to, radii, depth } = options;
  const holeCells = new Set(options.holes);
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];

  // Depth zero is the back and depth one the front. Keeping every grid point, including the corners
  // of removed cells, lets the neighbouring face and the wall of a nail hole share the same edge.
  for (let angle = 0; angle <= around; angle += 1) {
    const turn = ((from + ((to - from) * angle) / around) * Math.PI) / 180;
    for (const radius of radii) {
      vertices.push([radius * Math.cos(turn), radius * Math.sin(turn), -depth]);
      vertices.push([radius * Math.cos(turn), radius * Math.sin(turn), depth]);
    }
  }

  const at = (angle: number, radius: number, front: boolean): number =>
    (angle * radii.length + radius) * 2 + (front ? 1 : 0);

  const faceCell = (angle: number, radius: number): void => {
    const back = [at(angle, radius, false), at(angle + 1, radius, false), at(angle + 1, radius + 1, false), at(angle, radius + 1, false)] as const;
    const front = [at(angle, radius, true), at(angle + 1, radius, true), at(angle + 1, radius + 1, true), at(angle, radius + 1, true)] as const;

    // The front points out of the page and the back points into it.
    triangles.push([front[0], front[3], front[2]], [front[0], front[2], front[1]]);
    triangles.push([back[0], back[2], back[3]], [back[0], back[1], back[2]]);
  };

  /** Wall along an angular interval; positive means its normal points away from the centre. */
  const radialWall = (angle: number, radius: number, positive: boolean): void => {
    const b0 = at(angle, radius, false);
    const b1 = at(angle + 1, radius, false);
    const f0 = at(angle, radius, true);
    const f1 = at(angle + 1, radius, true);
    if (positive) triangles.push([b0, b1, f1], [b0, f1, f0]);
    else triangles.push([b0, f1, b1], [b0, f0, f1]);
  };

  /** Wall along a radial interval; positive means its normal points with increasing angle. */
  const angleWall = (angle: number, radius: number, positive: boolean): void => {
    const innerBack = at(angle, radius, false);
    const outerBack = at(angle, radius + 1, false);
    const innerFront = at(angle, radius, true);
    const outerFront = at(angle, radius + 1, true);
    if (positive) triangles.push([innerBack, outerFront, outerBack], [innerBack, innerFront, outerFront]);
    else triangles.push([innerBack, outerBack, outerFront], [innerBack, outerFront, innerFront]);
  };

  for (let angle = 0; angle < around; angle += 1) {
    for (let radius = 0; radius + 1 < radii.length; radius += 1) {
      if (radius !== 1 || !holeCells.has(angle)) faceCell(angle, radius);
    }
    radialWall(angle, 0, false);
    radialWall(angle, radii.length - 1, true);
  }

  for (let radius = 0; radius + 1 < radii.length; radius += 1) {
    angleWall(0, radius, false);
    angleWall(around, radius, true);
  }

  // Each omitted cell gets four inward-facing walls. Together with the surrounding face grid these
  // walls make a closed tunnel through the shoe.
  for (const angle of holeCells) {
    radialWall(angle, 1, true);
    radialWall(angle, 2, false);
    angleWall(angle, 1, true);
    angleWall(angle + 1, 1, false);

    // Both mouths are characteristic lines of a horseshoe. Their walls remain ordinary surface
    // edges and are left to the silhouette/facing rules.
    for (const front of [false, true]) {
      drawn.push(
        [at(angle, 1, front), at(angle, 2, front)],
        [at(angle, 2, front), at(angle + 1, 2, front)],
        [at(angle + 1, 2, front), at(angle + 1, 1, front)],
        [at(angle + 1, 1, front), at(angle, 1, front)],
      );
    }
  }

  // The inner and outer rims make the U readable even before the dynamic silhouette is considered.
  for (let angle = 0; angle < around; angle += 1) {
    for (const front of [false, true]) {
      drawn.push([at(angle, 0, front), at(angle + 1, 0, front)]);
      drawn.push([at(angle, radii.length - 1, front), at(angle + 1, radii.length - 1, front)]);
    }
  }
  for (let radius = 0; radius + 1 < radii.length; radius += 1) {
    for (const front of [false, true]) {
      drawn.push([at(0, radius, front), at(0, radius + 1, front)]);
      drawn.push([at(around, radius, front), at(around, radius + 1, front)]);
    }
  }

  const anchors = [0, 5, 14, 22, around].map((angle) => at(angle, radii.length - 1, true));

  return {
    name: "horseshoe",
    source: { file: `generated, ${around} facets with ${holeCells.size} nail holes` },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    anchors,
  };
}
