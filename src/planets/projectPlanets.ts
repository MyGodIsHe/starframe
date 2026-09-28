export type PhysicalPlanet = {
  id: number;
  name?: string;
  typeId: number;
  position: [number, number, number];
  radius?: number;
  orbit?: { radius: number; eccentricity: number };
};

export type ProjectedPlanet = {
  physical: PhysicalPlanet;
  display: {
    position: [number, number, number];
    distance: number;
    displayRadius: number;
    markerSize: number;
    trailDirection: [number, number, number];
  };
};

const MARKER_SIZE = 8;

export function projectPlanets(planets: readonly PhysicalPlanet[]): ProjectedPlanet[] {
  const distances = planets.map((planet) => vectorLength(planet.position));
  const furthestDistance = Math.max(...distances, 1);

  return planets.map((planet, index) => {
    const distance = distances[index];
    const radialDirection = normalize(planet.position);
    const displayDistance = 2.5 + (distance / furthestDistance) * 8;
    const trailDirection = normalize([-radialDirection[2], 0, radialDirection[0]]);

    return {
      physical: { ...planet, position: [...planet.position] as [number, number, number] },
      display: {
        position: scale(radialDirection, displayDistance),
        distance,
        displayRadius: ((planet.radius ?? 0) / furthestDistance) * 10,
        markerSize: MARKER_SIZE,
        trailDirection,
      },
    };
  });
}

function vectorLength([x, y, z]: [number, number, number]): number {
  return Math.hypot(x, y, z);
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = vectorLength(vector);
  return length === 0 ? [1, 0, 0] : scale(vector, 1 / length);
}

function scale([x, y, z]: [number, number, number], factor: number): [number, number, number] {
  return [x * factor || 0, y * factor || 0, z * factor || 0];
}
