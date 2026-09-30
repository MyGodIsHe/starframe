// The body a Constellation Glyph hides behind.
//
// Hidden-line removal needs a surface: a cage of lines has nothing to occlude with. So every closed
// stroke of a fitted Sigil Figure stands for a real solid - a prism through the Glyph Frame - and
// the lines actually drawn are that prism's own edges. What a pilot sees is then a figure with a
// far side, not a sprite unrolled onto the sky.
//
// Nothing here knows about the observer's camera. Visibility is decided from the observer's Solar
// System, in absolute space, which is the whole point: orbiting the camera cannot change which
// edges are hidden, and travelling between stars can. A glyph's vertices never move.

export type SolidPoint = readonly [number, number, number];

export type SolidFace = {
  /** Indices into the solid's vertices, wound counter-clockwise seen from outside. */
  vertices: readonly number[];
  /** Unit outward normal. */
  normal: SolidPoint;
  /** A point on the face, for the facing test. */
  centre: SolidPoint;
};

export type SolidEdge = {
  from: number;
  to: number;
  /** The faces this edge borders. A prism is closed, so there are always exactly two. */
  faces: readonly [number, number];
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

// Builds the prism a closed outline stands for, extruded symmetrically about the Glyph Frame's
// plane so the real Solar Systems the anchors landed on stay at the body's waist rather than on
// its front or back face.
export function buildPrism(outline: readonly (readonly [number, number])[], depth: number): GlyphSolid | null {
  const profile = closedProfile(outline);
  if (profile.length < 3 || depth <= 0) return null;

  // A counter-clockwise profile is what makes every side normal point outward rather than into the
  // body, and an authored stroke may be wound either way.
  const wound = signedArea(profile) >= 0 ? profile : [...profile].reverse();
  if (Math.abs(signedArea(wound)) <= DEGENERATE) return null;

  const count = wound.length;
  const vertices: SolidPoint[] = [
    ...wound.map(([x, y]): SolidPoint => [x, y, -depth]),
    ...wound.map(([x, y]): SolidPoint => [x, y, depth]),
  ];

  // Face 0 is the back cap, face 1 the front cap, and face 2 + i the wall on outline edge i. The
  // caps are wound outward, which for the back cap means reversing the profile's own order.
  const faces: SolidFace[] = [
    { vertices: Array.from({ length: count }, (_, index) => count - 1 - index), normal: [0, 0, -1], centre: centroid(vertices.slice(0, count)) },
    { vertices: Array.from({ length: count }, (_, index) => count + index), normal: [0, 0, 1], centre: centroid(vertices.slice(count)) },
  ];

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const dx = wound[next][0] - wound[index][0];
    const dy = wound[next][1] - wound[index][1];
    const size = Math.hypot(dx, dy);
    if (size <= DEGENERATE) return null;
    const wall = [index, next, count + next, count + index];
    faces.push({ vertices: wall, normal: [dy / size, -dx / size, 0], centre: centroid(wall.map((vertex) => vertices[vertex])) });
  }

  const edges: SolidEdge[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    edges.push({ from: index, to: next, faces: [0, 2 + index] });
    edges.push({ from: count + index, to: count + next, faces: [1, 2 + index] });
    edges.push({ from: index, to: count + index, faces: [2 + (index + count - 1) % count, 2 + index] });
  }

  return { vertices, faces, edges };
}

// Which edges an observer can see. The test is per face - a face is front-facing when the observer
// is on its outward side - and an edge is hidden only when both the faces it borders are turned
// away. For a convex body this is exact hidden-line removal; for a concave one it keeps the
// outline honest and errs towards drawing a line rather than losing one, which is the right way to
// err for a glyph that must never look partial.
export function classifyEdges(solid: GlyphSolid, observer: SolidPoint): EdgeVisibility[] {
  const frontFacing = solid.faces.map((face) => isFrontFacing(face, observer));

  return solid.edges.map((edge) => {
    const [left, right] = edge.faces;
    if (frontFacing[left] && frontFacing[right]) return "interior";
    if (frontFacing[left] || frontFacing[right]) return "silhouette";
    return "hidden";
  });
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
    vertices: solid.vertices.map(mapPosition),
    faces: solid.faces.map((face) => ({ vertices: face.vertices, normal: mapDirection(face.normal), centre: mapPosition(face.centre) })),
    edges: solid.edges,
  };
}

// An authored stroke closes a shape by repeating its first point, which would otherwise become a
// zero-length wall.
function closedProfile(outline: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const points = outline.filter((point, index) => index === 0 || Math.hypot(point[0] - outline[index - 1][0], point[1] - outline[index - 1][1]) > DEGENERATE);
  if (points.length < 2) return [];
  const [first] = points;
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= DEGENERATE ? points.slice(0, -1) : points;
}

export function isClosedStroke(points: readonly (readonly [number, number])[]): boolean {
  if (points.length < 4) return false;
  const [first] = points;
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= DEGENERATE;
}

function signedArea(profile: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const next = (index + 1) % profile.length;
    total += profile[index][0] * profile[next][1] - profile[next][0] * profile[index][1];
  }
  return total / 2;
}

function centroid(points: readonly SolidPoint[]): SolidPoint {
  const sum: [number, number, number] = [0, 0, 0];
  for (const point of points) for (let axis = 0; axis < 3; axis += 1) sum[axis] += point[axis] / points.length;
  return sum;
}
