import type { SolidPoint } from "./glyphSolid";
import { add, cross, intoFigureSpace, length, scale, subtract, unit } from "./sigilVectors";

// The fifth Sigil Figure this build makes for itself: a wedge of cheese.
//
// A figure is generated here only when a rule describes the subject exactly rather than
// approximately - that is why the rest of the library is sculpted models. A wedge passes that test
// twice over. Its outline is a circular sector, which is a radius and an angle and nothing else;
// and what makes it cheese rather than a slice of anything is the holes, which are bubbles exposed
// by the two side cuts. No number below is a guess at a surface nobody drew.
//
// It lies on one broad face rather than on its point. The broad faces stay whole; each side cut
// exposes three bubbles as shallow pockets, so turning the figure reveals different holes instead
// of the same regular pattern stamped through its top and bottom.
//
// The sector is a narrow one, an eighth of a turn, because that is the slice somebody cuts rather
// than the quarter a diagram draws. Each side carries three differently sized holes. Their radial
// positions differ from one side to the other, deliberately breaking the symmetry of a manufactured
// pattern while leaving enough cheese between every pair and round every lip.
//
// Every hole is cut the same way, and how is the only part worth explaining. Each face of the slice
// is a lattice in its own coordinates - rings out from the apex and columns across the spread on
// the two flat faces, rings by thickness on the two cuts - and a hole takes a rectangular block of
// its cells. A block of m by n cells has 2(m + n) points round it, and the hole is cut as a ring of
// exactly that many corners, each standing in the direction of the block point it answers to: the
// block becomes a ring of material joining the lattice to the hole point for point, nothing has to
// be triangulated against a circle, and no edge is left half-matched to its neighbour. The points
// in the middle of a block are where the hole is, and are never made at all. Two neighbours share
// the lattice between them, so a band of holes is one web of material rather than a row of patches.
//
// A hole in a cut cannot go through: the two cuts lean towards each other, so a bore square to one
// of them would leave through the other. Each hole therefore closes on a shallow cone a little under
// the surface. It is as much a closed body as the rest, and reads as half of a bubble from any angle.
//
// What is marked as the drawing is the rim of each face, the rim of every hole, and the three real
// corners of the wedge carried through its thickness. Those corners keep the apex and the ends of
// the rind readable from a narrow view; the body's own occlusion hides their far copies. Nothing is
// marked down a bore, into a pocket or along an intermediate site of the surface lattice.
//
// Where a real Solar System lands is where the slice reaches farthest: the apex, and the three
// points of the arc - its two ends and its middle. Each of those stands on both faces, a thickness
// apart, and a pair that close would be two anchors on the same spot; so each extremity gives up
// one of its two faces, and which one it gives up alternates round the figure.

/** One hole bored through both faces, as the block of the lattice it is cut out of. */
export type CheeseHole = {
  /** The inner of the two rings its block spans. */
  ring: number;
  /** The first of the columns its block spans. */
  column: number;
  /** How many columns of the lattice the block takes: how much of the wedge's width the hole has. */
  columns: number;
};

/** One bubble exposed by either radial side cut. */
export type CheesePocket = {
  side: "left" | "right";
  /** The first radial cell occupied by the pocket, counted out from the apex. */
  ring: number;
  /** How many radial cells provide the material around its mouth. */
  rings: number;
  /** The first thickness cell occupied by the pocket. */
  level: number;
  /** How many thickness cells provide the material around its mouth. */
  levels: number;
  /** How much of that block the circular mouth occupies. */
  bore: number;
};

export type CheeseOptions = {
  /** Half the sector's angle, so the slice is symmetric about its own middle. */
  spread: number;
  /** Half the slice's thickness, as a fraction of its radius. */
  thickness: number;
  /** Where each ring of the lattice stands, out from the apex at zero to the arc at one. */
  rings: readonly number[];
  /** How many columns the spread is cut into. Even, so a band can hold a hole on its own middle. */
  columns: number;
  holes: readonly CheeseHole[];
  /** The shallow holes exposed on the two radial side cuts. */
  pockets: readonly CheesePocket[];
  /** How much of the room its own block leaves it a hole takes up. */
  bore: number;
  /** How deep a pocket goes, as a fraction of its own width. */
  dimple: number;
};

export const CHEESE: CheeseOptions = {
  spread: Math.PI / 8,
  thickness: 0.26,
  // Coarse on purpose, like the ring: the facing test runs over every face of every glyph on the
  // sky. The radial lattice gives three separate pockets room on each side while retaining material
  // between their lips and at the apex and rind.
  rings: [0, 0.0667, 0.1333, 0.2, 0.2667, 0.3333, 0.4, 0.4667, 0.5333, 0.6, 0.6667, 0.7333, 0.8, 0.8667, 0.9333, 1],
  columns: 2,
  holes: [],
  pockets: [
    { side: "left", ring: 0, rings: 4, level: 0, levels: 2, bore: 0.56 },
    { side: "left", ring: 5, rings: 4, level: 2, levels: 2, bore: 0.78 },
    { side: "left", ring: 10, rings: 4, level: 1, levels: 2, bore: 0.66 },
    { side: "right", ring: 1, rings: 4, level: 2, levels: 2, bore: 0.72 },
    { side: "right", ring: 6, rings: 4, level: 0, levels: 2, bore: 0.58 },
    { side: "right", ring: 11, rings: 4, level: 1, levels: 2, bore: 0.82 },
  ],
  bore: 0.6,
  dimple: 0.6,
};

/** A hole, in the plane of the face it is cut in. */
export type CheeseHollow = {
  /** Where its mouth stands, in the slice's own frame. */
  centre: SolidPoint;
  /** The corners of the mouth, counter-clockwise seen from outside that face. */
  rim: readonly SolidPoint[];
  /** Straight into the material from the mouth: the way the hole was bored. */
  into: SolidPoint;
  /** How far in it goes before it closes, or null when it is bored right through. */
  depth: number | null;
};

/** One point of the lattice: a ring and a column of a face, at one of the levels of the thickness. */
type Site = { ring: number; column: number; level: number };

/** Three indices into the vertices, which is one triangle. */
type Triple = [number, number, number];

/** How many cells the thickness is cut into, so a pocket has a block to be cut out of. */
export const LEVELS = 4;

/** How many rings of the lattice a hole through a face spans. */
export const HOLE_RINGS = 2;

export function buildCheese(options: CheeseOptions = CHEESE) {
  const { rings, columns, holes, dimple } = options;
  const outermost = rings.length - 1;
  const rim = rimOf(options);
  const hollows = hollowsOf(options);

  const vertices: SolidPoint[] = [];
  const triangles: Triple[] = [];
  const drawn: [number, number][] = [];
  const lattice = new Map<string, number>();

  // Laid on its side on the way in. Everything below is written in the slice's own frame - the
  // sector in x and y, the thickness in z, which is how anybody writing down a sector would have it
  // - and turned a quarter about x as it is placed, so the figure stands on a face and its holes
  // run up the figure's own upright. A quarter turn is a turn and not a mirror, so every winding
  // below survives it and the facing test still reads the body the way it was wound.
  const place = (point: SolidPoint): number => vertices.push([point[0], -point[2], point[1]]) - 1;

  // A lattice point is made where it is first used, so the points in the middle of a block - which
  // is where the hole is - are never made at all. Every ring but the first carries a point per
  // column; the first is the apex, and every column shares it.
  const at = (site: Site): number => {
    const key = `${site.ring} ${site.ring === 0 ? 0 : site.column} ${site.level}`;
    const held = lattice.get(key);
    if (held !== undefined) return held;

    const made = place(sitePoint(options, site));
    lattice.set(key, made);
    return made;
  };

  // One triangle of a flat face, wound so it faces out of the side it is on: the far face of a slab
  // is the near face written backwards.
  const facet = (level: number, [first, second, third]: Triple): void => {
    triangles.push(level === 0 ? [first, second, third] : [first, third, second]);
  };

  // The ring of material joining a block of the lattice to the hole cut out of it, point for point.
  const ribbon = (block: readonly number[], mouth: readonly number[], push: (triple: Triple) => void): void => {
    for (let step = 0; step < mouth.length; step += 1) {
      const next = (step + 1) % mouth.length;
      push([block[step], block[next], mouth[next]]);
      push([block[step], mouth[next], mouth[step]]);
      drawn.push([mouth[step], mouth[next]]);
    }
  };

  // Each flat face: the fan the apex stands in, where a ring of cells would have no inner edge to
  // stand on, and then every cell no hole took.
  for (const level of [0, LEVELS]) {
    for (let column = 0; column < columns; column += 1) {
      facet(level, [at({ ring: 0, column, level }), at({ ring: 1, column, level }), at({ ring: 1, column: column + 1, level })]);
    }
    for (let ring = 1; ring < outermost; ring += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (holes.some((hole) => ring >= hole.ring && ring < hole.ring + HOLE_RINGS && column >= hole.column && column < hole.column + hole.columns)) continue;
        const corner = (step: number, across: number): number => at({ ring: ring + step, column: column + across, level });
        facet(level, [corner(1, 0), corner(1, 1), corner(0, 1)]);
        facet(level, [corner(1, 0), corner(0, 1), corner(0, 0)]);
      }
    }
  }

  // Every hole, as the mouth it opens in the face it is cut in and the ring of material round it.
  const mouths = hollows.map((hollow) => {
    const around = hollow.around.map((site) => sitePoint(options, site));
    const centre = sitePoint(options, hollow.middle);
    const cut = cutOut(around, centre, hollow.opening);
    const mouth = cut.rim.map(place);

    ribbon(hollow.around.map(at), mouth, (triple) => triangles.push(triple));
    return { hollow, mouth, centre, size: cut.size, into: scale(outwardOf(around, centre), -1) };
  });

  // The wall of a hole bored through: the two mouths joined into a tube, walked backwards so it
  // faces into the hole, which is the slice's own outside read from inside.
  for (const hole of holes.keys()) {
    const [near, far] = mouths.filter((mouth) => mouth.hollow.bore === hole);
    // The far mouth was walked the other way round, so a corner of one meets its own on the other
    // counted backwards.
    const tube = near.mouth.map((index, step): [number, number] => [index, far.mouth[far.mouth.length - 1 - step]]).reverse();
    for (let step = 0; step < tube.length; step += 1) {
      const [nearTop, nearBottom] = tube[step];
      const [farTop, farBottom] = tube[(step + 1) % tube.length];
      triangles.push([nearTop, farBottom, farTop], [nearTop, nearBottom, farBottom]);
    }
  }

  // And the bottom of a pocket: a shallow cone a little under the cut, which is what is left of a
  // bubble the knife went through.
  for (const pocket of mouths.filter((mouth) => mouth.hollow.steps.length > 0)) {
    const apex = place(add(pocket.centre, scale(pocket.into, dimple * pocket.size)));
    for (let step = 0; step < pocket.mouth.length; step += 1) {
      triangles.push([pocket.mouth[step], pocket.mouth[(step + 1) % pocket.mouth.length], apex]);
    }
  }

  // The skin standing on the rim: the two cuts and the rind, as a lattice of their own so a pocket
  // has a block to be cut out of. It is walked counter-clockwise as the near face sees it, which is
  // what makes it face away from the body.
  const taken = new Set(hollows.flatMap((hollow) => hollow.steps.map(({ step, level }) => `${step} ${level}`)));
  for (let step = 0; step < rim.length; step += 1) {
    const near = (level: number): number => at({ ...rim[step], level });
    const far = (level: number): number => at({ ...rim[(step + 1) % rim.length], level });

    for (let level = 0; level < LEVELS; level += 1) {
      if (!taken.has(`${step} ${level}`)) {
        triangles.push([near(level), far(level + 1), far(level)], [near(level), near(level + 1), far(level + 1)]);
      }
    }
    // The rim of a face is a line of the figure whether a pocket took the skin behind it or not:
    // where a pocket did, the same edge is the lip of its own block.
    drawn.push([near(0), far(0)], [near(LEVELS), far(LEVELS)]);
  }

  // The surface lattice has many rails through the thickness, but only these three are corners of
  // the subject rather than construction lines: the apex and the two ends of the rind.
  for (const corner of [
    { ring: 0, column: 0 },
    { ring: outermost, column: 0 },
    { ring: outermost, column: columns },
  ]) {
    for (let level = 0; level < LEVELS; level += 1) {
      drawn.push([at({ ...corner, level }), at({ ...corner, level: level + 1 })]);
    }
  }

  return {
    name: "cheese",
    source: { file: `generated, a ${Math.round((360 * options.spread) / Math.PI)} degree sector with ${hollows.length - holes.length} holes in it` },
    vertices: intoFigureSpace(vertices),
    triangles,
    drawn,
    // Round the figure from the apex, taking the near face and the far face by turns.
    anchors: [
      at({ ring: 0, column: 0, level: 0 }),
      at({ ring: outermost, column: 0, level: LEVELS }),
      at({ ring: outermost, column: columns / 2, level: 0 }),
      at({ ring: outermost, column: columns, level: LEVELS }),
    ],
  };
}

// Where the holes stand, how big they are and which way they were bored, in the slice's own frame.
// Worked out from the lattice rather than written down, so retuning the rings cannot leave a hole
// hanging outside the block it belongs to - and exported because what this body is really made of
// is its holes, which is a thing a test should be able to ask about without counting vertices.
export function cheeseHollows(options: CheeseOptions = CHEESE): CheeseHollow[] {
  return hollowsOf(options).map((hollow) => {
    const around = hollow.around.map((site) => sitePoint(options, site));
    const centre = sitePoint(options, hollow.middle);
    const cut = cutOut(around, centre, hollow.opening);

    return {
      centre,
      rim: cut.rim,
      into: scale(outwardOf(around, centre), -1),
      depth: hollow.steps.length > 0 ? options.dimple * cut.size : null,
    };
  });
}

// Where a column of the lattice stands. The sector is symmetric about its own middle, so the middle
// column points straight along it and its two edges lean the same way out of it.
export function angleAt({ spread, columns }: CheeseOptions, column: number): number {
  return Math.PI / 2 - spread + (2 * spread * column) / columns;
}

/** Where a point of the lattice stands, in the slice's own frame. */
export function sitePoint(options: CheeseOptions, { ring, column, level }: Site): SolidPoint {
  const angle = angleAt(options, column);
  const radius = options.rings[ring];

  return [radius * Math.cos(angle), radius * Math.sin(angle), options.thickness * (1 - (2 * level) / LEVELS)];
}

// The rim of a face, walked counter-clockwise across it: out along one cut from the apex, round the
// rind, and back in along the other. It is both the loop the skin stands on and, read as rings, the
// run a pocket is cut into.
export function rimOf({ rings, columns }: CheeseOptions): { ring: number; column: number }[] {
  const outermost = rings.length - 1;

  return [
    ...rings.map((_, ring) => ({ ring, column: 0 })),
    ...Array.from({ length: columns }, (_, step) => ({ ring: outermost, column: step + 1 })),
    ...Array.from({ length: outermost - 1 }, (_, step) => ({ ring: outermost - 1 - step, column: columns })),
  ];
}

/** A hole, as the block of lattice it is cut out of. */
type Block = {
  around: Site[];
  middle: Site;
  /** The cells of the rim skin the block takes out; empty for a hole through a face. */
  steps: readonly { step: number; level: number }[];
  /** The hole whose two mouths this is one of, or null for a pocket, which has only one. */
  bore: number | null;
  /** How much of the surrounding lattice block the mouth occupies. */
  opening: number;
};

function hollowsOf(options: CheeseOptions): Block[] {
  const { columns, holes, pockets } = options;
  const rim = rimOf(options);
  const positionOf = (ring: number, column: number): number => rim.findIndex((site) => site.ring === ring && site.column === column);

  // A hole through a face takes two rings of the lattice and as much of the width as it was given,
  // and is cut in both faces at once: one bore, two mouths. Every block is walked counter-clockwise
  // seen from outside the face it lies in, which is the other way round on the far face - so a
  // block carries its own sense of out, and the ring of material cut from it needs no second rule.
  const bores = holes.flatMap((hole, index) => [0, LEVELS].map((level): Block => {
    const walk = level === 0 ? blockWalk(HOLE_RINGS, hole.columns) : blockWalk(HOLE_RINGS, hole.columns).reverse();

    return {
      around: walk.map(([ring, column]) => ({ ring: hole.ring + ring, column: hole.column + column, level })),
      middle: { ring: hole.ring + HOLE_RINGS / 2, column: hole.column + hole.columns / 2, level },
      steps: [],
      bore: index,
      opening: options.bore,
    };
  }));

  // A pocket takes a rectangular patch of one radial side. Each side chooses its own horizontal and
  // vertical positions and sizes, so the six holes form an irregular natural pattern rather than rows.
  const sidePockets = pockets.map((pocket): Block => {
    const start = pocket.side === "left"
      ? positionOf(pocket.ring, 0)
      : positionOf(pocket.ring + pocket.rings, columns);

    return {
      around: blockWalk(pocket.rings, pocket.levels).map(([step, level]) => ({
        ...rim[(start + step) % rim.length],
        level: LEVELS - pocket.level - level,
      })),
      middle: {
        ...rim[(start + pocket.rings / 2) % rim.length],
        level: LEVELS - pocket.level - pocket.levels / 2,
      },
      steps: Array.from({ length: pocket.rings }, (_, step) => step).flatMap((step) =>
        Array.from({ length: pocket.levels }, (_, level) => ({
          step: (start + step) % rim.length,
          level: LEVELS - pocket.level - level - 1,
        }))),
      bore: null,
      opening: pocket.bore,
    };
  });

  return [...bores, ...sidePockets];
}

// The points round a block of cells, counter-clockwise from its first corner: along the far edge,
// back down the far side, along the near edge, and up again. A block of m by n cells has 2(m + n)
// of them, which is how many corners the hole cut out of it is given.
function blockWalk(across: number, along: number): [number, number][] {
  return [
    ...Array.from({ length: along }, (_, step): [number, number] => [across, step]),
    ...Array.from({ length: across }, (_, step): [number, number] => [across - step, along]),
    ...Array.from({ length: along }, (_, step): [number, number] => [0, along - step]),
    ...Array.from({ length: across }, (_, step): [number, number] => [step, 0]),
  ];
}

// The hole cut out of a block: a ring of corners on the largest circle the block has room for, each
// standing in the direction of the block point it answers to. Round rather than the shape of its
// own block, because a block out near the arc is far wider than it is tall and a hole stretched to
// fill it would read as a slot cut in the slice.
function cutOut(around: readonly SolidPoint[], centre: SolidPoint, bore: number): { size: number; rim: SolidPoint[] } {
  const size = bore * Math.min(...around.map((point) => length(subtract(point, centre))));
  const normal = outwardOf(around, centre);
  const first = unit(subtract(around[0], centre));
  const tangent = cross(normal, first);

  return {
    size,
    rim: around.map((_, step) => {
      const angle = (2 * Math.PI * step) / around.length;
      return add(centre, scale(add(scale(first, Math.cos(angle)), scale(tangent, Math.sin(angle))), size));
    }),
  };
}

// The way out of the face a block lies in, from the block itself: every corner of a block walked
// counter-clockwise turns the same way about the middle of it, so the turns add up to the normal.
function outwardOf(around: readonly SolidPoint[], centre: SolidPoint): SolidPoint {
  let turn: SolidPoint = [0, 0, 0];
  for (let step = 0; step < around.length; step += 1) {
    turn = add(turn, cross(subtract(around[step], centre), subtract(around[(step + 1) % around.length], centre)));
  }

  return unit(turn);
}
