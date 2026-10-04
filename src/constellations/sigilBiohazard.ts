import type { SolidPoint } from "./glyphSolid";

// The biohazard mark is one of the rare signs whose geometry is itself the subject: three equal
// hooked lobes turn round a central node. Here each stroke is a closed tube rather than a line laid
// on a plate. The air between the four bodies therefore remains real negative space from every
// face-on view, while a narrow view still reveals their depth.

export type BiohazardOptions = {
  ring: {
    /** Facets around the central node. */
    around: number;
    /** Facets through its tube. */
    through: number;
    /** Radius of the node's centre line, before the whole figure is normalized. */
    radius: number;
    /** Radius of the tube making the node. */
    thickness: number;
  };
  lobe: {
    /** Steps along each of the three broken circular strokes. */
    along: number;
    /** Facets through a lobe's tube. */
    through: number;
    /** Radius of that tube. */
    thickness: number;
    /** Radius of the outer circular lobe and how far its centre stands from the node. */
    radius: number;
    centre: number;
    /** Angular gap facing the central node. */
    opening: number;
  };
};

export const BIOHAZARD: BiohazardOptions = {
  ring: { around: 12, through: 4, radius: 0.2, thickness: 0.065 },
  lobe: { along: 10, through: 4, thickness: 0.07, radius: 0.43, centre: 0.58, opening: Math.PI / 2 },
};

type Triple = [number, number, number];
type Pair = [number, number];

type Parts = {
  vertices: SolidPoint[];
  triangles: Triple[];
  drawn: Pair[];
  outer: number;
  start: number;
};

export function buildBiohazard(options: BiohazardOptions = BIOHAZARD) {
  if (options.lobe.through !== 4) throw new Error("Biohazard lobes require a four-sided tube");
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];

  appendRing(options, vertices, triangles, drawn);

  const lobes = Array.from({ length: 3 }, (_, lobe) => {
    const part = makeLobe(options);
    const angle = lobe * 2 * Math.PI / 3;
    const offset = vertices.length;

    vertices.push(...part.vertices.map((point) => turn(point, angle)));
    triangles.push(...part.triangles.map(([a, b, c]): Triple => [a + offset, b + offset, c + offset]));
    drawn.push(...part.drawn.map(([a, b]): Pair => [a + offset, b + offset]));
    return { outer: part.outer + offset, start: part.start + offset };
  });

  return {
    name: "biohazard",
    source: { file: `generated, a central node and three ${options.lobe.along}-step hooked lobes` },
    vertices: ontoUnitSphere(vertices),
    triangles,
    drawn,
    // The three crowns say where the sign reaches. One inward hook gives a fourth, differently
    // placed correspondence so a sparse Constellation can settle the figure's slight turn.
    anchors: [lobes[0].outer, lobes[1].outer, lobes[2].outer, lobes[0].start],
  };
}

function appendRing(
  { ring }: BiohazardOptions,
  vertices: SolidPoint[],
  triangles: Triple[],
  drawn: Pair[],
): void {
  const offset = vertices.length;
  const at = (along: number, through: number): number =>
    offset + ((along % ring.around) + ring.around) % ring.around * ring.through
      + (((through % ring.through) + ring.through) % ring.through);

  for (let along = 0; along < ring.around; along += 1) {
    const angle = along * 2 * Math.PI / ring.around;
    for (let through = 0; through < ring.through; through += 1) {
      const sweep = through * 2 * Math.PI / ring.through;
      const radius = ring.radius + ring.thickness * Math.cos(sweep);
      vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), ring.thickness * Math.sin(sweep)]);
    }
  }

  for (let along = 0; along < ring.around; along += 1) {
    for (let through = 0; through < ring.through; through += 1) {
      const corner = at(along, through);
      const next = at(along + 1, through);
      const across = at(along + 1, through + 1);
      const over = at(along, through + 1);
      triangles.push([corner, next, across], [corner, across, over]);
      // The inner and outer rims are the two strokes that make the central opening legible.
      if (through % 2 === 0) drawn.push([corner, next]);
    }
  }
}

// One lobe, standing upward. Its centre line is most of a circle with its missing quarter facing the
// node: that broad broken roundel, rather than a narrow U-shaped petal, is the characteristic outer
// mass of the international sign. Rotating it twice gives the mark its strict three-fold symmetry.
function makeLobe({ lobe }: BiohazardOptions): Parts {
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];
  const at = (along: number, through: number): number => along * lobe.through + through;

  for (let along = 0; along <= lobe.along; along += 1) {
    const time = along / lobe.along;
    const sweep = -Math.PI / 2 + lobe.opening / 2 + time * (2 * Math.PI - lobe.opening);
    const centre: SolidPoint = [
      lobe.radius * Math.cos(sweep),
      lobe.centre + lobe.radius * Math.sin(sweep),
      0,
    ];
    const normal = [Math.cos(sweep), Math.sin(sweep)];

    for (let through = 0; through < lobe.through; through += 1) {
      const sweep = through * 2 * Math.PI / lobe.through;
      vertices.push([
        centre[0] + lobe.thickness * normal[0] * Math.cos(sweep),
        centre[1] + lobe.thickness * normal[1] * Math.cos(sweep),
        lobe.thickness * Math.sin(sweep),
      ]);
    }
  }

  for (let along = 0; along < lobe.along; along += 1) {
    for (let through = 0; through < lobe.through; through += 1) {
      const corner = at(along, through);
      const next = at(along + 1, through);
      const across = at(along + 1, (through + 1) % lobe.through);
      const over = at(along, (through + 1) % lobe.through);
      triangles.push([corner, next, across], [corner, across, over]);
      // The two rails on the face of the hook preserve its sweep when the body is seen face on.
      if (through % 2 === 0) drawn.push([corner, next]);
    }
  }

  // Flat ends close the tube. Their four perimeter edges are real corners of the sign, not seams
  // introduced by triangulation, so they belong to the drawing as well as to the surface.
  triangles.push([at(0, 0), at(0, 1), at(0, 2)], [at(0, 0), at(0, 2), at(0, 3)]);
  triangles.push(
    [at(lobe.along, 0), at(lobe.along, 2), at(lobe.along, 1)],
    [at(lobe.along, 0), at(lobe.along, 3), at(lobe.along, 2)],
  );
  for (let through = 0; through < lobe.through; through += 1) {
    drawn.push([at(0, through), at(0, (through + 1) % lobe.through)]);
    drawn.push([at(lobe.along, through), at(lobe.along, (through + 1) % lobe.through)]);
  }

  return {
    vertices,
    triangles,
    drawn,
    outer: at(Math.floor(lobe.along / 2), 0),
    start: at(0, 0),
  };
}

function turn([x, y, z]: SolidPoint, angle: number): SolidPoint {
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z];
}

// Three-fold symmetry already centres the sign on its node. Bounding-box centring would move that
// node toward one lobe (a three-pointed figure is not centrally symmetric), so only its reach is
// normalized here.
function ontoUnitSphere(vertices: readonly SolidPoint[]): SolidPoint[] {
  const reach = Math.max(...vertices.map((point) => Math.hypot(...point)));
  return vertices.map(([x, y, z]): SolidPoint => [x / reach, y / reach, z / reach]);
}
