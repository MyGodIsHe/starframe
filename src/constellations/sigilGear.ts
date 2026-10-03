import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

// The sixth Sigil Figure this build makes for itself: a gear.
//
// A figure is generated here only when a rule describes the subject exactly rather than
// approximately - that is why the rest of the library is sculpted models, and why a torus was the
// first thing in it. A spur gear passes the same test, and passes it more plainly than anything
// else here: it is a count of teeth and a handful of radii. A tooth is not a shape somebody draws,
// it is one shape repeated round the pitch an exact number of times, and that is the whole
// character of the thing - a gear with teeth of unequal width is not a stylised gear, it is a
// broken one. So every number below is a proportion of the figure, and none of them is a guess at
// a surface nobody drew.
//
// It is a plate rather than a disc: bored through its middle, because a gear turns on something.
// The bore is also what makes it worth having in the library beside the ring. An observer sees the
// far rim of the hole through the near one until the plate covers it, and turned edge on the whole
// figure collapses to a bar with notches cut in its ends, which is the honest view of a thing that
// is wide and thin and exactly what Glyph Parallax promises.
//
// The teeth are few and square shouldered rather than involute flanked: the facing test runs over
// every face of every glyph on the sky, and a gear read as a sigil is a shape recognised at a
// glance from a long way off. Eight teeth is what somebody draws when they draw a gear. Thirty, at
// the size a Constellation Glyph is seen at, is a circle with a rough edge.
//
// What is marked as the drawing is the rim of each face, the rim of the bore in each, and the corner
// of every tooth carried across the plate's thickness. Those cross-plate corners are what leave a
// narrow view enough structure to read as a gear; the body's own occlusion hides their far copies.
// Every remaining edge only triangulates a flat wall and was never part of the drawing.
//
// Where a real Solar System lands is where a gear sticks out: the tips of its teeth. Every tip
// stands twice, once on each face a thickness apart, and a pair that close would be two anchors on
// the same spot; so the anchors are taken from every other tooth, and the face they stand on
// alternates round the figure.

export type GearOptions = {
  /** How many teeth stand round the plate. The figure's whole character is that they are equal. */
  teeth: number;
  /** Where the gap between two teeth reaches in to, with the tips of the teeth at radius 1. */
  root: number;
  /** Radius of the bore through the middle. */
  bore: number;
  /** Half the plate's thickness. */
  thickness: number;
  /** How much of one tooth's pitch the flat of its tip takes. */
  land: number;
  /** How much of that pitch each of the tooth's two flanks leans across. */
  flank: number;
};

// A tooth takes a little under a third of its pitch at the tip and leans out of the root over an
// eighth of it on each side, which leaves the gap between two teeth a shade wider than a tooth is:
// the proportions of something cut rather than something cast.
export const GEAR: GearOptions = { teeth: 8, root: 0.74, bore: 0.3, thickness: 0.2, land: 0.3, flank: 0.14 };

/** One corner of the toothed outline: where it stands round the gear, and how far out it reaches. */
export type GearCorner = { angle: number; radius: number };

/** How many corners of the outline one tooth owns: out of the root, across the tip, and back in. */
export const CORNERS_PER_TOOTH = 4;

// The toothed outline, walked counter-clockwise round the plate. Each tooth is written about its
// own centre, so the teeth are equal by construction rather than by arithmetic that could drift
// round the last of them, and the root between two teeth is the chord joining them: at this few
// teeth the sag of that chord is a fraction of the width of a stroke, and a facet is the drawing
// anyway.
export function gearProfile({ teeth, root, land, flank }: GearOptions = GEAR): GearCorner[] {
  const pitch = (2 * Math.PI) / teeth;

  return Array.from({ length: teeth }, (_, tooth) => {
    const centre = pitch * tooth;
    return [
      { angle: centre - pitch * (land / 2 + flank), radius: root },
      { angle: centre - pitch * (land / 2), radius: 1 },
      { angle: centre + pitch * (land / 2), radius: 1 },
      { angle: centre + pitch * (land / 2 + flank), radius: root },
    ];
  }).flat();
}

/** Three indices into the vertices, which is one triangle. */
type Triple = [number, number, number];

/** Anchors are taken from this many teeth, spread as evenly round the gear as its teeth allow. */
const ANCHOR_COUNT = 4;

/** Of a tooth's four corners, the one its anchor stands on: the leading corner of the tip. */
const TIP_CORNER = 1;

export function buildGear(options: GearOptions = GEAR) {
  const { bore, thickness } = options;
  const profile = gearProfile(options);
  const corners = profile.length;

  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];

  const place = (point: SolidPoint): number => vertices.push(point) - 1;
  // The four rings the whole body is made of: the toothed rim and the bore, each on both faces. The
  // bore carries a point for every corner of the rim rather than a count of its own, so the flat of
  // a face joins rim to bore point for point and nothing has to be triangulated against a circle.
  // Its points are unevenly spread round it, because the rim's are; every one of them is still
  // exactly the bore's radius out, so the hole is a circle rather than an approximation of one.
  const ring = (radiusAt: (corner: GearCorner) => number, height: number): number[] =>
    profile.map((corner) => place([radiusAt(corner) * Math.cos(corner.angle), radiusAt(corner) * Math.sin(corner.angle), height]));

  const rimNear = ring((corner) => corner.radius, thickness);
  const rimFar = ring((corner) => corner.radius, -thickness);
  const boreNear = ring(() => bore, thickness);
  const boreFar = ring(() => bore, -thickness);

  for (let step = 0; step < corners; step += 1) {
    const next = (step + 1) % corners;

    // The flat of the near face, wound counter-clockwise seen from in front of it - and the far
    // face, which is the near one written backwards, as the far face of a slab always is.
    triangles.push([rimNear[step], rimNear[next], boreNear[next]], [rimNear[step], boreNear[next], boreNear[step]]);
    triangles.push([rimFar[step], boreFar[next], rimFar[next]], [rimFar[step], boreFar[step], boreFar[next]]);
    // The toothed wall standing on the rim, facing away from the axis the gear turns about.
    triangles.push([rimNear[step], rimFar[step], rimFar[next]], [rimNear[step], rimFar[next], rimNear[next]]);
    // And the wall of the bore, walked the other way so it faces into the hole, which is the
    // plate's own outside read from inside it.
    triangles.push([boreNear[step], boreFar[next], boreFar[step]], [boreNear[step], boreNear[next], boreFar[next]]);

    drawn.push(
      [rimNear[step], rimNear[next]],
      [rimFar[step], rimFar[next]],
      [boreNear[step], boreNear[next]],
      [boreFar[step], boreFar[next]],
      [rimNear[step], rimFar[step]],
    );
  }

  return {
    name: "gear",
    source: { file: `generated, a ${options.teeth} toothed plate bored through its middle` },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    anchors: anchorTips(options, rimNear, rimFar),
  };
}

// The tips a real Solar System is meant to land on. A gear sticks out in one way only, so the one
// thing to get right is that the anchors are neither bunched nor paired across the thickness: every
// other tooth, taking the near face and the far face by turns.
function anchorTips({ teeth }: GearOptions, rimNear: readonly number[], rimFar: readonly number[]): number[] {
  const spread = Math.min(ANCHOR_COUNT, teeth);

  return Array.from({ length: spread }, (_, index) => {
    const tooth = Math.round((index * teeth) / spread) % teeth;
    return (index % 2 === 0 ? rimNear : rimFar)[tooth * CORNERS_PER_TOOTH + TIP_CORNER];
  });
}
