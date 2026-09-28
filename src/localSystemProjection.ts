import type { PhysicalPlanet } from "./planets/projectPlanets";

export const LOCAL_SYSTEM_SCENE_UNITS_PER_METER = 1 / 1_000_000_000_000;

type Star = { id: number; typeId: number; radius: number; spectralClass: string };
type Gate = { id: number; position: [number, number, number]; destinationName: string; destinationSystemId?: number };

export type LocalSystemProjection = {
  metersPerSceneUnit: number;
  star: { physical: Star; physicalRadius: number; sceneRadius: number } | null;
  planets: { physical: PhysicalPlanet; scenePosition: [number, number, number]; sceneRadius: number; markerSize: number; orbit: { kind: "sde-ellipse"; semiMajorAxis: number; semiMinorAxis: number; sceneNormal: [number, number, number] } | { kind: "position-circle"; radius: number; sceneNormal: [number, number, number] } }[];
  gates: { physical: Gate; scenePosition: [number, number, number] }[];
};

export function projectLocalSystem({ star, planets, gates }: { star: Star | null; planets: readonly PhysicalPlanet[]; gates: readonly Gate[] }, sceneUnitsPerMeter: number): LocalSystemProjection {
  return {
    metersPerSceneUnit: 1 / sceneUnitsPerMeter,
    star: star && { physical: star, physicalRadius: star.radius, sceneRadius: star.radius * sceneUnitsPerMeter },
    planets: planets.map((planet) => {
      const fallbackPosition = scale(planet.position, sceneUnitsPerMeter);
      const orbit = planet.orbit
        ? sdeEllipse(planet.position, planet.orbit, sceneUnitsPerMeter)
        : positionCircle(fallbackPosition);
      return {
        physical: { ...planet, position: [...planet.position] as [number, number, number] },
        scenePosition: orbit.scenePosition,
        sceneRadius: (planet.radius ?? 0) * sceneUnitsPerMeter,
        markerSize: 8,
        orbit: orbit.context,
      };
    }),
    gates: gates.map((gate) => ({
      physical: { ...gate, position: [...gate.position] as [number, number, number] },
      scenePosition: scale(gate.position, sceneUnitsPerMeter),
    })),
  };
}

function scale([x, y, z]: [number, number, number], factor: number): [number, number, number] {
  return [x * factor, y * factor, z * factor];
}

function sdeEllipse([x, , z]: [number, number, number], orbit: NonNullable<PhysicalPlanet["orbit"]>, sceneUnitsPerMeter: number): { scenePosition: [number, number, number]; context: Extract<LocalSystemProjection["planets"][number]["orbit"], { kind: "sde-ellipse" }> } {
  const semiMajorAxis = orbit.radius * sceneUnitsPerMeter;
  const semiMinorAxis = semiMajorAxis * Math.sqrt(1 - orbit.eccentricity * orbit.eccentricity);
  const bearing = Math.atan2(z, x);
  const phase = Math.atan2(semiMajorAxis * Math.sin(bearing), semiMinorAxis * Math.cos(bearing));
  return {
    scenePosition: [semiMajorAxis * Math.cos(phase), 0, semiMinorAxis * Math.sin(phase)],
    context: { kind: "sde-ellipse", semiMajorAxis, semiMinorAxis, sceneNormal: [0, -1, 0] },
  };
}

function positionCircle(scenePosition: [number, number, number]): { scenePosition: [number, number, number]; context: Extract<LocalSystemProjection["planets"][number]["orbit"], { kind: "position-circle" }> } {
  const radius = Math.hypot(...scenePosition);
  const horizontalLength = Math.hypot(scenePosition[0], scenePosition[2]);
  const sceneNormal: [number, number, number] = horizontalLength === 0 ? [0, 0, 1] : [-scenePosition[2] / horizontalLength, 0, scenePosition[0] / horizontalLength];
  return { scenePosition, context: { kind: "position-circle", radius, sceneNormal } };
}
