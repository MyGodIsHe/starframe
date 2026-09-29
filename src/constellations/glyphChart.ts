import type { Vector3 } from "../universe/generateUniverse";

// The flat sky plane a glyph is drawn in. The observer sits at the centre of the Celestial Map
// sphere, so a glyph never has parallax of its own - what a pilot sees is always a flat pattern on
// the dome. Building the figure in that plane is therefore not an approximation of the 3D cloud,
// it is the thing being looked at.
//
// The chart is a gnomonic projection onto the plane tangent at the constellation's mean direction.
// Gnomonic maps great circles to straight lines, so a spherical convex hull becomes an ordinary 2D
// convex hull and straight chart strokes come back as arcs lying on the dome.
export type GlyphChartPoint = {
  systemId: number;
  x: number;
  y: number;
  distance: number;
};

export type GlyphChart = {
  center: Vector3;
  right: Vector3;
  up: Vector3;
  offsetX: number;
  offsetY: number;
  scale: number;
  points: GlyphChartPoint[];
};

type ChartSystem = {
  id: number;
  position: Vector3;
};

// EVE's vertical axis. Projected into the tangent plane it gives every chart the same sense of
// "up", which is what keeps a sigil from rolling as the observer moves.
const GALACTIC_UP: Vector3 = [0, 1, 0];
const DEGENERATE_UP = 1e-6;

export function buildGlyphChart(systems: readonly ChartSystem[], observerPosition: Vector3): GlyphChart | null {
  const directions: { systemId: number; direction: Vector3; distance: number }[] = [];
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  for (const system of systems) {
    const dx = system.position[0] - observerPosition[0];
    const dy = system.position[1] - observerPosition[1];
    const dz = system.position[2] - observerPosition[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance === 0) continue;
    const direction: Vector3 = [dx / distance, dy / distance, dz / distance];
    directions.push({ systemId: system.id, direction, distance });
    sumX += direction[0];
    sumY += direction[1];
    sumZ += direction[2];
  }

  if (directions.length < 2) return null;

  const meanLength = Math.hypot(sumX, sumY, sumZ);
  if (meanLength === 0) return null;
  const center: Vector3 = [sumX / meanLength, sumY / meanLength, sumZ / meanLength];

  const up = tangentUp(center, directions[0].direction);
  if (!up) return null;
  const right = cross(up, center);

  const raw: { systemId: number; x: number; y: number; distance: number }[] = [];
  for (const entry of directions) {
    const forward = dot(entry.direction, center);
    // A member more than a right angle off the chart centre has no gnomonic image at all. It only
    // happens when the observer stands inside the constellation, which is drawn a different way.
    if (forward <= DEGENERATE_UP) return null;
    const scaled: Vector3 = [entry.direction[0] / forward, entry.direction[1] / forward, entry.direction[2] / forward];
    raw.push({ systemId: entry.systemId, x: dot(scaled, right), y: dot(scaled, up), distance: entry.distance });
  }

  let offsetX = 0;
  let offsetY = 0;
  for (const point of raw) {
    offsetX += point.x / raw.length;
    offsetY += point.y / raw.length;
  }

  let scale = 0;
  for (const point of raw) scale = Math.max(scale, Math.hypot(point.x - offsetX, point.y - offsetY));
  if (scale <= 0) return null;

  return {
    center,
    right,
    up,
    offsetX,
    offsetY,
    scale,
    points: raw.map((point) => ({
      systemId: point.systemId,
      x: (point.x - offsetX) / scale,
      y: (point.y - offsetY) / scale,
      distance: point.distance,
    })),
  };
}

// Chart coordinates back to a direction in the sky. Straight lines in the chart come back as great
// circles, so a stroke lies on the dome instead of cutting a chord through it.
export function chartDirection(chart: GlyphChart, x: number, y: number): Vector3 {
  const planeX = chart.offsetX + x * chart.scale;
  const planeY = chart.offsetY + y * chart.scale;
  const point: Vector3 = [
    chart.center[0] + chart.right[0] * planeX + chart.up[0] * planeY,
    chart.center[1] + chart.right[1] * planeX + chart.up[1] * planeY,
    chart.center[2] + chart.right[2] * planeX + chart.up[2] * planeY,
  ];
  const length = Math.hypot(point[0], point[1], point[2]) || 1;
  return [point[0] / length, point[1] / length, point[2] / length];
}

// How wide one chart unit is on the sky, used to decide how finely a stroke has to be subdivided
// before its straight chord visibly leaves the dome.
export function chartAngularRadius(chart: GlyphChart): number {
  return Math.atan(chart.scale);
}

function tangentUp(center: Vector3, fallbackDirection: Vector3): Vector3 | null {
  const projected = rejectFrom(GALACTIC_UP, center);
  if (Math.hypot(projected[0], projected[1], projected[2]) > DEGENERATE_UP) return normalize(projected);

  // Looking straight along the galactic axis there is no projected "up" left, so the lowest-id
  // member takes over - still deterministic, and it only ever happens at the poles.
  const alternative = rejectFrom(fallbackDirection, center);
  if (Math.hypot(alternative[0], alternative[1], alternative[2]) > DEGENERATE_UP) return normalize(alternative);
  return null;
}

function rejectFrom(vector: Vector3, axis: Vector3): Vector3 {
  const projection = dot(vector, axis);
  return [vector[0] - axis[0] * projection, vector[1] - axis[1] * projection, vector[2] - axis[2] * projection];
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
