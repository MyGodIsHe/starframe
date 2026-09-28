import { describe, expect, it } from "vitest";
import { createAmbientFlightTrailState, sampleAmbientFlightTrail, updateAmbientFlightTrail, type AmbientFlightTrailPoint } from "./ambientFlightTrails";

const POINTS: AmbientFlightTrailPoint[] = [
  { id: "star", position: [0, 0, 0] },
  { id: "planet:1", position: [2, 0, 0] },
  { id: "gate:2", position: [0, 3, 0] },
];

describe("ambient flight trails", () => {
  it("produces the same schedule and routes for the same system seed", () => {
    const first = createAmbientFlightTrailState(30002187, "desktop");
    const second = createAmbientFlightTrailState(30002187, "desktop");

    for (let time = 0; time <= 60; time += 0.1) {
      expect(updateAmbientFlightTrail(first, POINTS, time)).toEqual(updateAmbientFlightTrail(second, POINTS, time));
    }
  });

  it("keeps the head and fading tail on the selected route", () => {
    const trail = {
      from: POINTS[0],
      to: POINTS[1],
      startedAt: 5,
      duration: 1,
      tailFraction: 0.2,
    };

    expect(sampleAmbientFlightTrail(trail, 5)).toEqual({ head: [0, 0, 0], tail: [0, 0, 0], opacity: 0 });
    expect(sampleAmbientFlightTrail(trail, 5.5)).toEqual({ head: [1, 0, 0], tail: [0.6, 0, 0], opacity: 1 });
    expect(sampleAmbientFlightTrail(trail, 6)).toEqual({ head: [2, 0, 0], tail: [1.6, 0, 0], opacity: 0 });
  });

  it("allows a route between any two distinct points regardless of distance", () => {
    const state = createAmbientFlightTrailState(1, "desktop");
    const closePoints: AmbientFlightTrailPoint[] = [
      { id: "one", position: [0, 0, 0] },
      { id: "two", position: [0.1, 0, 0] },
    ];

    expect(updateAmbientFlightTrail(state, closePoints, 2)).not.toBeNull();
  });

  it("keeps a due event available while points of interest are still loading", () => {
    const delayed = createAmbientFlightTrailState(30002187, "desktop");
    const ready = createAmbientFlightTrailState(30002187, "desktop");

    expect(updateAmbientFlightTrail(delayed, [], 12.7)).toBeNull();
    expect(updateAmbientFlightTrail(delayed, POINTS, 12.7)).toEqual(updateAmbientFlightTrail(ready, POINTS, 12.7));
  });

  it("drops stale or invalid time instead of replaying an unbounded schedule", () => {
    const state = createAmbientFlightTrailState(42, "desktop");

    expect(updateAmbientFlightTrail(state, POINTS, Number.POSITIVE_INFINITY)).toBeNull();
    expect(updateAmbientFlightTrail(state, POINTS, 1e20)).toBeNull();
    expect(updateAmbientFlightTrail(state, POINTS, 60 * 60)).toBeNull();
    expect(Array.from({ length: 251 }, (_, index) => updateAmbientFlightTrail(state, POINTS, 60 * 60 + index / 10)).some(Boolean)).toBe(true);
  });

  it("shows brief trails with the requested frequent cadence", () => {
    const state = createAmbientFlightTrailState(42, "desktop");
    let activeSamples = 0;
    let appearances = 0;
    let wasActive = false;

    for (let time = 0; time <= 30; time += 0.1) {
      const active = updateAmbientFlightTrail(state, POINTS, time) !== null;
      if (active) activeSamples += 1;
      if (active && !wasActive) appearances += 1;
      wasActive = active;
    }

    expect(appearances).toBeGreaterThanOrEqual(9);
    expect(appearances).toBeLessThanOrEqual(18);
    expect(activeSamples).toBeLessThan(150);
  });
});
