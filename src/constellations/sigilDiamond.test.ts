import { describe, expect, it } from "vitest";
import { buildDiamond, DIAMOND, onFacet, type Section } from "./sigilDiamond";
import { drawnEdges, isVertexVisible, type SolidPoint } from "./glyphSolid";
import { readSigilModel } from "./sigilModel";

const diamond = readSigilModel(buildDiamond())!;
const raw = buildDiamond();

// The body is centred on the middle of its own height and then scaled so its farthest point lands
// on the unit sphere. The farthest point is the girdle's upper rim: it stands a whole half width
// out and a little above the middle, which nothing else on the stone manages at once.
const MIDDLE = (DIAMOND.crown - DIAMOND.pavilion) / 2;
const RIM_HEIGHT = DIAMOND.girdle - MIDDLE;
const SIZED = 1 / Math.hypot(1, RIM_HEIGHT);

/** The stone's own heights, as the figure comes out: the table on top, the culet under it. */
const TABLE_AT = (DIAMOND.girdle + DIAMOND.crown - MIDDLE) * SIZED;
const CULET_AT = -(DIAMOND.girdle + DIAMOND.pavilion + MIDDLE) * SIZED;
const RIM_AT = RIM_HEIGHT * SIZED;
const KEEL_AT = (-DIAMOND.girdle - MIDDLE) * SIZED;

/** How far out a point stands, across the plane of depth the girdle lies in. */
function across(point: SolidPoint): number {
  return Math.hypot(point[0], point[2]);
}

function at(height: number): (point: SolidPoint) => boolean {
  return (point) => Math.abs(point[1] - height) < 1e-9;
}

// Which flat the stone cuts a face in: a facet is a plane, and two triangles of one facet give the
// same normal and stand the same distance from the middle. Rounding runs through zero, where a
// normal's own sign is noise, so it is taken out before the two are compared.
function facetOf(normal: SolidPoint, centre: SolidPoint): string {
  const reach = normal[0] * centre[0] + normal[1] * centre[1] + normal[2] * centre[2];
  return [...normal, reach].map((value) => Math.round(value * 1e6) / 1e6 + 0).join("|");
}

const facets = new Map<string, SolidPoint>();
for (const face of diamond.solid.faces) facets.set(facetOf(face.normal, face.centre), face.normal);

describe("buildDiamond", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(diamond).not.toBeNull();
    expect(diamond.name).toBe("diamond");
    expect(diamond.solid.faces.length).toBeGreaterThan(0);
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face.
    expect(diamond.solid.edges).toHaveLength((diamond.solid.faces.length * 3) / 2);
    for (const edge of diamond.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    expect(diamond.solid.faces).toHaveLength(14 * DIAMOND.mains - 2);
    expect(diamond.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("cuts the stone to the facet count a brilliant is specified by, and every facet flat", () => {
    const crown = [...facets.values()].filter((normal) => normal[1] > 1e-9);
    const band = [...facets.values()].filter((normal) => Math.abs(normal[1]) <= 1e-9);
    const pavilion = [...facets.values()].filter((normal) => normal[1] < -1e-9);

    // A table, a bezel and a star facet for each main, two upper girdle halves between neighbours.
    expect(crown).toHaveLength(1 + 2 * DIAMOND.mains + 2 * DIAMOND.mains);
    // A main for each bezel, with two lower halves between neighbours. No facet on the culet.
    expect(pavilion).toHaveLength(3 * DIAMOND.mains);
    expect(crown.length + pavilion.length).toBe(1 + 7 * DIAMOND.mains);
    // And the band, which is the only part of the stone that stands straight up.
    expect(band).toHaveLength(2 * DIAMOND.mains);
  });

  it("puts its girdle on the unit sphere, where a figure's farthest point goes, as a true circle", () => {
    const reach = diamond.solid.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1], vertex[2]));
    const girdle = diamond.solid.vertices.filter((vertex) => at(RIM_AT)(vertex) || at(KEEL_AT)(vertex));

    expect(Math.max(...reach)).toBeCloseTo(1);
    expect(girdle).toHaveLength(4 * DIAMOND.mains);
    for (const point of girdle) expect(across(point)).toBeCloseTo(SIZED);
    for (const vertex of diamond.solid.vertices) expect(across(vertex)).toBeLessThanOrEqual(SIZED + 1e-9);
  });

  it("stands the way a stone is set: flat on top, and down to a point under it", () => {
    const heights = diamond.solid.vertices.map((vertex) => vertex[1]);
    const table = diamond.solid.vertices.filter(at(TABLE_AT));
    const culet = diamond.solid.vertices.filter(at(CULET_AT));

    expect(Math.max(...heights)).toBeCloseTo(TABLE_AT);
    expect(Math.min(...heights)).toBeCloseTo(CULET_AT);
    expect(table).toHaveLength(DIAMOND.mains);
    for (const corner of table) expect(across(corner)).toBeCloseTo(DIAMOND.table * SIZED);
    // The culet is one point, and it stands on the figure's own upright.
    expect(culet).toHaveLength(1);
    expect(across(culet[0])).toBeCloseTo(0);
  });

  it("reads its corners off the facets they lie in rather than taking them on trust", () => {
    const table: Section = { radius: DIAMOND.table, height: DIAMOND.girdle + DIAMOND.crown };
    const rim: Section = { radius: 1, height: DIAMOND.girdle };
    const tip = onFacet(table, rim, DIAMOND.table + DIAMOND.star * (1 - DIAMOND.table), Math.PI / DIAMOND.mains);

    // A corner half a pitch off the bezel's own middle lies on the bezel all the same: the plane
    // through the table corner and the girdle under it, which is what makes the facet flat.
    const fall = table.height - rim.height;
    const run = rim.radius - table.radius;
    expect(tip.radius * Math.cos(Math.PI / DIAMOND.mains) * fall + tip.height * run).toBeCloseTo(fall * table.radius + run * table.height);
    // And it stands higher than the bezel's own section does at that radius, because turning off
    // the middle of a flat facet shortens the reach across it.
    expect(tip.height).toBeGreaterThan(table.height - ((tip.radius - table.radius) / run) * fall);
  });

  it("is wound outward, which is what lets the facing test read it at all", () => {
    // A cut stone is convex and the body is centred, so every facet faces away from the middle.
    for (const face of diamond.solid.faces) {
      expect(face.normal[0] * face.centre[0] + face.normal[1] * face.centre[1] + face.normal[2] * face.centre[2]).toBeGreaterThan(0);
    }
  });

  it("marks the eight fold skeleton and nothing holding a facet together", () => {
    expect(raw.drawn).toHaveLength(10 * DIAMOND.mains);
    // Every marked line is a crease, where two facets meet at an angle. A line inside one flat
    // facet - a spoke of the table's fan, the diagonal of a bezel - is never marked.
    for (const edge of diamond.solid.edges.filter((edge) => edge.drawn)) {
      const [left, right] = edge.faces.map((face) => diamond.solid.faces[face]);
      expect(facetOf(left.normal, left.centre)).not.toBe(facetOf(right.normal, right.centre));
    }
    // The girdle is marked once, on the rim the crown runs down to, and not again a hair below it.
    const band = raw.drawn.filter(([from, to]) => at(RIM_AT)(raw.vertices[from]) && at(RIM_AT)(raw.vertices[to]));
    const under = raw.drawn.filter(([from, to]) => at(KEEL_AT)(raw.vertices[from]) && at(KEEL_AT)(raw.vertices[to]));
    expect(band).toHaveLength(2 * DIAMOND.mains);
    expect(under).toHaveLength(0);
  });

  it("stands its anchors on the corners of the stone's own silhouette", () => {
    const anchors = diamond.anchors.map((anchor) => anchor.position);

    expect(anchors).toHaveLength(5);
    expect(anchors.filter(at(TABLE_AT))).toHaveLength(2);
    expect(anchors.filter(at(RIM_AT))).toHaveLength(2);
    expect(anchors.filter(at(CULET_AT))).toHaveLength(1);
    // None of them lands on another once the figure is seen flat, which is the whole reason they
    // are taken across the stone rather than round it.
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(Math.hypot(anchors[left][0] - anchors[right][0], anchors[left][1] - anchors[right][1])).toBeGreaterThan(0.5);
      }
    }
  });
});

describe("the diamond as an observer sees it", () => {
  it("shows the stone's silhouette: a flat top, the girdle widest, and a point underneath", () => {
    const lines = drawnEdges(diamond.solid, [0, 0, 12]);
    const points = lines.flatMap((line) => [line.from, line.to]);

    expect(Math.max(...points.map((point) => point[1]))).toBeCloseTo(TABLE_AT);
    expect(Math.min(...points.map((point) => point[1]))).toBeCloseTo(CULET_AT);
    expect(Math.max(...points.map((point) => Math.abs(point[0])))).toBeCloseTo(SIZED);
  });

  it("hides its own far side rather than drawing through itself", () => {
    const observer: SolidPoint = [0, 0, 12];
    // The girdle's rim, square to the observer on the near side and on the far side behind it.
    const rimAt = (side: number): number => diamond.solid.vertices.findIndex((vertex) =>
      at(RIM_AT)(vertex) && Math.abs(vertex[0]) < 1e-9 && Math.sign(vertex[2]) === side);

    expect(rimAt(1)).toBeGreaterThanOrEqual(0);
    expect(rimAt(-1)).toBeGreaterThanOrEqual(0);
    expect(isVertexVisible(diamond.solid, rimAt(1), observer)).toBe(true);
    expect(isVertexVisible(diamond.solid, rimAt(-1), observer)).toBe(false);
  });

  it("keeps the whole pavilion behind the girdle when the observer stands over the table", () => {
    // Nothing of a convex stone is ever seen through it, so from above the girdle is the last
    // thing there is: every line of the drawing belongs to the crown.
    const lines = drawnEdges(diamond.solid, [0, 12, 0]);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.from[1]).toBeGreaterThanOrEqual(RIM_AT - 1e-9);
      expect(line.to[1]).toBeGreaterThanOrEqual(RIM_AT - 1e-9);
    }
  });

  it("comes out the same stone a whole pitch round, which is what eight fold symmetry means", () => {
    const seenFrom = (azimuth: number): string[] => drawnEdges(diamond.solid, [Math.sin(azimuth) * 12, 2, Math.cos(azimuth) * 12])
      .map((line) => Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1], line.to[2] - line.from[2]).toFixed(6))
      .sort();

    expect(seenFrom(0.3).length).toBeGreaterThan(0);
    expect(seenFrom(0.3 + (2 * Math.PI) / DIAMOND.mains)).toEqual(seenFrom(0.3));
    // Half a pitch round is a different view of it, not the same drawing over again.
    expect(seenFrom(0.3 + Math.PI / DIAMOND.mains)).not.toEqual(seenFrom(0.3));
  });
});
