import { travelSkyProgress, type TravelFrame } from "./travelCoordinates";
import type { Vector3 } from "./universe/generateUniverse";

export type InterstellarSystem = {
  id: number;
  position: Vector3;
};

export type InterstellarMarker = {
  id: number;
  direction: Vector3;
  distance: number;
  brightness: number;
  opacity: number;
};

export type InterstellarPreviewArc = {
  edge: [number, number];
  from: Vector3;
  to: Vector3;
};

export const MINIMUM_MAP_BRIGHTNESS = 0.82;
export const OBSERVER_FADE_DISTANCE = 10_000_000_000_000;
// The physical distance scale (~1 light year) at which Distance Cue brightness reaches its
// midpoint between MINIMUM_MAP_BRIGHTNESS and full brightness. Exported so consumers that must
// recompute this same Distance Cue in a zero-allocation hot path (see celestialStarFieldModel.ts) use
// the identical constant instead of a drifting copy.
export const DISTANCE_CUE_DISTANCE = 9_460_000_000_000_000;

// The single Distance Cue brightness formula, shared by the plain marker projection and the
// zero-allocation star field hot path (see celestialStarFieldModel.ts) so the two can never drift apart.
export function distanceCueBrightness(distance: number): number {
  return MINIMUM_MAP_BRIGHTNESS + (1 - MINIMUM_MAP_BRIGHTNESS) / (1 + distance / DISTANCE_CUE_DISTANCE);
}

export function projectInterstellarProjection(systems: readonly InterstellarSystem[], observerPosition: Vector3): InterstellarMarker[] {
  return systems.map((system) => {
    const offset: Vector3 = [
      system.position[0] - observerPosition[0],
      system.position[1] - observerPosition[1],
      system.position[2] - observerPosition[2],
    ];
    const distance = Math.hypot(...offset);
    const opacity = Math.min(1, distance / OBSERVER_FADE_DISTANCE);

    return {
      id: system.id,
      direction: distance === 0 ? [0, 0, 0] : [offset[0] / distance, offset[1] / distance, offset[2] / distance],
      distance,
      brightness: distanceCueBrightness(distance),
      opacity,
    };
  });
}

export function projectInterstellarPreview(markers: readonly InterstellarMarker[], edges: readonly (readonly [number, number])[]): InterstellarPreviewArc[] {
  const markersById = new Map(markers.map((marker) => [marker.id, marker]));
  return edges.flatMap(([fromId, toId]) => {
    const from = markersById.get(fromId);
    const to = markersById.get(toId);
    return from && to ? [{ edge: [fromId, toId], from: from.direction, to: to.direction }] : [];
  });
}

export function projectInterstellarRouteDirection(systems: readonly InterstellarSystem[], originSystemId: number, destinationSystemId: number): Vector3 {
  const origin = systems.find((system) => system.id === originSystemId);
  if (!origin) return [0, 0, 0];

  return projectInterstellarProjection(systems, origin.position).find((marker) => marker.id === destinationSystemId)?.direction ?? [0, 0, 0];
}

export function resolveObserverPosition(systems: readonly InterstellarSystem[], activeSystemId: number, travel: TravelFrame | null, now: number): Vector3 | null {
  const activeSystem = systems.find((system) => system.id === activeSystemId);
  const origin = travel && systems.find((system) => system.id === travel.originSystemId);
  const destination = travel && systems.find((system) => system.id === travel.destinationSystemId);
  if (!travel || !origin || !destination) return activeSystem ? activeSystem.position : null;

  const progress = travelSkyProgress(travel, now);
  return [
    origin.position[0] + (destination.position[0] - origin.position[0]) * progress,
    origin.position[1] + (destination.position[1] - origin.position[1]) * progress,
    origin.position[2] + (destination.position[2] - origin.position[2]) * progress,
  ];
}

export function projectTravelInterstellarProjection(systems: readonly InterstellarSystem[], activeSystemId: number, travel: TravelFrame | null, now: number): InterstellarMarker[] {
  const observerPosition = resolveObserverPosition(systems, activeSystemId, travel, now);
  return observerPosition ? projectInterstellarProjection(systems, observerPosition) : [];
}
