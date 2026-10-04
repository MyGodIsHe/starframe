import type { SolidPoint } from "./glyphSolid";
import { add, cross, dot, length, mix, scale, subtract, unit } from "./sigilVectors";

// The third Sigil Figure this build makes for itself: a bolt of lightning.
//
// The shape is the one everybody draws, and it is a shape with a rule behind it: two wedges, each
// running from a point out to its elbow, meeting along the crossbar. That is why the limbs widen
// the way they do, and why an elbow has a long outer corner and a short inner one - the corner is
// the mitre between two wedges meeting at an angle, which is worked out here rather than drawn by
// hand. An earlier version swept a bar of constant width along the same zigzag and drew the ends
// out into long spikes; it came out a worm, because that is not what the shape is.
//
// What keeps it a body rather than a sign is its section, which is a diamond: a ridge runs the whole
// length of the stroke, front and back, so face on the bolt is its outline with a crease down the
// middle. That is what a forged thing looks like and what a printed one never does, and it is what
// the far side is made of - from any one side the near ridge is drawn and the far one is covered by
// the body's own thickness, which is Glyph Parallax over a figure this simple.
//
// The zigzag itself lies flat in the plane of its own silhouette, and the two ridges stand off that
// plane by the same amount, so the body is exactly its own mirror image in it. An earlier version
// arched the path through the figure instead - points back, crossbar forward - which made a shape no
// plane could hold; it measured better turned edge on and read worse from everywhere else, because a
// bolt leaning out of its own plane is not the shape anybody means. Symmetry is the shape; the
// relief is the ridge.
//
// Where a real Solar System lands is where a bolt actually sticks out: the two points, and the
// outer corner of each elbow. Four anchors, named rather than searched for, because unlike a
// sculpture a bolt has no extremities anybody has to go looking for.

export type BoltOptions = {
  /** The bolt's own zigzag: a point, the two elbows, the other point. The ends carry no section. */
  path: readonly SolidPoint[];
  /** Corners of the bar's section. Four is a diamond, and the diamond is the ridge. */
  sides: number;
  /** Half-width at an elbow, across the stroke and in the plane the bolt is drawn in. */
  width: number;
  /** Half-depth of the bar, through the figure. This is what the side view is made of. */
  depth: number;
  /** Mark the ridge as a line of the drawing. The stroke's own edges need no marking: they are
   * where the body turns away, so the outline finds them from wherever the observer stands. */
  ridges: boolean;
};

export const BOLT: BoltOptions = {
  // Down from the upper point, back along the crossbar, down again to the lower one: the zigzag
  // everybody draws, flat in the plane of its own silhouette.
  path: [[0.3, 1, 0], [-0.24, 0.02, 0], [0.24, -0.02, 0], [-0.3, -1, 0]],
  sides: 4,
  width: 0.32,
  depth: 0.16,
  ridges: true,
};

/** Three indices into the vertices, which is one triangle. */
type Triple = [number, number, number];

export function buildBolt({ path, sides, width, depth, ridges }: BoltOptions = BOLT) {
  const centres = path;
  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];

  const head = place(vertices, centres[0]);
  const sections = centres.slice(1, -1).map((centre, index) => {
    const heading = headingAt(centres, index + 1);
    const across = widthwise(heading);
    const rise = cross(heading, across);
    // The mitre: a section standing square to the average of two limbs is narrower than the limbs
    // are, by the cosine of half the turn. Opening it back up is what gives an elbow its long outer
    // corner and its short inner one, which is the whole character of the shape. Only the width is
    // opened - the depth is through the figure and the turn does not touch it.
    const mitre = 1 / Math.max(0.2, dot(heading, unit(subtract(centres[index + 2], centre))));
    return Array.from({ length: sides }, (_, corner) => {
      const angle = (2 * Math.PI * corner) / sides;
      return place(vertices, add(centre, add(scale(across, Math.cos(angle) * width * mitre), scale(rise, Math.sin(angle) * depth))));
    });
  });
  const tail = place(vertices, centres[centres.length - 1]);

  for (let index = 0; index + 1 < sections.length; index += 1) {
    const near = sections[index];
    const far = sections[index + 1];
    for (let corner = 0; corner < sides; corner += 1) {
      const next = (corner + 1) % sides;
      // Each four-cornered patch of the bar is split into two triangles, and which way it is split
      // is not free: cut the same way all round and the back of the bolt is triangulated as the
      // front's reflection would never be. The cut always runs from the corner nearer the figure's
      // own plane, which a diamond section makes an exact mirror of itself. (A section with more
      // corners than four has patches with both ends equally far off the plane and promises nothing.)
      const fromRidge = onTheRidge(corner, sides);
      triangles.push(
        fromRidge ? [near[next], far[next], far[corner]] : [near[corner], far[corner], far[next]],
        fromRidge ? [near[next], far[corner], near[corner]] : [near[corner], far[next], near[next]],
      );
      // Only the ridge is marked. The two corners standing on the bar's depth axis run the length of
      // the stroke as a crease an observer sees down the middle of it; the two on its width axis are
      // the edges of the stroke, which the outline already finds for itself, and marking those as
      // well would double every line the figure has.
      if (ridges && onTheRidge(corner, sides)) drawn.push([near[corner], far[corner]]);
    }
  }

  for (const [point, section] of [[head, sections[0]], [tail, sections[sections.length - 1]]] as const) {
    for (let corner = 0; corner < sides; corner += 1) {
      const next = (corner + 1) % sides;
      triangles.push([point, section[corner], section[next]]);
      if (ridges && onTheRidge(corner, sides)) drawn.push([point, section[corner]]);
    }
  }

  // A figure's farthest point goes on the unit sphere, so the bolt is sized by its own reach rather
  // than by the path somebody typed.
  const reach = Math.max(...vertices.map(length));
  const sized = vertices.map((vertex) => scale(vertex, 1 / reach));

  return {
    name: "bolt",
    source: { file: `generated, a ${path.length} point zigzag forged as a ${sides} sided bar` },
    vertices: sized,
    triangles: outward(sized, triangles, centres.map((centre) => scale(centre, 1 / reach))),
    drawn,
    anchors: [head, tail, ...elbows(sized, sections)],
  };
}

// Which way the bar is running where it passes through one centre: the average of the way it
// arrives and the way it leaves, so a section at an elbow is mitred and the surface closes.
function headingAt(centres: readonly SolidPoint[], index: number): SolidPoint {
  const arriving = index > 0 ? unit(subtract(centres[index], centres[index - 1])) : null;
  const leaving = index + 1 < centres.length ? unit(subtract(centres[index + 1], centres[index])) : null;
  if (!arriving) return leaving!;
  if (!leaving) return arriving;
  return unit(add(arriving, leaving));
}

/** The corners the ridge runs along: the ones standing on the bar's depth axis rather than its width. */
function onTheRidge(corner: number, sides: number): boolean {
  return Math.abs(Math.sin((2 * Math.PI * corner) / sides)) > 0.999;
}

// The bar's width lies in the plane the bolt is drawn in, square to the stroke; its depth is what
// is left, which is through the figure. A stroke running straight through the figure would have no
// width direction to be found that way, and takes one rather than collapsing.
function widthwise(heading: SolidPoint): SolidPoint {
  const sideways = cross([0, 0, 1], heading);
  return length(sideways) > 1e-6 ? unit(sideways) : [1, 0, 0];
}

// Wound outward, decided from the body rather than from the order the corners happened to be
// written in: the facing test reads a face by which way it points, so one triangle facing inward
// would leave a hole the far side of the bolt would show through.
function outward(vertices: readonly SolidPoint[], triangles: readonly Triple[], centres: readonly SolidPoint[]): Triple[] {
  return triangles.map(([first, second, third]): Triple => {
    const centre = scale(add(add(vertices[first], vertices[second]), vertices[third]), 1 / 3);
    const normal = cross(subtract(vertices[second], vertices[first]), subtract(vertices[third], vertices[first]));
    return dot(normal, subtract(centre, nearestOnPath(centres, centre))) > 0 ? [first, second, third] : [first, third, second];
  });
}

/** The point on the bolt's own centre line that a point of its surface stands off. */
function nearestOnPath(centres: readonly SolidPoint[], point: SolidPoint): SolidPoint {
  let nearest = centres[0];
  let best = Infinity;
  for (let index = 0; index + 1 < centres.length; index += 1) {
    const span = subtract(centres[index + 1], centres[index]);
    const reach = dot(span, span);
    const along = reach > 0 ? Math.min(1, Math.max(0, dot(subtract(point, centres[index]), span) / reach)) : 0;
    const candidate = mix(centres[index], centres[index + 1], along);
    const gap = length(subtract(point, candidate));
    if (gap < best) [nearest, best] = [candidate, gap];
  }
  return nearest;
}

// The outer corner of each elbow: of the four corners of a section, the one standing farthest from
// the figure's own centre. Every section is an elbow - the ends of the path are points and carry no
// section at all - so this is one anchor apiece.
function elbows(vertices: readonly SolidPoint[], sections: readonly number[][]): number[] {
  return sections.map((section) => section.reduce((farthest, corner) => (length(vertices[corner]) > length(vertices[farthest]) ? corner : farthest), section[0]));
}

function place(vertices: SolidPoint[], point: SolidPoint): number {
  return vertices.push(point) - 1;
}
