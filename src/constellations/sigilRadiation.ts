import type { SolidPoint } from "./glyphSolid";
import { scale } from "./sigilVectors";

// A radiation trefoil is one of the few symbols whose volume follows directly from its drawing:
// one round boss and three equal annular sectors, separated by open sky. Each part is therefore its
// own closed plate. Keeping the four bodies apart matters more than joining them into one mesh: the
// gaps are the characteristic strokes of the symbol, and a real gap lets the hidden-line pass show
// a far rim through it when the figure turns.
export type RadiationOptions = {
  /** Segments around the central disc. */
  discSegments: number;
  /** Radius of the central disc, before the whole figure is put on the unit sphere. */
  discRadius: number;
  /** Half the depth of the central disc. */
  discThickness: number;
  /** Segments along each curved edge of a lobe. */
  lobeSegments: number;
  /** Radius where every lobe begins, leaving a clear ring around the central disc. */
  lobeInnerRadius: number;
  /** Angle occupied by one lobe; what remains of its third of the circle is open sky. */
  lobeSpread: number;
  /** Half the depth of each lobe. */
  lobeThickness: number;
};

export const RADIATION: RadiationOptions = {
  discSegments: 18,
  discRadius: 0.23,
  discThickness: 0.15,
  lobeSegments: 8,
  lobeInnerRadius: 0.38,
  lobeSpread: Math.PI / 3,
  lobeThickness: 0.11,
};

type Triple = [number, number, number];
type Edge = [number, number];

export function buildRadiation(options: RadiationOptions = RADIATION) {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Edge[] = [];

  addDisc(options, vertices, triangles, drawn);
  const anchors = [0, 1, 2].flatMap((lobe) => addLobe(options, lobe, vertices, triangles, drawn));
  // Three-fold rotation already centres the symbol on its boss. Bounding-box centring would move a
  // three-fold figure off that true centre (its upright lobe reaches higher than the two lower ones),
  // so only the shared radial reach is normalised here.
  const reach = Math.max(...vertices.map((point) => Math.hypot(...point)));

  return {
    name: "radiation",
    source: { file: `generated, a round boss and three ${options.lobeSegments}-segment sector plates` },
    vertices: vertices.map((point) => scale(point, 1 / reach)),
    triangles,
    drawn,
    anchors,
  };
}

function addDisc(
  { discSegments: segments, discRadius: radius, discThickness: depth }: RadiationOptions,
  vertices: SolidPoint[],
  triangles: Triple[],
  drawn: Edge[],
): void {
  const offset = vertices.length;
  const at = (side: 0 | 1, step: number): number => offset + side * segments + (step % segments);

  for (const z of [depth, -depth]) {
    for (let step = 0; step < segments; step += 1) {
      const angle = Math.PI / 2 + step * 2 * Math.PI / segments;
      vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), z]);
    }
  }

  // A convex face needs no centre vertex: a fan from one rim point keeps the disc coarse, while the
  // unmarked diagonals remain structural and never appear in the drawing.
  for (let step = 1; step < segments - 1; step += 1) {
    triangles.push([at(0, 0), at(0, step), at(0, step + 1)]);
    triangles.push([at(1, 0), at(1, step + 1), at(1, step)]);
  }
  for (let step = 0; step < segments; step += 1) {
    const next = step + 1;
    triangles.push([at(0, step), at(1, step), at(1, next)], [at(0, step), at(1, next), at(0, next)]);
    drawn.push([at(0, step), at(0, next)], [at(1, step), at(1, next)]);
  }
}

// Add one annular sector as a closed plate. Its vertices are kept in four contiguous rails so the
// surface can be inspected as a lobe without any geometric classification: near outer, near inner,
// far outer, far inner.
function addLobe(
  options: RadiationOptions,
  lobe: number,
  vertices: SolidPoint[],
  triangles: Triple[],
  drawn: Edge[],
): number[] {
  const { lobeSegments: segments, lobeInnerRadius: inner, lobeSpread: spread, lobeThickness: depth } = options;
  const offset = vertices.length;
  const railLength = segments + 1;
  const at = (rail: 0 | 1 | 2 | 3, step: number): number => offset + rail * railLength + step;
  const middle = Math.PI / 2 + lobe * 2 * Math.PI / 3;

  for (const z of [depth, -depth]) {
    for (const radius of [1, inner]) {
      for (let step = 0; step <= segments; step += 1) {
        const angle = middle - spread / 2 + spread * step / segments;
        vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), z]);
      }
    }
  }

  for (let step = 0; step < segments; step += 1) {
    const next = step + 1;
    // Near and far faces of the sector.
    triangles.push([at(0, step), at(0, next), at(1, next)], [at(0, step), at(1, next), at(1, step)]);
    triangles.push([at(2, step), at(3, next), at(2, next)], [at(2, step), at(3, step), at(3, next)]);
    // Curved outer wall and the wall facing into the central gap.
    triangles.push([at(0, step), at(2, step), at(2, next)], [at(0, step), at(2, next), at(0, next)]);
    triangles.push([at(1, step), at(1, next), at(3, next)], [at(1, step), at(3, next), at(3, step)]);

    for (const rail of [0, 1, 2, 3] as const) drawn.push([at(rail, step), at(rail, next)]);
  }

  // The two radial ends close the sector. Their face edges and depth corners are authored lines:
  // they preserve the trefoil when seen obliquely, where the arcs alone collapse onto each other.
  const start = 0;
  const end = segments;
  triangles.push(
    [at(0, start), at(1, start), at(3, start)], [at(0, start), at(3, start), at(2, start)],
    [at(0, end), at(2, end), at(3, end)], [at(0, end), at(3, end), at(1, end)],
  );
  for (const step of [start, end]) {
    drawn.push(
      [at(0, step), at(1, step)], [at(2, step), at(3, step)],
      [at(0, step), at(2, step)], [at(1, step), at(3, step)],
    );
  }

  // Six tips across the three lobes give the fitter choices around the whole silhouette. Alternating
  // faces avoids paired anchors through the shallow depth while every chosen corner stays extremal.
  return lobe % 2 === 0
    ? [at(0, start), at(2, end)]
    : [at(2, start), at(0, end)];
}
