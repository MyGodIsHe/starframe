import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type DrawnEdge, type SolidPoint } from "./glyphSolid";
import { ATOM, buildAtom } from "./sigilAtom";
import { readSigilModel } from "./sigilModel";

const atom = readSigilModel(buildAtom())!;
const raw = buildAtom();

const SHELL_VERTICES = ATOM.shell.around * ATOM.shell.through;
const SHELL_FACES = 2 * ATOM.shell.around * ATOM.shell.through;
const CORE_FACES = 20;

// The axis one shell turns about, by the same rule `buildAtom` places it with: the figure's own
// axes, the upright first, so every pair of shells is square.
function shellAxis(index: number): SolidPoint {
  const axes: SolidPoint[] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
  return axes[index % axes.length];
}

function dot(left: SolidPoint, right: SolidPoint): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

// How far a point stands off the centre line of the tube a shell is made of, as a vector: zero on
// the line, pointing out of the surface anywhere on it. The line is the circle of radius `major`
// lying in that shell's own plane.
function offTheLine(point: SolidPoint, normal: SolidPoint): SolidPoint {
  const height = dot(point, normal);
  const flat: SolidPoint = [point[0] - height * normal[0], point[1] - height * normal[1], point[2] - height * normal[2]];
  const reach = Math.hypot(flat[0], flat[1], flat[2]) || 1;
  const major = (1 - ATOM.shell.thickness) / reach;

  return [point[0] - flat[0] * major, point[1] - flat[1] * major, point[2] - flat[2] * major];
}

function radius(point: SolidPoint): number {
  return Math.hypot(point[0], point[1], point[2]);
}

// Which shell, or the core, a vertex belongs to. The body is built shell by shell and the core goes
// on the end, so this is arithmetic rather than a search.
function bodyOf(vertex: number): number {
  return Math.min(Math.floor(vertex / SHELL_VERTICES), ATOM.shells);
}

// The same drawing, measured so two observers can be compared: the lengths of the lines they get.
function drawnLengths(observer: SolidPoint): number[] {
  return drawnEdges(atom.solid, observer)
    .map((line) => Math.hypot(line.from[0] - line.to[0], line.from[1] - line.to[1], line.from[2] - line.to[2]))
    .sort((left, right) => left - right);
}

// The lines of the drawing that belong to the core: both ends at exactly the core's own radius.
function coreLines(observer: SolidPoint): DrawnEdge[] {
  return drawnEdges(atom.solid, observer).filter((line) => Math.abs(radius(line.from) - ATOM.core) < 1e-6 && Math.abs(radius(line.to) - ATOM.core) < 1e-6);
}

function distance(left: SolidPoint, right: SolidPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function scaled(point: SolidPoint, factor: number): SolidPoint {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function turnedAboutUpright(point: SolidPoint, angle: number): SolidPoint {
  return [
    point[0] * Math.cos(angle) + point[2] * Math.sin(angle),
    point[1],
    -point[0] * Math.sin(angle) + point[2] * Math.cos(angle),
  ];
}

describe("buildAtom", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(atom).not.toBeNull();
    expect(atom.name).toBe("atom");
    expect(atom.solid.faces).toHaveLength(ATOM.shells * SHELL_FACES + CORE_FACES);
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face, whether it is one body
    // or four of them.
    expect(atom.solid.edges).toHaveLength((atom.solid.faces.length * 3) / 2);
    for (const edge of atom.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    expect(atom.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("is separate bodies - a shell each and a core - and not one welded lump", () => {
    const bodies = new Set<number>();
    for (const edge of atom.solid.edges) {
      // No face ever joins two of them, which is what lets each one hide the others.
      expect(bodyOf(edge.from)).toBe(bodyOf(edge.to));
      bodies.add(bodyOf(edge.from));
    }

    expect(bodies).toEqual(new Set(Array.from({ length: ATOM.shells + 1 }, (_, body) => body)));
  });

  it("puts its shells' outer edges on the unit sphere, where a figure's farthest point goes", () => {
    expect(Math.max(...atom.solid.vertices.map(radius))).toBeCloseTo(1);
  });

  it("keeps three shells in their own planes, square to each other", () => {
    expect(ATOM.shells).toBe(3);
    for (let index = 0; index < ATOM.shells; index += 1) {
      const axis = shellAxis(index);
      const own = atom.solid.vertices.filter((_, vertex) => bodyOf(vertex) === index);

      expect(own).toHaveLength(SHELL_VERTICES);
      // A shell is a tube lying in its plane, so it reaches the tube's own radius off it and no
      // further - and it leans, so it is not the plane of any other shell.
      for (const vertex of own) expect(Math.abs(dot(vertex, axis))).toBeLessThanOrEqual(ATOM.shell.thickness + 1e-9);
      // Square to every other one, exactly: that is what keeps the shells from projecting on top of
      // one another and the atom from reading as an onion.
      for (let other = index + 1; other < ATOM.shells; other += 1) {
        expect(dot(axis, shellAxis(other))).toBeCloseTo(0);
      }
    }
  });

  it("stands a core inside the shells, clear of all three of them", () => {
    const core = atom.solid.vertices.filter((_, vertex) => bodyOf(vertex) === ATOM.shells);

    expect(core).toHaveLength(12);
    for (const vertex of core) expect(radius(vertex)).toBeCloseTo(ATOM.core);
    // The hole a shell leaves in its own middle is wider than the core, so nothing intersects it.
    expect(ATOM.core).toBeLessThan(1 - 2 * ATOM.shell.thickness);
  });

  it("winds every face outward, which is what lets the facing test read the body at all", () => {
    for (const [index, face] of atom.solid.faces.entries()) {
      const body = index < ATOM.shells * SHELL_FACES ? Math.floor(index / SHELL_FACES) : ATOM.shells;
      // Out of the core is away from the figure's centre; out of a shell is away from the tube's own
      // centre line, which is the circle of radius `major` lying in that shell's plane.
      const outward: SolidPoint = body === ATOM.shells ? face.centre : offTheLine(face.centre, shellAxis(body));

      expect(dot(face.normal, outward)).toBeGreaterThan(0);
    }
  });

  it("marks one rail running the whole way round each shell, and nothing on the core", () => {
    expect(raw.drawn).toHaveLength(ATOM.shells * ATOM.shell.around * Math.ceil(ATOM.shell.through / ATOM.shell.railStep));
    expect(ATOM.shell.railStep).toBe(ATOM.shell.through);
    for (const [from, to] of raw.drawn) expect(bodyOf(from)).toBe(bodyOf(to));
    expect(raw.drawn.some(([from]) => bodyOf(from) === ATOM.shells)).toBe(false);
  });

  it("spreads its anchors over the shell rims rather than bunching them where the shells cross", () => {
    const anchors = atom.anchors.map((anchor) => anchor.position);

    expect(anchors).toHaveLength(ATOM.anchors);
    for (const anchor of anchors) expect(radius(anchor)).toBeCloseTo(1);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(Math.hypot(anchors[left][0] - anchors[right][0], anchors[left][1] - anchors[right][1], anchors[left][2] - anchors[right][2])).toBeGreaterThan(0.5);
      }
    }
  });
});

describe("the atom as an observer sees it", () => {
  const observer: SolidPoint = [0, 0, 12];

  it("draws the core's outline although not one of its creases is marked", () => {
    // From one side, where the shells leave the core in sight. Every vertex of the core sits at
    // exactly its own radius, so a line with both ends there is the core's, and the only thing that
    // can put one in the drawing is the outline.
    const core = coreLines([12, 0, 0]);

    expect(core.length).toBeGreaterThanOrEqual(3);
    for (const line of core) expect(line.kind).toBe("silhouette");
  });

  it("stands the core in the hole of the shell that lies in the equator", () => {
    // Down the upright that shell is face on, so an observer gets its two rims and sees the core
    // through the hole between them - the same thing a ring does, with something inside it.
    const seen = drawnEdges(atom.solid, [0, 12, 0]);
    const reach = seen.flatMap((line) => [radius(line.from), radius(line.to)]);

    expect(coreLines([0, 12, 0]).length).toBeGreaterThan(0);
    expect(Math.max(...reach)).toBeCloseTo(1, 1);
    expect(Math.min(...reach)).toBeCloseTo(ATOM.core, 1);
  });

  it("lets the core blank what passes behind it, which the facing test alone would not", () => {
    // Two points in the core's shadow, one in front of it and one behind. The facing test says
    // nothing about either - a shell faces the observer on both sides of the figure.
    const shadowed = atom.solid.vertices
      .map((vertex, index): [SolidPoint, number] => [vertex, index])
      .filter(([vertex, index]) => bodyOf(index) < ATOM.shells && Math.hypot(vertex[0], vertex[1]) < ATOM.core * 0.7);
    const near = shadowed.filter(([vertex]) => vertex[2] > 0);
    const far = shadowed.filter(([vertex]) => vertex[2] < 0);

    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    for (const [, index] of far) expect(isVertexVisible(atom.solid, index, observer)).toBe(false);
    expect(near.some(([, index]) => isVertexVisible(atom.solid, index, observer))).toBe(true);
  });

  it("hides the back of each shell behind its own front, as a thing with volume does", () => {
    const outer = atom.solid.vertices
      .map((vertex, index): [SolidPoint, number] => [vertex, index])
      .filter(([vertex, index]) => bodyOf(index) < ATOM.shells && Math.abs(radius(vertex) - 1) < 1e-9);

    // Every point of the drawing is on the near half of the body: nothing from behind the figure's
    // own middle survives to be drawn.
    const drawn = drawnEdges(atom.solid, observer);
    expect(drawn.length).toBeGreaterThan(0);
    expect(outer.filter(([vertex]) => vertex[2] < -0.5).every(([, index]) => !isVertexVisible(atom.solid, index, observer))).toBe(true);
  });

  it("turns with the observer, which is the whole of Glyph Parallax", () => {
    expect(drawnLengths(turnedAboutUpright(observer, Math.PI / 6))).not.toEqual(drawnLengths(observer));
    expect(drawnLengths(turnedAboutUpright(observer, Math.PI / 2))).not.toEqual(drawnLengths(observer));
  });

  it("cuts a shell where the other one crosses in front of it", () => {
    // A line that starts or ends away from any vertex of the body was cut there, and the only thing
    // that can cut one is something of the figure standing between it and the observer. The facing
    // test cannot do this: both shells face the observer along the whole of that crossing.
    const corners = atom.solid.vertices;
    const atAVertex = (point: SolidPoint): boolean => corners.some((vertex) => distance(vertex, point) < 1e-9);
    const cut = drawnEdges(atom.solid, scaled(shellAxis(1), 12)).filter((line) => !atAVertex(line.from) || !atAVertex(line.to));

    expect(cut.length).toBeGreaterThan(0);
  });
});
