// The body a Constellation Glyph hides behind.
//
// Hidden-line removal needs a surface: a cage of lines has nothing to occlude with. So a Sigil
// Figure is a real solid, and the lines actually drawn are that solid's own edges. What a pilot
// sees is then a figure with a far side, not a sprite unrolled onto the sky.
//
// Every body arrives sculpted. Building one out of flat line art was tried first - extrude the
// outline, turn it about its upright, vary its thickness along an authored side view - and every
// one of those rules is a guess about a shape nobody drew; a wolf came out a slab with a wolf
// printed on it. A model has the volume already, so all this has to do is take a closed surface
// and be told which of its edges are the drawing.
//
// Everything is triangles, so every face normal is exact and the facing test cannot be fooled by a
// warped quad. A surface cut into triangles has edges that hold it together but were never part of
// the drawing, so an edge carries whether it is drawn: a structural edge still occludes and still
// decides its neighbours' visibility, and is never emitted on its own.
//
// Nothing here knows about the observer's camera. Visibility is decided from the observer's Solar
// System, in absolute space, which is the whole point: orbiting the camera cannot change which
// edges are hidden, and travelling between stars can. A glyph's vertices never move.

export type SolidPoint = readonly [number, number, number];

export type SolidFace = {
  /** Indices into the solid's vertices, wound counter-clockwise seen from outside. */
  vertices: readonly [number, number, number];
  /** Unit outward normal. */
  normal: SolidPoint;
  /** A point on the face, for the facing test. */
  centre: SolidPoint;
};

export type SolidEdge = {
  from: number;
  to: number;
  /** The faces this edge borders. A closed body always has two. */
  faces: readonly [number, number];
  /** Whether this edge is part of the drawing, or only holds the surface together. */
  drawn: boolean;
};

export type GlyphSolid = {
  vertices: readonly SolidPoint[];
  faces: readonly SolidFace[];
  edges: readonly SolidEdge[];
};

// How one edge reads from one observer.
//
// `silhouette` is the outline, where the body turns away: the strongest line in the drawing, and
// the one that changes as a pilot travels. `interior` is an edge on the near side - visible, but
// subordinate to the outline. `hidden` is behind the body's own far side and is not drawn.
export type EdgeVisibility = "silhouette" | "interior" | "hidden";

const DEGENERATE = 1e-12;

// The body of a Sigil Figure, from a model somebody sculpted. The marked edges are the creases
// sharp enough to be part of the drawing; the outline is never marked, because where a body ends is
// a question only an observer can answer.
export function buildModelSolid(vertices: readonly SolidPoint[], triangles: readonly (readonly [number, number, number])[], drawnEdges: readonly (readonly [number, number])[]): GlyphSolid | null {
  return solidFromTriangles(vertices, triangles.map((triangle) => [...triangle] as [number, number, number]), new Set(drawnEdges.map(([from, to]) => edgeKey(from, to))));
}

/** One line of the drawing, as one observer sees it: a whole edge, or the part of one left visible. */
export type DrawnEdge = {
  kind: "silhouette" | "interior";
  from: SolidPoint;
  to: SolidPoint;
};

// How far a sample is lifted off the surface before asking whether the body is in the way, as a
// fraction of the body's own reach. Every point tested lies exactly on the surface, so without the
// lift the body occludes itself everywhere.
const SURFACE_LIFT = 0.004;

// How far to one side of an edge to look for open sky before calling it the outline, as a fraction
// of the body's own reach. Wide enough to clear the jaggedness of one facet, narrow enough to stay
// inside a limb.
const OUTLINE_PROBE = 0.02;

// The lines a body leaves an observer, which is the whole drawing.
//
// The facing test alone would answer this only for a body that is convex. It says an edge is hidden
// when both the faces it borders are turned away, which is exact only while nothing of a body
// stands in front of anything else of it.
//
// A sculpted body is not convex anywhere. A wolf's far foreleg faces the observer squarely and is
// squarely behind its chest, and the facing test passes it: the figure came out drawn on glass,
// with its far side showing straight through its near side. So a sculpted body is asked the real
// question - is any part of me between this line and the observer - and its edges come back cut
// into the pieces that survive.
//
// The cut points are not searched for. An edge's visibility can only change where it passes behind
// the body's outline, so the outline supplies the candidates and each stretch between them needs a
// single test. That keeps this exact rather than sampled: a line never flickers along its length,
// and it breaks precisely where the silhouette crosses it.
//
// None of it is the camera's business. Every test is against the observer's own position, so this
// stays a property of where a pilot is standing, as Glyph Parallax requires: orbiting the camera
// cannot restore a line the body is covering, and travelling to another Solar System can.
export function drawnEdges(solid: GlyphSolid, observer: SolidPoint): DrawnEdge[] {
  const frontFacing = solid.faces.map((face) => isFrontFacing(face, observer));
  const lines: DrawnEdge[] = [];

  const outline = solid.edges.filter((edge) => edgeVisibility(frontFacing, edge) === "silhouette");
  const reach = reachOf(solid);
  const lift = SURFACE_LIFT * reach;

  for (const edge of solid.edges) {
    const seen = edgeVisibility(frontFacing, edge);
    // Manual marking says that an edge belongs to the drawing; it does not make the reverse of the
    // body transparent. Two turned-away faces still put their shared edge on the far side.
    if (seen === "hidden") continue;
    // A marked crease is a line of the figure and is drawn wherever it can be seen. An unmarked edge
    // is only ever here because the body turns away along it, and then only on the outline.
    if (!edge.drawn && !(seen === "silhouette" && isOnOutline(solid, frontFacing, edge, observer, OUTLINE_PROBE * reach))) continue;
    for (const span of visibleSpans(solid, edge, outline, frontFacing, observer, lift)) {
      lines.push({ kind: seen, from: span[0], to: span[1] });
    }
  }
  return joinCollinear(lines);
}

// Two lines of the drawing that meet end to end and run straight on are one line.
//
// A surface is cut into facets to hold it together, so a crease that runs dead straight arrives
// here as a row of pieces meeting at points where the body does not turn at all: a sector's
// straight edge crossing every ring of the lattice it was built on, a rail crossing every section
// of a tube. Handing those over separately ends a stroke and starts another at every joint, and a
// stroke ends in a cap - so the joints come out as a row of lit points down a line that has
// nothing at them, and the figure appears to have vertices it does not have. Joining them is the
// rule that keeps the triangulation out of the drawing, applied to the line instead of the edge.
//
// Only where exactly two lines meet, of the same kind, leaving the joint in exactly opposite
// directions. Three lines meeting is a corner of the figure; two that leave the same way are a
// line doubling back on itself; and a line the body cut short ends at a point no other line
// reaches, which is what keeps a cut a cut.
function joinCollinear(lines: readonly DrawnEdge[]): DrawnEdge[] {
  const meeting = new Map<string, number[]>();
  for (const [index, line] of lines.entries()) {
    for (const point of [line.from, line.to]) meeting.set(endKey(point), [...(meeting.get(endKey(point)) ?? []), index]);
  }

  // Which line each line runs on into, at each of its own two ends.
  const onward = lines.map((): [number, number] => [-1, -1]);
  for (const [joint, pair] of meeting) {
    if (pair.length !== 2) continue;
    const [left, right] = pair;
    if (lines[left].kind !== lines[right].kind || !runsOn(joint, lines[left], lines[right])) continue;
    onward[left][endKey(lines[left].from) === joint ? 0 : 1] = right;
    onward[right][endKey(lines[right].from) === joint ? 0 : 1] = left;
  }

  const walked = lines.map(() => false);
  const joined: DrawnEdge[] = [];
  for (const [index, line] of lines.entries()) {
    const free = onward[index].indexOf(-1);
    if (walked[index] || free < 0) continue;

    // From this line's own free end to the free end of the last line of the run.
    let at = index;
    let entry = free;
    const from = entry === 0 ? line.from : line.to;
    for (;;) {
      walked[at] = true;
      const to = entry === 0 ? lines[at].to : lines[at].from;
      const next = onward[at][1 - entry];
      if (next < 0) {
        joined.push({ kind: line.kind, from, to });
        break;
      }
      entry = endKey(lines[next].from) === endKey(to) ? 0 : 1;
      at = next;
    }
  }
  // A run with no free end to start from closes on itself, which a straight line cannot do; it is
  // left exactly as it was found rather than guessed at.
  for (const [index, line] of lines.entries()) if (!walked[index]) joined.push(line);

  return joined;
}

// Whether two lines meeting at a point carry straight on through it. Both are measured leaving the
// joint, so carrying on is the one case where they point exactly opposite ways.
function runsOn(joint: string, left: DrawnEdge, right: DrawnEdge): boolean {
  const away = (line: DrawnEdge): SolidPoint | null => {
    const [here, there] = endKey(line.from) === joint ? [line.from, line.to] : [line.to, line.from];
    return unit([there[0] - here[0], there[1] - here[1], there[2] - here[2]]);
  };

  const [first, second] = [away(left), away(right)];
  return first !== null && second !== null && dot(first, second) < -1 + 1e-9;
}

// Two pieces of one crease share the vertex they meet at, so the point itself is the name of the
// joint. A line the body cut short ends somewhere no vertex stands and joins nothing.
function endKey(point: SolidPoint): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

// Whether an edge is where the body ends, rather than where one part of it passes in front of
// another.
//
// Both are places the surface turns away, and the facing test cannot tell them apart - but they
// behave completely differently as a pilot moves. The outline is a closed curve that slides over the
// body: edges join it and leave it, and the curve itself never breaks, so it reads as one line
// moving. A turn-away in the middle of a near-flat flank is not a curve at all. It is one facet
// edge that qualifies for a fraction of a degree, and what a pilot sees is a stroke blinking on in
// the middle of the chest and off again, which is the one thing a sigil must never do.
//
// So the question asked is not how the surface is folded but what is behind it: step a little to one
// side of the edge across the sky, and if there is no body there, the edge is where the body ends.
// Interior detail is left to the creases the figure was marked with, which are drawn whenever they
// can be seen and therefore never blink.
function isOnOutline(solid: GlyphSolid, frontFacing: readonly boolean[], edge: SolidEdge, observer: SolidPoint, probe: number): boolean {
  const from = solid.vertices[edge.from];
  const to = solid.vertices[edge.to];
  const middle = pointAt(from, to, 0.5);

  const view = unit([middle[0] - observer[0], middle[1] - observer[1], middle[2] - observer[2]]);
  const along = unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  if (!view || !along) return false;

  // Across the edge and across the line of sight: the two ways off the edge within the sky.
  const across = unit(crossProduct(view, along));
  if (!across) return false;

  for (const side of [1, -1]) {
    const point: SolidPoint = [middle[0] + across[0] * probe * side, middle[1] + across[1] * probe * side, middle[2] + across[2] * probe * side];
    if (!meetsSolid(solid, frontFacing, observer, point)) return true;
  }
  return false;
}

// Whether the ray from the observer through a point meets the body anywhere along it. Only the faces
// turned towards the observer are asked: a ray that reaches the body at all enters through one.
function meetsSolid(solid: GlyphSolid, frontFacing: readonly boolean[], observer: SolidPoint, through: SolidPoint): boolean {
  const direction: SolidPoint = [through[0] - observer[0], through[1] - observer[1], through[2] - observer[2]];

  for (let index = 0; index < solid.faces.length; index += 1) {
    if (!frontFacing[index]) continue;
    if (hitsTriangle(solid, solid.faces[index], observer, direction, Infinity)) return true;
  }
  return false;
}

/** Whether the body leaves one of its own vertices in sight, for the points marked on a figure. */
export function isVertexVisible(solid: GlyphSolid, vertex: number, observer: SolidPoint): boolean {
  const frontFacing = solid.faces.map((face) => isFrontFacing(face, observer));
  const normal = vertexNormal(solid, vertex);
  if (!normal) return false;

  const lift = SURFACE_LIFT * reachOf(solid);
  const point = solid.vertices[vertex];
  return !isBlocked(solid, frontFacing, [point[0] + normal[0] * lift, point[1] + normal[1] * lift, point[2] + normal[2] * lift], observer);
}

// The stretches of one edge the body does not cover, found by cutting it where the outline crosses
// in front of it and keeping whichever stretches survive a single test each.
function visibleSpans(solid: GlyphSolid, edge: SolidEdge, outline: readonly SolidEdge[], frontFacing: readonly boolean[], observer: SolidPoint, lift: number): [SolidPoint, SolidPoint][] {
  const from = solid.vertices[edge.from];
  const to = solid.vertices[edge.to];
  const normal = edgeNormal(solid, edge);
  const cuts = [0, 1];

  for (const other of outline) {
    // An outline edge meeting this one at a shared corner crosses it there by definition and says
    // nothing about what covers what.
    if (other === edge || other.from === edge.from || other.from === edge.to || other.to === edge.from || other.to === edge.to) continue;
    const cut = crossingParameter(from, to, solid.vertices[other.from], solid.vertices[other.to], observer);
    if (cut !== null) cuts.push(cut);
  }
  cuts.sort((left, right) => left - right);

  const spans: [SolidPoint, SolidPoint][] = [];
  let open: number | null = null;

  for (let step = 0; step + 1 < cuts.length; step += 1) {
    if (cuts[step + 1] - cuts[step] <= 1e-9) continue;
    const middle = (cuts[step] + cuts[step + 1]) / 2;
    const sample = pointAt(from, to, middle);
    const visible = !isBlocked(solid, frontFacing, [sample[0] + normal[0] * lift, sample[1] + normal[1] * lift, sample[2] + normal[2] * lift], observer);

    if (visible && open === null) open = cuts[step];
    if (!visible && open !== null) {
      spans.push([pointAt(from, to, open), pointAt(from, to, cuts[step])]);
      open = null;
    }
  }
  if (open !== null) spans.push([pointAt(from, to, open), to]);
  return spans;
}

// Whether any of the body stands between a point just outside its surface and the observer.
//
// Only the faces turned towards the observer are asked. A segment that leaves the body does so
// through a face the observer can see, so if the body is in the way at all one of those faces is
// hit. And a face the point is already outside of cannot be hit by a segment whose other end is
// outside it too, which disposes of nearly all of them before any arithmetic.
function isBlocked(solid: GlyphSolid, frontFacing: readonly boolean[], point: SolidPoint, observer: SolidPoint): boolean {
  const direction: SolidPoint = [observer[0] - point[0], observer[1] - point[1], observer[2] - point[2]];

  for (let index = 0; index < solid.faces.length; index += 1) {
    if (!frontFacing[index]) continue;
    const face = solid.faces[index];
    if (face.normal[0] * (point[0] - face.centre[0]) + face.normal[1] * (point[1] - face.centre[1]) + face.normal[2] * (point[2] - face.centre[2]) > 0) continue;
    if (hitsTriangle(solid, face, point, direction)) return true;
  }
  return false;
}

// Moller-Trumbore, restricted to the segment: a hit beyond the observer is not in the way, and a hit
// at the sample itself is the surface the sample was lifted off.
function hitsTriangle(solid: GlyphSolid, face: SolidFace, origin: SolidPoint, direction: SolidPoint, limit = 1): boolean {
  const [a, b, c] = face.vertices.map((index) => solid.vertices[index]);
  const edge1: SolidPoint = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2: SolidPoint = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const pivot = crossProduct(direction, edge2);
  const determinant = dot(edge1, pivot);
  if (Math.abs(determinant) <= DEGENERATE) return false;

  const inverse = 1 / determinant;
  const offset: SolidPoint = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = dot(offset, pivot) * inverse;
  if (u < 0 || u > 1) return false;

  const across = crossProduct(offset, edge1);
  const v = dot(direction, across) * inverse;
  if (v < 0 || u + v > 1) return false;

  const depth = dot(edge2, across) * inverse;
  return depth > 1e-6 && depth < limit;
}

// Where the ray from the observer through this edge passes through another edge: the parameter along
// the first at which the two cross as the observer sees them, or null if they never do.
function crossingParameter(from: SolidPoint, to: SolidPoint, otherFrom: SolidPoint, otherTo: SolidPoint, observer: SolidPoint): number | null {
  const left: SolidPoint = [otherFrom[0] - observer[0], otherFrom[1] - observer[1], otherFrom[2] - observer[2]];
  const right: SolidPoint = [otherTo[0] - observer[0], otherTo[1] - observer[1], otherTo[2] - observer[2]];
  const normal = crossProduct(left, right);

  // The plane through the observer and the other edge: this edge crosses it between its ends or not
  // at all.
  const start = dot(normal, [from[0] - observer[0], from[1] - observer[1], from[2] - observer[2]]);
  const end = dot(normal, [to[0] - observer[0], to[1] - observer[1], to[2] - observer[2]]);
  if ((start > 0) === (end > 0) || Math.abs(start - end) <= DEGENERATE) return null;

  const parameter = start / (start - end);
  if (!(parameter > 1e-6) || !(parameter < 1 - 1e-6)) return null;

  // Crossing the plane is not crossing the edge: the ray has to pass between the other edge's own
  // two ends, and in front of the observer rather than behind them.
  const point = pointAt(from, to, parameter);
  const ray: SolidPoint = [point[0] - observer[0], point[1] - observer[1], point[2] - observer[2]];
  if (dot(ray, [left[0] + right[0], left[1] + right[1], left[2] + right[2]]) <= 0) return null;
  return dot(normal, crossProduct(left, ray)) * dot(normal, crossProduct(ray, right)) >= 0 ? parameter : null;
}

// Outward, averaged over the two faces an edge borders, so a sample lifted along it leaves the
// surface whichever of the two it is nearer.
function edgeNormal(solid: GlyphSolid, edge: SolidEdge): SolidPoint {
  const [left, right] = edge.faces.map((index) => solid.faces[index].normal);
  const sum: SolidPoint = [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
  const size = Math.hypot(sum[0], sum[1], sum[2]);
  return size <= DEGENERATE ? left : [sum[0] / size, sum[1] / size, sum[2] / size];
}

function vertexNormal(solid: GlyphSolid, vertex: number): SolidPoint | null {
  const sum: [number, number, number] = [0, 0, 0];
  for (const face of solid.faces) {
    if (!face.vertices.includes(vertex)) continue;
    for (let axis = 0; axis < 3; axis += 1) sum[axis] += face.normal[axis];
  }
  const size = Math.hypot(sum[0], sum[1], sum[2]);
  return size <= DEGENERATE ? null : [sum[0] / size, sum[1] / size, sum[2] / size];
}

function reachOf(solid: GlyphSolid): number {
  const centre: [number, number, number] = [0, 0, 0];
  for (const vertex of solid.vertices) for (let axis = 0; axis < 3; axis += 1) centre[axis] += vertex[axis] / solid.vertices.length;

  let reach = 0;
  for (const vertex of solid.vertices) reach = Math.max(reach, Math.hypot(vertex[0] - centre[0], vertex[1] - centre[1], vertex[2] - centre[2]));
  return reach;
}

function pointAt(from: SolidPoint, to: SolidPoint, amount: number): SolidPoint {
  return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
}

function unit(vector: SolidPoint): SolidPoint | null {
  const size = Math.hypot(vector[0], vector[1], vector[2]);
  return size <= DEGENERATE ? null : [vector[0] / size, vector[1] / size, vector[2] / size];
}

function crossProduct(left: SolidPoint, right: SolidPoint): SolidPoint {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: SolidPoint, right: SolidPoint): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

// Which edges an observer can see. The test is per face - a face is front-facing when the observer
// is on its outward side - and an edge is hidden only when both the faces it borders are turned
// away. For a convex body this is exact hidden-line removal; for a concave one it keeps the
// outline honest and errs towards drawing a line rather than losing one, which is the right way to
// err for a glyph that must never look partial.
export function classifyEdges(solid: GlyphSolid, observer: SolidPoint): EdgeVisibility[] {
  const frontFacing = solid.faces.map((face) => isFrontFacing(face, observer));
  return solid.edges.map((edge) => edgeVisibility(frontFacing, edge));
}

function edgeVisibility(frontFacing: readonly boolean[], edge: SolidEdge): EdgeVisibility {
  const [left, right] = edge.faces;
  if (frontFacing[left] && frontFacing[right]) return "interior";
  if (frontFacing[left] || frontFacing[right]) return "silhouette";
  return "hidden";
}

export function isFrontFacing(face: SolidFace, observer: SolidPoint): boolean {
  return (
    face.normal[0] * (observer[0] - face.centre[0]) +
    face.normal[1] * (observer[1] - face.centre[1]) +
    face.normal[2] * (observer[2] - face.centre[2])
  ) > 0;
}

// Carries a solid from the Glyph Frame into absolute space. Positions and normals travel
// differently - a normal is a direction and must not pick up the frame's origin - so the caller
// hands in both maps.
export function mapSolid(
  solid: GlyphSolid,
  mapPosition: (point: SolidPoint) => SolidPoint,
  mapDirection: (direction: SolidPoint) => SolidPoint,
): GlyphSolid {
  return {
    ...solid,
    vertices: solid.vertices.map(mapPosition),
    faces: solid.faces.map((face) => ({ vertices: face.vertices, normal: mapDirection(face.normal), centre: mapPosition(face.centre) })),
    edges: solid.edges,
  };
}

function solidFromTriangles(vertices: readonly SolidPoint[], triangles: readonly [number, number, number][], drawn: ReadonlySet<string>): GlyphSolid | null {
  const faces: SolidFace[] = [];
  const borders = new Map<string, number[]>();

  for (const triangle of triangles) {
    const face = triangleFace(vertices, triangle);
    if (!face) continue;
    const position = faces.length;
    faces.push(face);
    for (let corner = 0; corner < 3; corner += 1) {
      const key = edgeKey(triangle[corner], triangle[(corner + 1) % 3]);
      borders.set(key, [...(borders.get(key) ?? []), position]);
    }
  }
  if (faces.length < 4) return null;

  const edges: SolidEdge[] = [];
  for (const [key, adjacent] of borders) {
    // An edge with one face is a hole in the surface: it cannot say what is behind it, so it is not
    // trusted to hide anything and is simply left out of the drawing.
    if (adjacent.length !== 2) continue;
    const [from, to] = key.split(":").map(Number);
    edges.push({ from, to, faces: [adjacent[0], adjacent[1]], drawn: drawn.has(key) });
  }

  return { vertices, faces, edges };
}

function triangleFace(vertices: readonly SolidPoint[], [a, b, c]: readonly [number, number, number]): SolidFace | null {
  const first = vertices[a];
  const second = vertices[b];
  const third = vertices[c];
  const edge1: SolidPoint = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
  const edge2: SolidPoint = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
  const normal: SolidPoint = [
    edge1[1] * edge2[2] - edge1[2] * edge2[1],
    edge1[2] * edge2[0] - edge1[0] * edge2[2],
    edge1[0] * edge2[1] - edge1[1] * edge2[0],
  ];
  const size = Math.hypot(normal[0], normal[1], normal[2]);
  if (size <= DEGENERATE) return null;

  return {
    vertices: [a, b, c],
    normal: [normal[0] / size, normal[1] / size, normal[2] / size],
    centre: [(first[0] + second[0] + third[0]) / 3, (first[1] + second[1] + third[1]) / 3, (first[2] + second[2] + third[2]) / 3],
  };
}

function edgeKey(from: number, to: number): string {
  return from < to ? `${from}:${to}` : `${to}:${from}`;
}
