import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

// A Pac-Man is one of the rare silhouettes that can be stated completely as geometry: a round
// plate with a sector removed. Giving that outline thickness makes the missing sector a real open
// mouth, bounded by two lips and an inside corner, rather than a triangle painted over a disc.
//
// The circumference is deliberately faceted. It keeps the body inexpensive for the facing test and
// gives the long round back a visible rhythm without drawing triangulation across either broad face.
// Both face outlines are drawn, together with the three corners carried through the thickness: the
// two ends of the mouth and the point at which its lips meet.

export type PacmanOptions = {
  /** Angle removed from the positive x side of the round plate. */
  mouth: number;
  /** Number of equal chords around the circumference left behind by the mouth. */
  segments: number;
  /** Half the plate's thickness, relative to its radius. */
  thickness: number;
};

export const PACMAN: PacmanOptions = {
  mouth: (2 * Math.PI) / 9,
  segments: 24,
  thickness: 0.22,
};

type Triple = [number, number, number];

export function buildPacman(options: PacmanOptions = PACMAN) {
  const { mouth, segments, thickness } = options;
  const halfMouth = mouth / 2;
  const sweep = 2 * Math.PI - mouth;

  // The profile is walked counter-clockwise: from the point inside the mouth, along its upper lip,
  // round the back, and home along the lower lip. The repeated arc endpoints belong to the profile
  // only once, so every boundary edge has exactly one wall standing on it.
  const profile: readonly [number, number][] = [
    [0, 0],
    ...Array.from({ length: segments + 1 }, (_, step): [number, number] => {
      const angle = halfMouth + (sweep * step) / segments;
      return [Math.cos(angle), Math.sin(angle)];
    }),
  ];

  const vertices: SolidPoint[] = [];
  const placeRing = (height: number): number[] =>
    profile.map(([x, y]) => vertices.push([x, y, height]) - 1);

  const near = placeRing(thickness);
  const far = placeRing(-thickness);
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];

  // The broad faces are triangle fans from the mouth's inside corner. They cover the plate that is
  // left, never the missing sector. Reversing the far fan keeps both faces wound outward.
  for (let segment = 0; segment < segments; segment += 1) {
    triangles.push([near[0], near[segment + 1], near[segment + 2]]);
    triangles.push([far[0], far[segment + 2], far[segment + 1]]);
  }

  // One wall for every profile edge: upper lip, each chord of the round back, and lower lip.
  for (let step = 0; step < profile.length; step += 1) {
    const next = (step + 1) % profile.length;
    triangles.push([near[step], far[step], far[next]], [near[step], far[next], near[next]]);
    drawn.push([near[step], near[next]], [far[step], far[next]]);
  }

  // Only actual corners of the subject cross its thickness. The intermediate circumference sites
  // make facets, but vertical stripes at every site would turn the figure into a cage.
  for (const corner of [0, 1, profile.length - 1]) drawn.push([near[corner], far[corner]]);

  const anchorSteps = [0, Math.round(segments / 3), Math.round((2 * segments) / 3), segments];

  return {
    name: "pacman",
    source: { file: `generated, a ${segments}-facet round plate with a ${Math.round((mouth * 180) / Math.PI)} degree mouth` },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    // The two mouth corners and two points round the back carry the characteristic extent. Taking
    // alternate faces avoids pairing anchors at effectively the same place through the thickness.
    anchors: anchorSteps.map((step, index) => (index % 2 === 0 ? near : far)[step + 1]),
  };
}
