// Turning a ready-made model into a Sigil Figure's body.
//
// Building a body out of flat line art - extruding a closed outline, or turning it about its
// upright - was only ever as good as a shape that had to be invented twice, once face on and once
// from the side. A wolf came out a slab with a wolf printed on it. A sculpted model has
// the volume already, from every side, so the work here is not to invent geometry but to throw
// nearly all of it away: a print mesh carries fifty thousand triangles, and a glyph is a handful of
// confident lines over a body small enough to solve the facing test for, every frame, for every
// Constellation on the sky.
//
// So the pipeline is: read the mesh, cut off the display plinth a print carries and the sky does
// not want, collapse it to a few hundred triangles by quadric error - which also snaps the
// near-coplanar noise of an export back into the flat facets the artist actually modelled - and
// then mark the creases sharp enough to be part of the drawing. Everything else holds the surface
// together so the body can hide its own far side, and is never emitted.
//
// Nothing here runs in the app. It is the offline half of `src/constellations/sigilModel.ts`,
// which reads what this writes.

export type MeshPoint = readonly [number, number, number];
export type MeshTriangle = readonly [number, number, number];
export type Mesh = { vertices: readonly MeshPoint[]; triangles: readonly MeshTriangle[] };

const DEGENERATE = 1e-12;

// Reads binary or ASCII STL and welds coincident corners. An STL has no vertex sharing at all -
// every triangle repeats its three corners - so until they are welded the mesh has no edges, no
// neighbours, and nothing to measure a crease against.
export function parseStl(data: Uint8Array): Mesh {
  return weld(looksBinary(data) ? readBinaryStl(data) : readAsciiStl(new TextDecoder().decode(data)));
}

function looksBinary(data: Uint8Array): boolean {
  if (data.byteLength < 84) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return 84 + 50 * view.getUint32(80, true) === data.byteLength;
}

function readBinaryStl(data: Uint8Array): MeshPoint[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(80, true);
  const triangles: MeshPoint[][] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = 84 + index * 50;
    triangles.push([0, 1, 2].map((corner): MeshPoint => [
      view.getFloat32(offset + 12 + corner * 12, true),
      view.getFloat32(offset + 16 + corner * 12, true),
      view.getFloat32(offset + 20 + corner * 12, true),
    ]));
  }
  return triangles;
}

function readAsciiStl(text: string): MeshPoint[][] {
  const corners: MeshPoint[] = [];
  for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) corners.push([Number(match[1]), Number(match[2]), Number(match[3])]);

  const triangles: MeshPoint[][] = [];
  for (let index = 0; index + 2 < corners.length; index += 3) triangles.push([corners[index], corners[index + 1], corners[index + 2]]);
  return triangles;
}

// A modeller writes the same corner bit for bit into every triangle that meets there, so matching
// on the exact coordinates is enough and never fuses two corners that were meant to stay apart.
function weld(triangles: readonly MeshPoint[][]): Mesh {
  const indices = new Map<string, number>();
  const vertices: MeshPoint[] = [];
  const welded: MeshTriangle[] = [];

  for (const triangle of triangles) {
    const corners = triangle.map((point) => {
      const key = `${point[0]},${point[1]},${point[2]}`;
      const existing = indices.get(key);
      if (existing !== undefined) return existing;
      indices.set(key, vertices.length);
      vertices.push(point);
      return vertices.length - 1;
    });
    if (corners.length === 3) welded.push([corners[0], corners[1], corners[2]]);
  }

  return compact({ vertices, triangles: welded });
}

// Cuts away everything below a height and closes the hole it leaves.
//
// A model made for a printer stands on a slab. On the sky the slab is the widest thing in the
// silhouette, it owns the extremities an anchor should have gone to, and it says nothing about the
// subject. The cut has to leave a closed surface behind: an open shell cannot say what is in front
// of what, and the glyph would lose its far side.
export function clipBelow(mesh: Mesh, height: number): Mesh {
  const vertices: MeshPoint[] = [...mesh.vertices];
  const kept: MeshTriangle[] = [];
  const crossings = new Map<string, number>();
  const above = (vertex: number): boolean => mesh.vertices[vertex][1] >= height;

  const crossing = (first: number, second: number): number => {
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    const existing = crossings.get(key);
    if (existing !== undefined) return existing;
    const from = mesh.vertices[first];
    const to = mesh.vertices[second];
    const amount = (height - from[1]) / (to[1] - from[1]);
    vertices.push([from[0] + (to[0] - from[0]) * amount, height, from[2] + (to[2] - from[2]) * amount]);
    crossings.set(key, vertices.length - 1);
    return vertices.length - 1;
  };

  for (const triangle of mesh.triangles) {
    const standing = triangle.filter(above).length;
    if (standing === 3) {
      kept.push(triangle);
      continue;
    }
    if (standing === 0) continue;

    // Rotated so the corner on its own side of the plane comes first; the other two then keep their
    // original order, and with it the triangle's winding.
    const odd = [0, 1, 2].find((corner) => above(triangle[corner]) !== above(triangle[(corner + 1) % 3]) && above(triangle[corner]) !== above(triangle[(corner + 2) % 3]))!;
    const [a, b, c] = [0, 1, 2].map((step) => triangle[(odd + step) % 3]);

    if (above(a)) kept.push([a, crossing(a, b), crossing(c, a)]);
    else kept.push([crossing(a, b), b, c], [crossing(a, b), c, crossing(c, a)]);
  }

  return capHoles({ vertices, triangles: kept });
}

// Fans every boundary loop left by the cut from its own centroid. One hub for all of them would
// sew four separate paw sections into one web, so the loops are walked apart first.
function capHoles(mesh: Mesh): Mesh {
  const directed = new Set<string>();
  for (const triangle of mesh.triangles) for (let corner = 0; corner < 3; corner += 1) directed.add(`${triangle[corner]}:${triangle[(corner + 1) % 3]}`);

  const outgoing = new Map<number, number>();
  for (const triangle of mesh.triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const from = triangle[corner];
      const to = triangle[(corner + 1) % 3];
      if (!directed.has(`${to}:${from}`)) outgoing.set(from, to);
    }
  }

  const vertices: MeshPoint[] = [...mesh.vertices];
  const triangles: MeshTriangle[] = [...mesh.triangles];
  const visited = new Set<number>();

  for (const start of outgoing.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    for (let current: number | undefined = start; current !== undefined && !visited.has(current); current = outgoing.get(current)) {
      visited.add(current);
      loop.push(current);
    }
    if (loop.length < 3) continue;

    const hub = vertices.length;
    vertices.push([
      loop.reduce((total, vertex) => total + vertices[vertex][0] / loop.length, 0),
      loop.reduce((total, vertex) => total + vertices[vertex][1] / loop.length, 0),
      loop.reduce((total, vertex) => total + vertices[vertex][2] / loop.length, 0),
    ]);
    // A hole is bounded by directed edges with no partner; closing it means supplying the partner,
    // so each cap triangle runs its loop edge backwards and the surface stays wound outward.
    for (let index = 0; index < loop.length; index += 1) triangles.push([hub, loop[(index + 1) % loop.length], loop[index]]);
  }

  return compact({ vertices, triangles });
}

type Quadric = Float64Array;
type Collapse = { from: number; to: number; fromVersion: number; toVersion: number; cost: number; target: MeshPoint };

// Quadric error edge collapse. The error a vertex carries is the summed squared distance to the
// planes of the faces it came from, so a collapse across a flat flank costs nothing and one that
// would round off a muzzle costs a great deal. That is what makes this the right reduction for a
// model drawn as lines: the facets survive and the export's subdivision noise does not.
export function decimate(mesh: Mesh, targetTriangles: number): Mesh {
  const vertices: MeshPoint[] = [...mesh.vertices];
  const faces: (MeshTriangle | null)[] = [...mesh.triangles];
  const quadrics = vertices.map(() => new Float64Array(10));
  const faceOf: Set<number>[] = vertices.map(() => new Set<number>());
  const version = new Int32Array(vertices.length);

  faces.forEach((face, index) => {
    if (!face) return;
    const plane = planeOf(vertices, face);
    for (const corner of face) {
      faceOf[corner].add(index);
      if (plane) addQuadric(quadrics[corner], plane);
    }
  });

  const heap: Collapse[] = [];
  const proposed = new Set<string>();
  for (const face of faces) {
    if (!face) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const [low, high] = pair(face[corner], face[(corner + 1) % 3]);
      if (proposed.has(`${low}:${high}`)) continue;
      proposed.add(`${low}:${high}`);
      push(heap, proposal(vertices, quadrics, version, low, high));
    }
  }

  let live = faces.reduce((total, face) => total + (face ? 1 : 0), 0);
  let budget = mesh.triangles.length * 50 + 100_000;

  while (live > targetTriangles && heap.length > 0 && budget > 0) {
    budget -= 1;
    const best = pop(heap)!;
    // A proposal is only as good as the mesh it was costed against; one end having moved or died
    // since is what makes it stale, and the live edge it stood for has been proposed again.
    if (version[best.from] !== best.fromVersion || version[best.to] !== best.toVersion) continue;
    if (!collapsible(vertices, faces, faceOf, best)) continue;

    vertices[best.from] = best.target;
    for (let term = 0; term < 10; term += 1) quadrics[best.from][term] += quadrics[best.to][term];

    for (const index of [...faceOf[best.to]]) {
      const face = faces[index];
      if (!face) continue;
      if (face.includes(best.from)) {
        faces[index] = null;
        live -= 1;
        for (const corner of face) faceOf[corner].delete(index);
        continue;
      }
      faces[index] = face.map((corner) => (corner === best.to ? best.from : corner)) as unknown as MeshTriangle;
      faceOf[best.from].add(index);
    }
    faceOf[best.to].clear();
    version[best.from] += 1;
    version[best.to] = -1;

    // Only the survivor's own quadric changed, so only the edges leaving it are re-costed. Bumping
    // its neighbours too would invalidate the edges between them and quietly stall the reduction.
    const neighbours = new Set<number>();
    for (const index of faceOf[best.from]) for (const corner of faces[index] ?? []) if (corner !== best.from) neighbours.add(corner);
    for (const neighbour of neighbours) push(heap, proposal(vertices, quadrics, version, best.from, neighbour));
  }

  return compact({ vertices, triangles: faces.filter((face): face is MeshTriangle => face !== null) });
}

function proposal(vertices: readonly MeshPoint[], quadrics: readonly Quadric[], version: Int32Array, from: number, to: number): Collapse {
  const merged = new Float64Array(10);
  for (let term = 0; term < 10; term += 1) merged[term] = quadrics[from][term] + quadrics[to][term];

  const midpoint: MeshPoint = [
    (vertices[from][0] + vertices[to][0]) / 2,
    (vertices[from][1] + vertices[to][1]) / 2,
    (vertices[from][2] + vertices[to][2]) / 2,
  ];
  const optimal = minimiser(merged);
  let target = midpoint;
  let cost = quadricError(merged, midpoint);

  for (const candidate of [optimal, vertices[from], vertices[to]]) {
    if (!candidate) continue;
    const value = quadricError(merged, candidate);
    if (value >= cost) continue;
    cost = value;
    target = candidate;
  }

  return { from, to, fromVersion: version[from], toVersion: version[to], cost, target };
}

// A collapse is allowed only when it leaves a closed surface behind and turns no face inside out.
// The link condition - the two ends share exactly the two neighbours their own edge already has -
// is what keeps the mesh manifold; without it a thin limb pinches into a seam that cannot say what
// is in front of what, and the body stops hiding its far side.
function collapsible(vertices: readonly MeshPoint[], faces: readonly (MeshTriangle | null)[], faceOf: readonly Set<number>[], collapse: Collapse): boolean {
  const shared = [...faceOf[collapse.from]].filter((index) => faceOf[collapse.to].has(index) && faces[index]);
  if (shared.length !== 2) return false;

  const neighbours = (vertex: number): Set<number> => {
    const found = new Set<number>();
    for (const index of faceOf[vertex]) for (const corner of faces[index] ?? []) if (corner !== vertex) found.add(corner);
    return found;
  };
  const toNeighbours = neighbours(collapse.to);
  if ([...neighbours(collapse.from)].filter((vertex) => toNeighbours.has(vertex)).length !== 2) return false;

  for (const vertex of [collapse.from, collapse.to]) {
    for (const index of faceOf[vertex]) {
      const face = faces[index];
      if (!face || shared.includes(index)) continue;
      const before = normalOf(vertices, face);
      const moved = face.map((corner) => (corner === collapse.from || corner === collapse.to ? collapse.target : vertices[corner]));
      const after = normalOfPoints(moved[0], moved[1], moved[2]);
      if (!before || !after) return false;
      if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] <= 0) return false;
    }
  }
  return true;
}

// Which edges are part of the drawing. A crease the artist modelled reads as a line; the triangles
// that merely tile a flat flank do not, and a mesh drawn edge for edge is a wireframe model rather
// than an emblem.
export function featureEdges(mesh: Mesh, dihedralDegrees: number): [number, number][] {
  const limit = Math.cos((dihedralDegrees * Math.PI) / 180);
  const normals = mesh.triangles.map((triangle) => normalOf(mesh.vertices, triangle));
  const borders = new Map<string, number[]>();

  mesh.triangles.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const [low, high] = pair(triangle[corner], triangle[(corner + 1) % 3]);
      borders.set(`${low}:${high}`, [...(borders.get(`${low}:${high}`) ?? []), index]);
    }
  });

  const edges: [number, number][] = [];
  for (const [key, adjacent] of borders) {
    if (adjacent.length !== 2) continue;
    const [left, right] = adjacent.map((index) => normals[index]);
    if (!left || !right) continue;
    if (left[0] * right[0] + left[1] * right[1] + left[2] * right[2] >= limit) continue;
    const [low, high] = key.split(":").map(Number);
    edges.push([low, high]);
  }
  return edges.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
}

// Where a real Solar System is meant to land: the tips, taken furthest apart, which on a sculpted
// animal are the muzzle, the ears, the tail and the paws. Taking them from the model rather than
// authoring them keeps a figure's anchors honest about the shape the fitter will actually draw.
//
// Both measurements are made flat, in the plane the figure is drawn on, because that is where the
// fit happens: the Solar Systems are laid out in the Constellation's own plane and the anchors have
// to land on them there. Two tips that differ only in depth are one anchor as far as the fitter is
// concerned, and a sitting animal has four of those along the ground.
//
// The first anchor is the point reaching furthest out; each one after it is whichever point trades
// reach against distance from the anchors already placed best, so the set covers the figure instead
// of crowding its longest limb.
export function extremities(mesh: Mesh, count: number): number[] {
  if (mesh.vertices.length === 0) return [];
  const reach = mesh.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1]));
  const chosen = [reach.indexOf(Math.max(...reach))];

  while (chosen.length < count && chosen.length < mesh.vertices.length) {
    let best = -1;
    let bestScore = -Infinity;
    for (let index = 0; index < mesh.vertices.length; index += 1) {
      if (chosen.includes(index)) continue;
      let separation = Infinity;
      for (const picked of chosen) separation = Math.min(separation, Math.hypot(mesh.vertices[index][0] - mesh.vertices[picked][0], mesh.vertices[index][1] - mesh.vertices[picked][1]));
      const score = reach[index] * separation;
      if (score <= bestScore) continue;
      bestScore = score;
      best = index;
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen;
}

// Moves the model into the space a Sigil Figure lives in: centred on its own bounding box and
// scaled so its farthest point sits on the unit sphere. The fitter works in a chart where the
// Constellation's farthest Solar System is on the unit circle, so a figure that reaches one is
// drawn at the size of the Constellation it stands for.
export function normalise(mesh: Mesh): { mesh: Mesh; centre: MeshPoint; scale: number } {
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertex of mesh.vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], vertex[axis]);
      high[axis] = Math.max(high[axis], vertex[axis]);
    }
  }
  if (!low.every(Number.isFinite)) return { mesh, centre: [0, 0, 0], scale: 1 };

  const centre: MeshPoint = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
  let reach = 0;
  for (const vertex of mesh.vertices) reach = Math.max(reach, distance(vertex, centre));
  const scale = reach > DEGENERATE ? 1 / reach : 1;

  return {
    mesh: {
      vertices: mesh.vertices.map((vertex): MeshPoint => [(vertex[0] - centre[0]) * scale, (vertex[1] - centre[1]) * scale, (vertex[2] - centre[2]) * scale]),
      triangles: mesh.triangles,
    },
    centre,
    scale,
  };
}

// Drops the triangles a cut or a collapse left with no area, and renumbers what survives so the
// model carries no vertex nothing points at.
export function compact(mesh: Mesh): Mesh {
  const moved = new Map<number, number>();
  const vertices: MeshPoint[] = [];
  const triangles: MeshTriangle[] = [];

  for (const triangle of mesh.triangles) {
    if (triangle[0] === triangle[1] || triangle[1] === triangle[2] || triangle[2] === triangle[0]) continue;
    if (!normalOf(mesh.vertices, triangle)) continue;
    const corners = triangle.map((corner) => {
      const existing = moved.get(corner);
      if (existing !== undefined) return existing;
      moved.set(corner, vertices.length);
      vertices.push(mesh.vertices[corner]);
      return vertices.length - 1;
    });
    triangles.push([corners[0], corners[1], corners[2]]);
  }
  return { vertices, triangles };
}

// How watertight the result is, which is the one property the glyph pipeline cannot do without: an
// edge with anything but two faces is a hole, and a body with holes cannot hide its own far side.
export function meshReport(mesh: Mesh): { vertices: number; triangles: number; boundary: number; nonManifold: number } {
  const borders = new Map<string, number>();
  for (const triangle of mesh.triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const [low, high] = pair(triangle[corner], triangle[(corner + 1) % 3]);
      borders.set(`${low}:${high}`, (borders.get(`${low}:${high}`) ?? 0) + 1);
    }
  }

  let boundary = 0;
  let nonManifold = 0;
  for (const shared of borders.values()) {
    if (shared === 1) boundary += 1;
    else if (shared > 2) nonManifold += 1;
  }
  return { vertices: mesh.vertices.length, triangles: mesh.triangles.length, boundary, nonManifold };
}

function pair(left: number, right: number): [number, number] {
  return left < right ? [left, right] : [right, left];
}

function planeOf(vertices: readonly MeshPoint[], face: MeshTriangle): readonly [number, number, number, number] | null {
  const normal = normalOf(vertices, face);
  if (!normal) return null;
  const point = vertices[face[0]];
  return [normal[0], normal[1], normal[2], -(normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2])];
}

function normalOf(vertices: readonly MeshPoint[], face: MeshTriangle): MeshPoint | null {
  return normalOfPoints(vertices[face[0]], vertices[face[1]], vertices[face[2]]);
}

function normalOfPoints(first: MeshPoint, second: MeshPoint, third: MeshPoint): MeshPoint | null {
  const left: MeshPoint = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
  const right: MeshPoint = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
  const normal: MeshPoint = [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
  const size = Math.hypot(normal[0], normal[1], normal[2]);
  return size <= DEGENERATE ? null : [normal[0] / size, normal[1] / size, normal[2] / size];
}

function addQuadric(quadric: Quadric, [a, b, c, d]: readonly [number, number, number, number]): void {
  const terms = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
  for (let term = 0; term < 10; term += 1) quadric[term] += terms[term];
}

function quadricError(quadric: Quadric, [x, y, z]: MeshPoint): number {
  const [a2, ab, ac, ad, b2, bc, bd, c2, cd, d2] = quadric;
  return Math.max(0, a2 * x * x + 2 * ab * x * y + 2 * ac * x * z + 2 * ad * x + b2 * y * y + 2 * bc * y * z + 2 * bd * y + c2 * z * z + 2 * cd * z + d2);
}

// The position that minimises the merged quadric, by Cramer's rule on its 3x3 part. A flat or
// cylindrical neighbourhood leaves that part singular, and then there is no single best point: the
// caller falls back to the two ends and the midpoint.
function minimiser(quadric: Quadric): MeshPoint | null {
  const [a2, ab, ac, ad, b2, bc, bd, c2, cd] = quadric;
  const matrix = [
    [a2, ab, ac],
    [ab, b2, bc],
    [ac, bc, c2],
  ];
  const right = [-ad, -bd, -cd];
  const determinant = determinantOf(matrix);
  const magnitude = Math.max(Math.abs(a2) + Math.abs(b2) + Math.abs(c2), DEGENERATE);
  if (Math.abs(determinant) <= 1e-10 * magnitude ** 3) return null;

  const solved = [0, 1, 2].map((column) => determinantOf(matrix.map((row, index) => row.map((value, position) => (position === column ? right[index] : value)))) / determinant);
  return solved.every(Number.isFinite) ? [solved[0], solved[1], solved[2]] : null;
}

function determinantOf(matrix: readonly (readonly number[])[]): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function distance(left: MeshPoint, right: MeshPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function push(heap: Collapse[], entry: Collapse): void {
  heap.push(entry);
  let position = heap.length - 1;
  while (position > 0) {
    const parent = (position - 1) >> 1;
    if (heap[parent].cost <= heap[position].cost) break;
    [heap[parent], heap[position]] = [heap[position], heap[parent]];
    position = parent;
  }
}

function pop(heap: Collapse[]): Collapse | null {
  if (heap.length === 0) return null;
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return top;

  heap[0] = last;
  for (let position = 0; ;) {
    const left = position * 2 + 1;
    const right = left + 1;
    let smallest = position;
    if (left < heap.length && heap[left].cost < heap[smallest].cost) smallest = left;
    if (right < heap.length && heap[right].cost < heap[smallest].cost) smallest = right;
    if (smallest === position) return top;
    [heap[smallest], heap[position]] = [heap[position], heap[smallest]];
    position = smallest;
  }
}
