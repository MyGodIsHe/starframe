import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

/** Proportions of the angular broken ring and the blade driven through it. */
export type QuakeOptions = {
  depth: number;
  outer: readonly (readonly [number, number])[];
  inner: readonly (readonly [number, number])[];
  blade: readonly (readonly [number, number])[];
};

// Both ring paths run from the left side of the break, over the crown, to its right side. Keeping
// matching corners on the two paths makes the rune a deliberately faceted band rather than a round
// tube sampled at arbitrary resolution.
export const QUAKE: QuakeOptions = {
  depth: 0.16,
  outer: [
    [-0.56, -0.43], [-0.88, -0.08], [-0.79, 0.52], [-0.38, 0.84],
    [0, 0.94], [0.38, 0.84], [0.79, 0.52], [0.88, -0.08], [0.56, -0.43],
  ],
  inner: [
    [-0.27, -0.18], [-0.48, 0.04], [-0.42, 0.34], [-0.2, 0.53],
    [0, 0.59], [0.2, 0.53], [0.42, 0.34], [0.48, 0.04], [0.27, -0.18],
  ],
  // The broad shoulders lock into the broken ring; below them the blade pulls into the long point
  // that distinguishes this rune from an ordinary letter Q.
  blade: [[0, 0.73], [0.15, 0.24], [0.13, -0.22], [0.27, -0.4], [0, -1.22], [-0.27, -0.4], [-0.13, -0.22], [-0.15, 0.24]],
};

type Triple = [number, number, number];
type Pair = [number, number];

export function buildQuake(options: QuakeOptions = QUAKE) {
  if (options.outer.length !== options.inner.length || options.outer.length < 2) throw new Error("Quake ring paths must have matching corners");

  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: Pair[] = [];
  const place = ([x, y]: readonly [number, number], z: number): number => vertices.push([x, y, z]) - 1;

  const outerFront = options.outer.map((point) => place(point, options.depth));
  const innerFront = options.inner.map((point) => place(point, options.depth));
  const outerBack = options.outer.map((point) => place(point, -options.depth));
  const innerBack = options.inner.map((point) => place(point, -options.depth));

  for (let step = 0; step + 1 < options.outer.length; step += 1) {
    const next = step + 1;
    // Flat faces of the open band, then its outer and inner walls. The diagonals only hold facets
    // together; the four authored corners are the lines of the rune.
    triangles.push(
      [outerFront[step], innerFront[next], outerFront[next]], [outerFront[step], innerFront[step], innerFront[next]],
      [outerBack[step], outerBack[next], innerBack[next]], [outerBack[step], innerBack[next], innerBack[step]],
      [outerFront[step], outerBack[next], outerBack[step]], [outerFront[step], outerFront[next], outerBack[next]],
      [innerFront[step], innerBack[step], innerBack[next]], [innerFront[step], innerBack[next], innerFront[next]],
    );
    drawn.push(
      [outerFront[step], outerFront[next]],
      [innerFront[step], innerFront[next]],
      [outerFront[step], outerBack[step]], [innerFront[step], innerBack[step]],
    );
  }

  const last = options.outer.length - 1;
  // Close the two cut ends of the broken ring.
  triangles.push(
    [outerFront[0], outerBack[0], innerBack[0]], [outerFront[0], innerBack[0], innerFront[0]],
    [outerFront[last], innerBack[last], outerBack[last]], [outerFront[last], innerFront[last], innerBack[last]],
  );
  drawn.push(
    [outerFront[0], innerFront[0]], [outerBack[0], innerBack[0]],
    [outerFront[last], innerFront[last]], [outerBack[last], innerBack[last]],
    [outerFront[last], outerBack[last]], [innerFront[last], innerBack[last]],
  );

  const bladeStart = vertices.length;
  addBlade(options.blade, options.depth * 1.18, vertices, triangles, drawn);

  return {
    name: "quake",
    source: { file: "generated, an angular broken ring pierced by a long faceted blade" },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    anchors: [outerFront[2], outerFront[4], outerBack[6], bladeStart, bladeStart + 4, outerBack[0]],
  };
}

function addBlade(profile: readonly (readonly [number, number])[], depth: number, vertices: SolidPoint[], triangles: Triple[], drawn: Pair[]): void {
  const front = profile.map(([x, y]) => vertices.push([x, y, depth]) - 1);
  const back = profile.map(([x, y]) => vertices.push([x, y, -depth]) - 1);
  const frontCentre = vertices.push([0, -0.08, depth]) - 1;
  const backCentre = vertices.push([0, -0.08, -depth]) - 1;

  for (let corner = 0; corner < profile.length; corner += 1) {
    const next = (corner + 1) % profile.length;
    triangles.push(
      [frontCentre, front[next], front[corner]],
      [backCentre, back[corner], back[next]],
      [front[corner], back[corner], back[next]], [front[corner], back[next], front[next]],
    );
    drawn.push([front[corner], front[next]], [front[corner], back[corner]]);
  }
}
