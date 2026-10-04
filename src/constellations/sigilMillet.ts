import type { SolidPoint } from "./glyphSolid";
import { add, intoFigureSpace, mix, scale, subtract, unit } from "./sigilVectors";

// A millet ear is a particularly strict silhouette: one fine upright, a pointed grain at its crown,
// and three paired blades opening upwards below it. The drawing is simple, but it must not be flat.
// Each blade is therefore a closed spindle with a broad lenticular section and a ridge on both its
// near and far side. The stem is a separate closed round bar running into the crown. Overlap is
// intentional, as it is for the hammer's haft: the bodies hide the joins rather than exposing seams.

export type MilletBlade = {
  /** Where the blade leaves the stem, in the figure's authored plane. */
  root: readonly [number, number];
  /** Its pointed outer end. A positive x is mirrored to make the left blade. */
  tip: readonly [number, number];
  /** Half-width in the authored plane. */
  width: number;
  /** Half-depth through the authored plane. */
  depth: number;
};

export type MilletOptions = {
  stem: { bottom: number; top: number; radius: number; sides: number };
  crown: MilletBlade;
  pairs: readonly MilletBlade[];
  around: number;
};

export const MILLET: MilletOptions = {
  stem: { bottom: -1, top: 0.72, radius: 0.035, sides: 6 },
  crown: { root: [0, 0.58], tip: [0, 1.12], width: 0.105, depth: 0.09 },
  pairs: [
    { root: [0, -0.34], tip: [0.48, 0.1], width: 0.14, depth: 0.11 },
    { root: [0, -0.02], tip: [0.54, 0.43], width: 0.15, depth: 0.115 },
    { root: [0, 0.26], tip: [0.46, 0.72], width: 0.135, depth: 0.105 },
  ],
  around: 8,
};

type Triple = [number, number, number];
type Pair = [number, number];
type Mesh = { vertices: SolidPoint[]; triangles: Triple[]; drawn: Pair[] };

export function buildMillet(options: MilletOptions = MILLET) {
  const mesh: Mesh = { vertices: [], triangles: [], drawn: [] };
  tube(mesh, options.stem.bottom, options.stem.top, options.stem.radius, options.stem.sides);

  const crown = spindle(mesh, options.crown, 1, options.around);
  const anchors = [crown.tip];
  for (const blade of options.pairs) {
    const left = spindle(mesh, blade, -1, options.around);
    const right = spindle(mesh, blade, 1, options.around);
    anchors.push(left.tip, right.tip);
  }

  return {
    name: "millet",
    source: { file: `generated, one pointed crown over ${options.pairs.length} mirrored pairs on a closed stem` },
    vertices: intoFigureSpace(mesh.vertices),
    triangles: mesh.triangles,
    drawn: mesh.drawn,
    anchors,
  };
}

// One pointed leaf or grain. Two broad stations give it a long almond profile rather than the
// swollen middle of an ellipsoid. Eight corners are enough to round that profile while retaining a
// definite front and back ridge for the drawing.
function spindle(mesh: Mesh, blade: MilletBlade, side: -1 | 1, around: number): { tip: number } {
  const start: SolidPoint = [side * blade.root[0], blade.root[1], 0];
  const end: SolidPoint = [side * blade.tip[0], blade.tip[1], 0];
  const heading = unit(subtract(end, start));
  // `across × through` points along the spindle, so the common band winding faces outwards.
  const across: SolidPoint = [-heading[1], heading[0], 0];
  const through: SolidPoint = [0, 0, 1];
  const first = place(mesh, start);
  const rings = [
    section(mesh, mix(start, end, 0.3), across, through, blade.width * 0.88, blade.depth * 0.88, around),
    section(mesh, mix(start, end, 0.66), across, through, blade.width, blade.depth, around),
  ];
  const last = place(mesh, end);

  cap(mesh, first, rings[0], false);
  band(mesh, rings[0], rings[1]);
  cap(mesh, last, rings[1], true);

  // The opposed depth corners are the two ridges of a lenticular body. Both are authored; hidden
  // line removal chooses the one belonging to the side an observer can actually see.
  for (const corner of [Math.round(around / 4), Math.round((3 * around) / 4)]) {
    mesh.drawn.push([first, rings[0][corner]], [rings[0][corner], rings[1][corner]], [rings[1][corner], last]);
  }
  return { tip: last };
}

function section(
  mesh: Mesh,
  centre: SolidPoint,
  across: SolidPoint,
  through: SolidPoint,
  width: number,
  depth: number,
  around: number,
): number[] {
  return Array.from({ length: around }, (_, corner) => {
    const angle = (2 * Math.PI * corner) / around;
    return place(mesh, add(centre, add(scale(across, Math.cos(angle) * width), scale(through, Math.sin(angle) * depth))));
  });
}

// The stem is closed independently. Its front rail gives the otherwise very narrow cylinder one
// stable interior stroke, while its observer-dependent outline supplies the two sides.
function tube(mesh: Mesh, bottom: number, top: number, radius: number, sides: number): void {
  const lower = section(mesh, [0, bottom, 0], [-1, 0, 0], [0, 0, 1], radius, radius, sides);
  const upper = section(mesh, [0, top, 0], [-1, 0, 0], [0, 0, 1], radius, radius, sides);
  const foot = place(mesh, [0, bottom, 0]);
  const head = place(mesh, [0, top, 0]);

  cap(mesh, foot, lower, false);
  band(mesh, lower, upper);
  cap(mesh, head, upper, true);

  const front = Math.round(sides / 4);
  mesh.drawn.push([foot, lower[front]], [lower[front], upper[front]], [upper[front], head]);
}

function band(mesh: Mesh, near: readonly number[], far: readonly number[]): void {
  for (let corner = 0; corner < near.length; corner += 1) {
    const next = (corner + 1) % near.length;
    mesh.triangles.push([near[corner], far[next], far[corner]], [near[corner], near[next], far[next]]);
  }
}

function cap(mesh: Mesh, point: number, ring: readonly number[], forward: boolean): void {
  for (let corner = 0; corner < ring.length; corner += 1) {
    const next = (corner + 1) % ring.length;
    mesh.triangles.push(forward ? [point, ring[corner], ring[next]] : [point, ring[next], ring[corner]]);
  }
}

function place(mesh: Mesh, point: SolidPoint): number {
  return mesh.vertices.push(point) - 1;
}
