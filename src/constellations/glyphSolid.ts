// The body a Constellation Glyph hides behind.
//
// Hidden-line removal needs a surface: a cage of lines has nothing to occlude with. So every closed
// stroke of a fitted Sigil Figure stands for a real solid, and the lines actually drawn are that
// solid's own edges. What a pilot sees is then a figure with a far side, not a sprite unrolled onto
// the sky.
//
// A body is built one of two ways, because a straight extrusion is a box seen edge on and half the
// library is not box-shaped. A `revolve` body is turned about the figure's upright, from the
// outline's own half-width, which is right for anything a potter could throw - a chalice, a tower,
// a beacon. A `bilateral` body keeps the front outline exactly and varies its thickness with height
// from an authored side view, so the front silhouette is the artwork and the side silhouette is the
// side view. Either way both silhouettes are real, and neither repeats the other.
//
// Everything is triangulated, so every face normal is exact and the facing test cannot be fooled by
// a warped quad. Triangulation leaves edges behind that hold the surface together but were never
// part of the drawing, so an edge carries whether it is drawn: a structural edge still occludes and
// still decides its neighbours' visibility, and is never emitted.
//
// Nothing here knows about the observer's camera. Visibility is decided from the observer's Solar
// System, in absolute space, which is the whole point: orbiting the camera cannot change which
// edges are hidden, and travelling between stars can. A glyph's vertices never move.

export type SolidPoint = readonly [number, number, number];
type PlanePoint = readonly [number, number];

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

// How finely a turned body is sampled, and how much of that sampling is drawn. The surface is cut
// fine so the facing test and the outline are accurate, and only a few of its meridians and rings
// are part of the drawing: a sigil is a handful of confident lines, and a full mesh reads as a
// wireframe model rather than as an emblem.
const LATHE_MERIDIANS = 12;
const LATHE_SECTIONS = 7;
const DRAWN_MERIDIAN_STEP = 3;
const DRAWN_RINGS = [0, 3, 6];

// Builds a body that keeps the outline exactly and varies its thickness along it, one half-depth
// per outline point. The front silhouette is therefore the authored artwork, unchanged, and the
// side silhouette is whatever the half-depths trace out.
export function buildBody(outline: readonly PlanePoint[], halfDepths: readonly number[]): GlyphSolid | null {
  const profile = closedProfile(outline);
  if (profile.length < 3) return null;

  // A counter-clockwise profile is what makes every outward normal point away from the body, and an
  // authored stroke may be wound either way.
  const forward = signedArea(profile) >= 0;
  const wound = forward ? profile : [...profile].reverse();
  const depths = alignDepths(outline, profile, halfDepths, forward);
  if (Math.abs(signedArea(wound)) <= DEGENERATE || depths.some((depth) => !(depth > 0))) return null;

  const count = wound.length;
  const vertices: SolidPoint[] = [
    ...wound.map(([x, y], index): SolidPoint => [x, y, -depths[index]]),
    ...wound.map(([x, y], index): SolidPoint => [x, y, depths[index]]),
  ];

  const cap = triangulate(wound);
  if (cap.length === 0) return null;

  const triangles: [number, number, number][] = [
    ...cap.map(([a, b, c]): [number, number, number] => [c, b, a]),
    ...cap.map(([a, b, c]): [number, number, number] => [count + a, count + b, count + c]),
  ];
  const drawn = new Set<string>();

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    triangles.push([index, next, count + next], [index, count + next, count + index]);
    // The outline, front and back, and the edges joining them: the drawing is these, and the
    // triangulation that fills the caps and splits the walls is not.
    drawn.add(edgeKey(index, next));
    drawn.add(edgeKey(count + index, count + next));
    drawn.add(edgeKey(index, count + index));
  }

  return solidFromTriangles(vertices, triangles, drawn);
}

// Builds a body turned about the figure's upright. The outline supplies the profile - its own
// half-width at each height - so a chalice drawn face on becomes a chalice from every side, and
// nothing about the figure has to be authored twice.
export function buildLathe(outline: readonly PlanePoint[], depthScale = 1): GlyphSolid | null {
  const profile = closedProfile(outline);
  if (profile.length < 3 || !(depthScale > 0)) return null;

  // The axis is the outline's own long direction, not the frame's vertical: a chalice that the fit
  // left leaning has to be turned about its own stem, or it comes out a bent tube that reads as a
  // leaf from the side. An outline with no clear long direction - a squat one - keeps the upright.
  const axis = principalAxis(profile);
  const across: PlanePoint = [-axis[1], axis[0]];
  const origin = centroidOf(profile);
  const along = profile.map((point): PlanePoint => [
    (point[0] - origin[0]) * across[0] + (point[1] - origin[1]) * across[1],
    (point[0] - origin[0]) * axis[0] + (point[1] - origin[1]) * axis[1],
  ]);

  const heights = along.map(([, height]) => height);
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  if (high - low <= DEGENERATE) return null;

  // The sections are pulled in from the extreme heights, where the outline's half-width collapses
  // to nothing and a ring would be a point.
  const sections: { height: number; centre: number; radius: number }[] = [];
  for (let step = 0; step < LATHE_SECTIONS; step += 1) {
    const height = low + ((high - low) * (step + 0.5)) / LATHE_SECTIONS;
    const span = spanAt(along, height);
    if (!span) return null;
    sections.push({ height, centre: (span[0] + span[1]) / 2, radius: Math.max((span[1] - span[0]) / 2, DEGENERATE) });
  }

  const vertices: SolidPoint[] = [];
  for (const section of sections) {
    for (let meridian = 0; meridian < LATHE_MERIDIANS; meridian += 1) {
      const angle = (2 * Math.PI * meridian) / LATHE_MERIDIANS;
      const offset = section.centre + section.radius * Math.cos(angle);
      vertices.push([
        origin[0] + axis[0] * section.height + across[0] * offset,
        origin[1] + axis[1] * section.height + across[1] * offset,
        section.radius * Math.sin(angle) * depthScale,
      ]);
    }
  }

  const triangles: [number, number, number][] = [];
  const drawn = new Set<string>();
  const at = (section: number, meridian: number) => section * LATHE_MERIDIANS + (meridian % LATHE_MERIDIANS);

  for (let section = 0; section + 1 < sections.length; section += 1) {
    for (let meridian = 0; meridian < LATHE_MERIDIANS; meridian += 1) {
      const a = at(section, meridian);
      const b = at(section, meridian + 1);
      const c = at(section + 1, meridian + 1);
      const d = at(section + 1, meridian);
      triangles.push([a, b, c], [a, c, d]);
      if (meridian % DRAWN_MERIDIAN_STEP === 0) drawn.add(edgeKey(a, d));
    }
  }
  for (const section of DRAWN_RINGS) {
    if (section >= sections.length) continue;
    for (let meridian = 0; meridian < LATHE_MERIDIANS; meridian += 1) drawn.add(edgeKey(at(section, meridian), at(section, meridian + 1)));
  }

  // Discs closing the two ends, so a ray down the axis meets the body instead of passing through.
  for (const [section, outward] of [[0, false], [sections.length - 1, true]] as const) {
    const hub = vertices.length;
    vertices.push([
      origin[0] + axis[0] * sections[section].height + across[0] * sections[section].centre,
      origin[1] + axis[1] * sections[section].height + across[1] * sections[section].centre,
      0,
    ]);
    for (let meridian = 0; meridian < LATHE_MERIDIANS; meridian += 1) {
      const a = at(section, meridian);
      const b = at(section, meridian + 1);
      triangles.push(outward ? [hub, a, b] : [hub, b, a]);
    }
  }

  return solidFromTriangles(vertices, triangles, drawn);
}

// A straight extrusion: the body every figure had before a side view existed, and still the right
// one for a figure that declares no symmetry of its own.
export function buildPrism(outline: readonly PlanePoint[], depth: number): GlyphSolid | null {
  if (!(depth > 0)) return null;
  return buildBody(outline, outline.map(() => depth));
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

// The horizontal span a closed outline covers at one height, from its own crossings of that line.
// A concave outline can cross more than twice; the extremes are what bound the body.
export function spanAt(profile: readonly PlanePoint[], y: number): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;

  for (let index = 0; index < profile.length; index += 1) {
    const from = profile[index];
    const to = profile[(index + 1) % profile.length];
    if ((from[1] > y) === (to[1] > y)) continue;
    const x = from[0] + ((to[0] - from[0]) * (y - from[1])) / (to[1] - from[1]);
    low = Math.min(low, x);
    high = Math.max(high, x);
  }

  return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : null;
}

// The direction an outline is longest in, by the principal axis of its own points. A figure is
// authored upright and the fit may only lean it a little, so an axis that has wandered far from
// the vertical means the outline has no long direction worth turning about, and the upright is kept.
const UPRIGHT_TOLERANCE = Math.cos(Math.PI / 4);

function principalAxis(profile: readonly PlanePoint[]): PlanePoint {
  const centre = centroidOf(profile);
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of profile) {
    const dx = point[0] - centre[0];
    const dy = point[1] - centre[1];
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  // Largest eigenvector of the symmetric 2x2 covariance, in closed form.
  const spread = Math.hypot(xx - yy, 2 * xy);
  if (spread <= DEGENERATE) return [0, 1];
  const largest = (xx + yy + spread) / 2;
  const raw: PlanePoint = Math.abs(xy) > DEGENERATE ? [largest - yy, xy] : xx >= yy ? [1, 0] : [0, 1];
  const size = Math.hypot(raw[0], raw[1]);
  if (size <= DEGENERATE) return [0, 1];

  const unit: PlanePoint = raw[1] >= 0 ? [raw[0] / size, raw[1] / size] : [-raw[0] / size, -raw[1] / size];
  return unit[1] >= UPRIGHT_TOLERANCE ? unit : [0, 1];
}

function centroidOf(profile: readonly PlanePoint[]): PlanePoint {
  let x = 0;
  let y = 0;
  for (const point of profile) {
    x += point[0] / profile.length;
    y += point[1] / profile.length;
  }
  return [x, y];
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

// Ear clipping, because a fan from the centre would lay triangles outside a concave outline and
// those would occlude sky the body does not fill.
function triangulate(profile: readonly PlanePoint[]): [number, number, number][] {
  const remaining = profile.map((_, index) => index);
  const triangles: [number, number, number][] = [];
  let attempts = profile.length * profile.length;

  while (remaining.length > 3 && attempts > 0) {
    attempts -= 1;
    let clipped = false;

    for (let position = 0; position < remaining.length; position += 1) {
      const previous = remaining[(position + remaining.length - 1) % remaining.length];
      const current = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      if (!isEar(profile, remaining, previous, current, next)) continue;

      triangles.push([previous, current, next]);
      remaining.splice(position, 1);
      clipped = true;
      break;
    }

    // A self-touching outline can leave no ear at all. Whatever has been clipped so far still makes
    // a usable cap, and the wall is what carries the silhouette.
    if (!clipped) break;
  }

  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

function isEar(profile: readonly PlanePoint[], remaining: readonly number[], previous: number, current: number, next: number): boolean {
  if (cross(profile[previous], profile[current], profile[next]) <= DEGENERATE) return false;

  for (const index of remaining) {
    if (index === previous || index === current || index === next) continue;
    if (isInside(profile[index], profile[previous], profile[current], profile[next])) return false;
  }
  return true;
}

function isInside(point: PlanePoint, a: PlanePoint, b: PlanePoint, c: PlanePoint): boolean {
  return cross(a, b, point) >= 0 && cross(b, c, point) >= 0 && cross(c, a, point) >= 0;
}

function cross(a: PlanePoint, b: PlanePoint, c: PlanePoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// An authored stroke closes a shape by repeating its first point, which would otherwise become a
// zero-length wall.
function closedProfile(outline: readonly PlanePoint[]): PlanePoint[] {
  const points = outline.filter((point, index) => index === 0 || Math.hypot(point[0] - outline[index - 1][0], point[1] - outline[index - 1][1]) > DEGENERATE);
  if (points.length < 2) return [];
  const [first] = points;
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= DEGENERATE ? points.slice(0, -1) : points;
}

// The half-depths arrive one per authored point, so they have to survive the same duplicate removal
// and rewinding the outline did.
function alignDepths(outline: readonly PlanePoint[], profile: readonly PlanePoint[], halfDepths: readonly number[], forward: boolean): number[] {
  const kept = outline
    .map((point, index) => ({ point, depth: halfDepths[index] ?? halfDepths[halfDepths.length - 1] }))
    .filter((entry, index) => index === 0 || Math.hypot(entry.point[0] - outline[index - 1][0], entry.point[1] - outline[index - 1][1]) > DEGENERATE)
    .slice(0, profile.length)
    .map((entry) => entry.depth);

  while (kept.length < profile.length) kept.push(kept[kept.length - 1] ?? 0);
  return forward ? kept : [...kept].reverse();
}

export function isClosedStroke(points: readonly PlanePoint[]): boolean {
  if (points.length < 4) return false;
  const [first] = points;
  const last = points[points.length - 1];
  return Math.hypot(first[0] - last[0], first[1] - last[1]) <= DEGENERATE;
}

function signedArea(profile: readonly PlanePoint[]): number {
  let total = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const next = (index + 1) % profile.length;
    total += profile[index][0] * profile[next][1] - profile[next][0] * profile[index][1];
  }
  return total / 2;
}

function edgeKey(from: number, to: number): string {
  return from < to ? `${from}:${to}` : `${to}:${from}`;
}
