export type OrbitTrailPlanet = {
  id: number;
  position: [number, number, number];
  orbit: { kind: "ellipse"; semiMajorAxis: number; semiMinorAxis: number } | { kind: "circle"; radius: number; normal: [number, number, number] };
};

export type OrbitTrail = {
  length: number;
  opacity: number;
  points: [number, number, number][];
};

const MIN_TRAIL_LENGTH = 0.24;
const MAX_TRAIL_LENGTH = 0.9;
const MIN_TRAIL_OPACITY = 0.08;
const MAX_TRAIL_OPACITY = 0.24;

export function calculateOrbitTrail(planet: OrbitTrailPlanet, neighbors: readonly OrbitTrailPlanet[], segments = 12): OrbitTrail {
  const phase = orbitPhase(planet);
  const nearestAngle = neighbors
    .filter((neighbor) => neighbor.id !== planet.id && hasCompatibleOrbit(planet, neighbor))
    .map((neighbor) => angularDistance(phase, orbitPhase(neighbor)))
    .reduce((nearest, angle) => Math.min(nearest, angle), Math.PI);
  const normalizedSeparation = nearestAngle / Math.PI;
  const length = lerp(MIN_TRAIL_LENGTH, MAX_TRAIL_LENGTH, normalizedSeparation);
  const opacity = lerp(MIN_TRAIL_OPACITY, MAX_TRAIL_OPACITY, normalizedSeparation);
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const trailPhase = phase - length + (length * index) / segments;
    return orbitPoint(planet, trailPhase);
  });

  return { length, opacity, points };
}

function orbitPhase(planet: OrbitTrailPlanet): number {
  if (planet.orbit.kind === "circle") {
    const [major, minor] = circleAxes(planet.orbit.normal);
    const radial = normalize(planet.position);
    return Math.atan2(dot(radial, minor), dot(radial, major));
  }
  return Math.atan2(planet.position[2] / planet.orbit.semiMinorAxis, planet.position[0] / planet.orbit.semiMajorAxis);
}

function hasCompatibleOrbit(first: OrbitTrailPlanet, second: OrbitTrailPlanet): boolean {
  if (first.orbit.kind !== second.orbit.kind) return false;
  const firstRadius = first.orbit.kind === "ellipse" ? first.orbit.semiMajorAxis : first.orbit.radius;
  const secondRadius = second.orbit.kind === "ellipse" ? second.orbit.semiMajorAxis : second.orbit.radius;
  return Math.abs(firstRadius - secondRadius) / Math.max(firstRadius, secondRadius) <= 0.2;
}

function angularDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
}

function lerp(min: number, max: number, amount: number): number {
  return min + (max - min) * amount;
}

function orbitPoint(planet: OrbitTrailPlanet, phase: number): [number, number, number] {
  if (planet.orbit.kind === "ellipse") return [planet.orbit.semiMajorAxis * Math.cos(phase), 0, planet.orbit.semiMinorAxis * Math.sin(phase)];
  const [major, minor] = circleAxes(planet.orbit.normal);
  return add(scale(major, planet.orbit.radius * Math.cos(phase)), scale(minor, planet.orbit.radius * Math.sin(phase)));
}

function circleAxes(normal: [number, number, number]): [[number, number, number], [number, number, number]] {
  const major = normalize(Math.abs(normal[1]) < 0.9 ? cross([0, 1, 0], normal) : cross([1, 0, 0], normal));
  return [major, cross(normal, major)];
}

function cross([ax, ay, az]: [number, number, number], [bx, by, bz]: [number, number, number]): [number, number, number] {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function dot([ax, ay, az]: [number, number, number], [bx, by, bz]: [number, number, number]): number {
  return ax * bx + ay * by + az * bz;
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function scale([x, y, z]: [number, number, number], amount: number): [number, number, number] {
  return [x * amount, y * amount, z * amount];
}

function add([ax, ay, az]: [number, number, number], [bx, by, bz]: [number, number, number]): [number, number, number] {
  return [ax + bx, ay + by, az + bz];
}
