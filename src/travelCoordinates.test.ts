import { describe, expect, it } from "vitest";
import { ACCELERATION_DURATION, DECELERATION_DURATION, SYSTEM_POINT_DISTANCE, localDetailOpacity, travelSkyProgress, travelSystemOffset } from "./travelCoordinates";

const routeDirection: [number, number, number] = [5, 0, 0];
const startedAt = 1_000;
const route = { originSystemId: 1, destinationSystemId: 2, routeDirection };

describe("travelSystemOffset", () => {
  it("moves the accelerating system out during the first quarter of the journey", () => {
    const travel = { ...route, phase: "accelerating" as const, startedAt };

    expect(travelSystemOffset(travel, startedAt).length()).toBe(0);
    expect(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION / 2).x).toBeCloseTo(-SYSTEM_POINT_DISTANCE);
    expect(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION).x).toBeCloseTo(-SYSTEM_POINT_DISTANCE);
    expect(localDetailOpacity(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION).length())).toBe(0);
  });

  it("keeps the destination distant until the final quarter, then brings it in", () => {
    const travel = { ...route, phase: "decelerating" as const, startedAt };

    expect(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION).x).toBeCloseTo(SYSTEM_POINT_DISTANCE);
    expect(localDetailOpacity(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION).length())).toBe(0);
    expect(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION + DECELERATION_DURATION / 2).x).toBeCloseTo(SYSTEM_POINT_DISTANCE);
    expect(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION + DECELERATION_DURATION * 3 / 4).x).toBeCloseTo(SYSTEM_POINT_DISTANCE / 4);
    expect(travelSystemOffset(travel, startedAt + ACCELERATION_DURATION + DECELERATION_DURATION).length()).toBe(0);
  });

  it("uses constant acceleration followed by constant deceleration for the sky", () => {
    const accelerating = { ...route, phase: "accelerating" as const, startedAt };
    const decelerating = { ...route, phase: "decelerating" as const, startedAt };

    expect(travelSkyProgress(accelerating, startedAt)).toBe(0);
    expect(travelSkyProgress(accelerating, startedAt + ACCELERATION_DURATION / 2)).toBeCloseTo(0.125);
    expect(travelSkyProgress(accelerating, startedAt + ACCELERATION_DURATION)).toBeCloseTo(0.5);
    expect(travelSkyProgress(decelerating, startedAt + ACCELERATION_DURATION + DECELERATION_DURATION / 2)).toBeCloseTo(0.875);
    expect(travelSkyProgress(decelerating, startedAt + ACCELERATION_DURATION + DECELERATION_DURATION)).toBe(1);
  });

  it("keeps sky speed continuous at the midpoint", () => {
    const travel = { ...route, phase: "accelerating" as const, startedAt };
    const midpoint = startedAt + ACCELERATION_DURATION;
    const frame = 10;
    const speedBefore = travelSkyProgress(travel, midpoint) - travelSkyProgress(travel, midpoint - frame);
    const speedAfter = travelSkyProgress(travel, midpoint + frame) - travelSkyProgress(travel, midpoint);

    expect(speedBefore).toBeCloseTo(speedAfter, 5);
  });
});
