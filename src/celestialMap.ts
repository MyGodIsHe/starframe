import { projectInterstellarProjection, MINIMUM_MAP_BRIGHTNESS, type InterstellarMarker, type InterstellarSystem } from "./interstellarProjection";

export type CelestialMapSystem = InterstellarSystem;
export type CelestialMapMarker = InterstellarMarker;
export { MINIMUM_MAP_BRIGHTNESS };

export function projectCelestialMap(systems: readonly CelestialMapSystem[], activeSystemId: number): CelestialMapMarker[] {
  const activeSystem = systems.find((system) => system.id === activeSystemId);
  if (!activeSystem) return [];

  return projectInterstellarProjection(systems, activeSystem.position).filter((marker) => marker.opacity > 0);
}
