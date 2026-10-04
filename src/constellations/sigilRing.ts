// The one Sigil Figure this build makes for itself.
//
// Every other sculpted body is somebody else's model, which is why none is committed - see
// `sigilModel`. A ring needs nobody's sculpture: it is two radii and two counts, and a torus is the
// one subject a rule describes exactly rather than approximately. So it is generated here, at the
// proportions a sigil wants, and then goes through the same door an imported model does.
//
// It is also the figure that proves the body is a body. A ring has a hole, so an observer sees the
// far side of it through its own middle until the body covers it; it is deeply concave, so the
// facing test alone would draw straight through it; and turned edge on it collapses to a bar, which
// is the honest view of a thing with volume and exactly what Glyph Parallax promises.
//
// Deliberately coarse. The facing test runs over every face of every glyph on the sky, and a ring
// read as a sigil is a handful of confident lines rather than a smooth doughnut: the facets are the
// drawing.
//
// The tube itself is the one piece another generated figure reuses: `sigilAtom` builds its electron
// shells out of the same `ringShell`, so a shell cannot drift from the figure the ring tests pin.

export type RingOptions = {
  /** Segments around the ring. Each one is a facet of the outline. */
  around: number;
  /** Segments around the tube. Each one is a rail running the whole way round. */
  through: number;
  /** Tube radius, with the ring's outer edge on the unit sphere. */
  thickness: number;
  /** Rails that are part of the drawing: every nth one, counted around the tube. */
  railStep: number;
};

export const RING: RingOptions = { around: 12, through: 6, thickness: 0.26, railStep: 3 };

/** A closed tube lying in the x-y plane, turning about z, with its outer edge at radius 1. */
export type RingShell = {
  vertices: [number, number, number][];
  triangles: [number, number, number][];
  drawn: [number, number][];
  /** The vertices on the outer edge, in order round the ring: where the shell reaches farthest. */
  rim: number[];
};

export function ringShell({ around, through, thickness, railStep }: RingOptions = RING): RingShell {
  const minor = thickness;
  // The far edge of the tube lands on the unit sphere, where a Sigil Figure's farthest point goes.
  const major = 1 - minor;

  const vertices: [number, number, number][] = [];
  for (let step = 0; step < around; step += 1) {
    const angle = (2 * Math.PI * step) / around;
    for (let turn = 0; turn < through; turn += 1) {
      const sweep = (2 * Math.PI * turn) / through;
      const radius = major + minor * Math.cos(sweep);
      vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), minor * Math.sin(sweep)]);
    }
  }

  const at = (step: number, turn: number): number => ((step % around) + around) % around * through + (((turn % through) + through) % through);
  const triangles: [number, number, number][] = [];
  const drawn: [number, number][] = [];

  for (let step = 0; step < around; step += 1) {
    for (let turn = 0; turn < through; turn += 1) {
      const corner = at(step, turn);
      const next = at(step + 1, turn);
      const across = at(step + 1, turn + 1);
      const over = at(step, turn + 1);
      // Wound so every outward normal points away from the tube's own centre line.
      triangles.push([corner, next, across], [corner, across, over]);
      // A rail runs the whole way round the ring and is a line of the drawing; the circle round the
      // tube and the diagonal splitting each facet only hold the surface together. The outline is
      // never marked - it is found from wherever the observer happens to be standing.
      if (turn % railStep === 0) drawn.push([corner, next]);
    }
  }

  return { vertices, triangles, drawn, rim: Array.from({ length: around }, (_, step) => at(step, 0)) };
}

export function buildRing(options: RingOptions = RING) {
  const shell = ringShell(options);

  return {
    name: "ring",
    source: { file: `generated, ${options.around} by ${options.through} segments` },
    vertices: shell.vertices,
    triangles: shell.triangles,
    drawn: shell.drawn,
    anchors: anchorsAround(options.around, options.through),
  };
}

// Where a real Solar System is meant to land: points on the ring's outer edge, spread as evenly
// round it as its own facets allow. An imported model has its extremities searched for, because
// nobody knows where a sculpture sticks out; a ring sticks out everywhere, so the only thing to get
// right is that the anchors are not bunched.
const ANCHOR_COUNT = 5;

function anchorsAround(around: number, through: number): number[] {
  const spread = Array.from({ length: Math.min(ANCHOR_COUNT, around) }, (_, index) => Math.round((index * around) / Math.min(ANCHOR_COUNT, around)) % around);
  return [...new Set(spread)].map((step) => step * through);
}
