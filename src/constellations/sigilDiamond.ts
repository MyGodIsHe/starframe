import type { SolidPoint } from "./glyphSolid";
import { intoFigureSpace } from "./sigilVectors";

// The seventh Sigil Figure this build makes for itself: a diamond, cut as a round brilliant.
//
// A figure is generated here only when a rule describes the subject exactly rather than
// approximately, and a brilliant is the one subject in the library that was a specification before
// it was ever a shape. Nobody sculpted it; it was worked out. A table, eight bezels, eight star
// facets and sixteen upper girdle halves above the girdle, eight pavilion mains and sixteen lower
// halves below it, at proportions a cutter holds to a tenth of a percent: fifty-seven facets, and
// which fifty-seven is not a matter of taste. So every number below is a proportion of the stone's
// own half width, and none of them is a guess at a surface nobody drew.
//
// Only seven numbers are typed in at all. Every facet of a cut stone is flat, and a flat facet
// settles two things the cut never states outright: where the star tips stand, and where one
// pavilion main runs into the next below the girdle. Both are corners where neighbouring facets
// meet, so both are read off the planes of those facets rather than written down. `onFacet` is
// that reading, and it is the difference between a stone and a cone with lines drawn on it.
//
// It is the one convex body in the library, and that is what it is here for. A ring shows its own
// far side through its hole; a gear turned edge on collapses to a bar; a brilliant does neither,
// and carries its whole drawing on its near side instead. What changes as a pilot travels is which
// of its creases face them and where its outline cuts across the girdle. Its symmetry is eight
// fold, so it holds up as the same stone from every bearing - which is the honest view of a thing
// that was cut to be looked at from anywhere.

export type DiamondOptions = {
  /** How many bezels stand round the crown. A brilliant's whole symmetry is this one count. */
  mains: number;
  /** The flat top the stone is read by, as a fraction of its own half width. */
  table: number;
  /** How far the crown stands above the girdle. */
  crown: number;
  /** How far the pavilion runs below the girdle, down to the culet. */
  pavilion: number;
  /** Half the thickness of the girdle band, the widest circle of the stone. */
  girdle: number;
  /** How far the star facets reach from the table's rim out towards the girdle. */
  star: number;
  /** How far the lower girdle halves reach from the girdle down towards the culet. */
  lower: number;
};

// A standard round brilliant, written as fractions of the stone's half width rather than of its
// diameter: a table 56 percent of the width across, a crown 16 percent of it high, a pavilion 43
// percent deep and a girdle 3 percent thick. The two facet lengths are the cutter's own - star
// facets a little over half the way from the table to the girdle, lower halves three quarters of
// the way from the girdle to the culet - and they are the only places the proportions leave room
// for an opinion.
export const DIAMOND: DiamondOptions = { mains: 8, table: 0.56, crown: 0.32, pavilion: 0.86, girdle: 0.03, star: 0.55, lower: 0.77 };

/** A point of the stone in the half plane a facet is symmetric about: how far out, and how high. */
export type Section = { radius: number; height: number };

// Where a facet stands at a given radius, a given angle off its own middle.
//
// A facet is mirror symmetric about the bezel it belongs to, so the plane it lies in is fixed by
// the two sections it runs between - the table's corner and the girdle under it, or the girdle and
// the culet. A corner shared with the neighbouring facet stands half a pitch off that middle, and
// the plane then says how high it is. Turning off the middle shortens the reach across the plane,
// which is why a star tip sits higher than the same radius would on the bezel's own section, and a
// pavilion junction sits lower.
export function onFacet(from: Section, to: Section, radius: number, offset: number): Section {
  const fall = from.height - to.height;
  const run = to.radius - from.radius;
  const plane = fall * from.radius + run * from.height;

  return { radius, height: (plane - radius * Math.cos(offset) * fall) / run };
}

/** Three indices into the vertices, which is one triangle. */
type Triple = [number, number, number];

export function buildDiamond(options: DiamondOptions = DIAMOND) {
  const { mains, table, crown, pavilion, girdle, star, lower } = options;
  // The girdle carries two corners per bezel - the one under the bezel itself and the one between
  // it and the next - so the stone is widest on a circle of twice the count everything else runs at.
  const round = 2 * mains;

  const tableAt: Section = { radius: table, height: girdle + crown };
  const rimAt: Section = { radius: 1, height: girdle };
  const keelAt: Section = { radius: 1, height: -girdle };
  const culetAt: Section = { radius: 0, height: -(girdle + pavilion) };
  // The two corners the cut gives a length for but no height: where one bezel runs into the next,
  // and where one pavilion main runs into the next. Each is read off the flat facet it has to lie in.
  const starAt = onFacet(tableAt, rimAt, table + star * (1 - table), Math.PI / mains);
  const junctionAt = onFacet(keelAt, culetAt, 1 - lower, Math.PI / mains);

  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];

  // The stone stands on its own upright, so a section's height runs up the figure's y and its
  // radius is swept round that: the girdle lies in the plane of depth, and the table is up.
  const place = (section: Section, angle: number): number =>
    vertices.push([section.radius * Math.cos(angle), section.height, section.radius * Math.sin(angle)]) - 1;
  const ring = (section: Section, count: number, from: number): number[] =>
    Array.from({ length: count }, (_, step) => place(section, (2 * Math.PI * (step + from)) / count));

  const tableRing = ring(tableAt, mains, 0);
  const starRing = ring(starAt, mains, 0.5);
  const rimRing = ring(rimAt, round, 0);
  const keelRing = ring(keelAt, round, 0);
  const junctionRing = ring(junctionAt, mains, 0.5);
  const culet = place(culetAt, 0);

  const atMain = (index: number): number => ((index % mains) + mains) % mains;
  const atRound = (index: number): number => ((index % round) + round) % round;

  // The table: the one flat the whole stone is read by, fanned from its first corner because a flat
  // polygon needs no point in its middle. Its rim is a line of the drawing and the spokes of the
  // fan are not - they lie inside a facet, and a line inside a facet is not a line of anything.
  for (let corner = 1; corner + 1 < mains; corner += 1) triangles.push([tableRing[0], tableRing[corner + 1], tableRing[corner]]);

  for (let main = 0; main < mains; main += 1) {
    const next = atMain(main + 1);
    const back = atMain(main - 1);
    const under = 2 * main;

    // The star facet: between two corners of the table and the tip that reaches out between them.
    triangles.push([tableRing[main], tableRing[next], starRing[main]]);
    // The bezel: the kite that carries the crown from a table corner down to the girdle under it,
    // with a star tip to each side. Both halves lie in the one plane the tips were read off.
    triangles.push([tableRing[main], starRing[main], rimRing[under]], [tableRing[main], rimRing[under], starRing[back]]);
    // The two upper girdle halves filling the gap one bezel leaves against the next.
    triangles.push(
      [starRing[main], rimRing[atRound(under + 1)], rimRing[under]],
      [starRing[main], rimRing[atRound(under + 2)], rimRing[atRound(under + 1)]],
    );
    // The pavilion is the crown again with the table collapsed to a point: the main is the same
    // kite upside down, meeting its neighbours at the junctions and all of them at the culet.
    triangles.push([keelRing[under], junctionRing[main], culet], [keelRing[under], culet, junctionRing[back]]);
    triangles.push(
      [junctionRing[main], keelRing[under], keelRing[atRound(under + 1)]],
      [junctionRing[main], keelRing[atRound(under + 1)], keelRing[atRound(under + 2)]],
    );

    // What is marked is the eight fold skeleton: the table, the facets that run the whole way from
    // it to the girdle, and the ones that run from the girdle to the culet. The sixteen girdle
    // halves split each of those runs again, and at the size a Constellation Glyph is read at that
    // many lines crowded into one band close into a smudge - a brilliant is recognised by its
    // symmetry rather than by its facet count. They are still surface: they occlude, and they still
    // decide where the outline falls.
    drawn.push([tableRing[main], tableRing[next]]);
    drawn.push([tableRing[main], starRing[main]], [starRing[main], tableRing[next]]);
    drawn.push([starRing[main], rimRing[under]], [starRing[main], rimRing[atRound(under + 2)]]);
    drawn.push([junctionRing[main], keelRing[under]], [junctionRing[main], keelRing[atRound(under + 2)]]);
    drawn.push([junctionRing[main], culet]);
  }

  // The girdle band, which is where the crown ends and the pavilion starts. It is marked once, on
  // the rim the crown runs down to: the band is three percent of the stone across and its lower rim
  // stands a hair under its upper one, so marking both would draw the same line twice.
  for (let facet = 0; facet < round; facet += 1) {
    const next = atRound(facet + 1);
    triangles.push([rimRing[facet], rimRing[next], keelRing[next]], [rimRing[facet], keelRing[next], keelRing[facet]]);
    drawn.push([rimRing[facet], rimRing[next]]);
  }

  return {
    name: "diamond",
    source: { file: `generated, a round brilliant of ${1 + 7 * mains} facets on a girdle cut into ${round}` },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    anchors: anchorCorners(options, tableRing, rimRing, culet),
  };
}

// Where a real Solar System is meant to land. A brilliant sticks out in three ways - the culet it
// comes to a point at, the girdle it is widest at, and the rim of the table it is flat on top of -
// and the three of them are the corners of its own silhouette.
//
// Taken across the stone rather than round it. The girdle is a circle standing in the figure's own
// plane of depth, so two of its corners a quarter turn apart are one point once the figure is seen
// flat, and two anchors on one point are one anchor. The pairs that survive that are the ones the
// turn separates: the table corner and the girdle corner on each side, with the culet under them.
function anchorCorners(
  { mains }: DiamondOptions,
  tableRing: readonly number[],
  rimRing: readonly number[],
  culet: number,
): number[] {
  return [culet, rimRing[0], rimRing[mains], tableRing[0], tableRing[Math.round(mains / 2)]];
}
