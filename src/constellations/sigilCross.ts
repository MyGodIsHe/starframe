import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

// An аптечный cross is the equal-armed cross used as the sign of a pharmacy: four broad,
// square-ended arms meeting without a gap. Its rule is the outline itself, so unlike a sculpted
// subject it can be generated without inventing any unseen anatomy. The outline is carried through
// a real thickness, making one closed body rather than a flat sign.
//
// One face contour is marked because it is the character of the figure; the silhouette recovers the
// corresponding rim when the other face turns toward the observer. Every turn of the contour is
// also carried across the thickness, while fan edges into each face only triangulate a plane.

export type CrossOptions = {
  /** Distance from the centre to the square end of every arm. */
  reach: number;
  /** Half-width shared by all four arms. */
  halfWidth: number;
  /** Half of the body's depth through the figure. */
  halfDepth: number;
};

export const CROSS: CrossOptions = {
  reach: 1,
  halfWidth: 0.36,
  halfDepth: 0.18,
};

/** Three indices into the vertices, which is one triangle. */
type Triple = [number, number, number];

/** Two indices into the vertices, which is one authored line of the figure. */
type Pair = [number, number];

export function buildCross({ reach, halfWidth, halfDepth }: CrossOptions = CROSS) {
  // Clockwise seen from the near face: around the top arm, right arm, bottom arm and left arm.
  // The three corners contributed by each quarter are what make a plus rather than a rectangle.
  const profile: readonly (readonly [number, number])[] = [
    [-halfWidth, reach],
    [halfWidth, reach],
    [halfWidth, halfWidth],
    [reach, halfWidth],
    [reach, -halfWidth],
    [halfWidth, -halfWidth],
    [halfWidth, -reach],
    [-halfWidth, -reach],
    [-halfWidth, -halfWidth],
    [-reach, -halfWidth],
    [-reach, halfWidth],
    [-halfWidth, halfWidth],
  ];

  const vertices: SolidPoint[] = [];
  const ring = (depth: number): number[] => profile.map(([x, y]) => vertices.push([x, y, depth]) - 1);
  const near = ring(halfDepth);
  const far = ring(-halfDepth);
  const nearCentre = vertices.push([0, 0, halfDepth]) - 1;
  const farCentre = vertices.push([0, 0, -halfDepth]) - 1;
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];

  for (let corner = 0; corner < profile.length; corner += 1) {
    const next = (corner + 1) % profile.length;

    // The profile was walked clockwise, so the near fan reverses that walk and the far fan keeps it.
    triangles.push([nearCentre, near[next], near[corner]], [farCentre, far[corner], far[next]]);
    // A pair of triangles closes the wall between corresponding contour edges.
    triangles.push([near[corner], near[next], far[next]], [near[corner], far[next], far[corner]]);

    drawn.push(
      [near[corner], near[next]],
      [near[corner], far[corner]],
    );
  }

  return {
    name: "cross",
    source: { file: "generated, an equal-armed pharmacy cross carried through a solid depth" },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    // One outer corner from each arm, alternating faces so the anchors describe the body's depth
    // without putting two Solar Systems at the same apparent extremity.
    anchors: [near[0], far[3], near[6], far[9]],
  };
}
