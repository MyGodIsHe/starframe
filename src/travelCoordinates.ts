import { Vector3 } from "three";

export const ACCELERATION_DURATION = 2_600;
export const DECELERATION_DURATION = 2_600;
export const TRAVEL_DURATION = ACCELERATION_DURATION + DECELERATION_DURATION;
export const SYSTEM_POINT_DISTANCE = 480;

export type TravelPhase = "accelerating" | "decelerating";
export type TravelFrame = { phase: TravelPhase; originSystemId: number; destinationSystemId: number; routeDirection: [number, number, number]; startedAt: number };

export function travelSystemOffset(travel: TravelFrame | null, now: number, offset = new Vector3()): Vector3 {
  if (!travel) return offset.set(0, 0, 0);

  const direction = offset.fromArray(travel.routeDirection);
  if (direction.lengthSq() === 0) return offset.set(0, 0, 0);
  const progress = travelSkyProgress(travel, now);
  const distance = travel.phase === "accelerating"
    ? SYSTEM_POINT_DISTANCE * Math.min(1, progress / 0.125)
    : SYSTEM_POINT_DISTANCE * Math.min(1, (1 - progress) / 0.125);
  return direction.normalize().multiplyScalar(travel.phase === "accelerating" ? -distance : distance);
}

export function localDetailOpacity(systemDistance: number): number {
  return Math.min(1, Math.max(0, (110 - systemDistance) / 70));
}

export function travelSkyProgress(travel: TravelFrame | null, now: number): number {
  if (!travel) return 0;
  const progress = Math.min(1, Math.max(0, (now - travel.startedAt) / TRAVEL_DURATION));
  return progress <= 0.5 ? 2 * progress * progress : 1 - 2 * (1 - progress) * (1 - progress);
}
