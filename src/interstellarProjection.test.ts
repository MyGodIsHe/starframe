import { describe, expect, it } from "vitest";
import { OBSERVER_FADE_DISTANCE, projectInterstellarPreview, projectInterstellarProjection, projectInterstellarRouteDirection, projectTravelInterstellarProjection } from "./interstellarProjection";
import { TRAVEL_DURATION } from "./travelCoordinates";

const systems = [
  { id: 1, position: [9_000_000_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000] as [number, number, number] },
  { id: 2, position: [9_000_100_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000] as [number, number, number] },
  { id: 3, position: [9_000_050_000_000_000, -3_999_950_000_000_000, 8_000_000_000_000_000] as [number, number, number] },
];

describe("projectInterstellarProjection", () => {
  it("projects SDE systems from the pilot's physical midpoint between systems", () => {
    const markers = projectInterstellarProjection(systems, [9_000_050_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000]);

    expect(markers.find((marker) => marker.id === 1)?.direction).toEqual([-1, 0, 0]);
    expect(markers.find((marker) => marker.id === 2)?.direction).toEqual([1, 0, 0]);
    expect(markers.find((marker) => marker.id === 3)?.direction).toEqual([0, 1, 0]);
  });

  it("reports each system's physical observer-relative distance alongside its direction", () => {
    const observerPosition: [number, number, number] = [9_000_050_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000];
    const markers = projectInterstellarProjection(systems, observerPosition);

    expect(markers.find((marker) => marker.id === 1)?.distance).toBeCloseTo(50_000_000_000);
    expect(markers.find((marker) => marker.id === 2)?.distance).toBeCloseTo(50_000_000_000);
    expect(markers.find((marker) => marker.id === 3)?.distance).toBeCloseTo(50_000_000_000);
  });

  it("matches the destination's stationary projection at the final deceleration frame", () => {
    const finalArrivalFrame = projectTravelInterstellarProjection(systems, 2, {
      originSystemId: 1,
      destinationSystemId: 2,
      routeDirection: [100_000_000_000, 0, 0],
      phase: "decelerating",
      startedAt: 1_000,
    }, 1_000 + TRAVEL_DURATION);
    const stationaryDestination = projectInterstellarProjection(systems, systems[1].position);

    expect(finalArrivalFrame).toEqual(stationaryDestination);
  });

  it("smoothly fades the system at the observer without invalid coordinates while other markers remain on the celestial radius", () => {
    const markers = projectInterstellarProjection(systems, systems[0].position);
    const observer = markers.find((marker) => marker.id === 1);
    const destination = markers.find((marker) => marker.id === 2);
    const approachingObserver = projectInterstellarProjection(systems, [systems[0].position[0] + OBSERVER_FADE_DISTANCE / 2, systems[0].position[1], systems[0].position[2]])
      .find((marker) => marker.id === 1);

    expect(observer).toMatchObject({ direction: [0, 0, 0], opacity: 0 });
    expect(observer?.direction.every(Number.isFinite)).toBe(true);
    expect(approachingObserver?.opacity).toBeCloseTo(0.5);
    expect(destination?.opacity).toBeGreaterThan(0);
    expect(Math.hypot(...(destination?.direction ?? [0, 0, 0]))).toBeCloseTo(1);
  });

  it("calculates a system's Distance Cue from its own distance", () => {
    const nearSystem = { id: 2, position: [9_009_460_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000] as [number, number, number] };
    const distantSystem = { id: 3, position: [9_473_000_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000] as [number, number, number] };
    const observer = systems[0].position;
    const withoutDistantSystem = projectInterstellarProjection([systems[0], nearSystem], observer);
    const withDistantSystem = projectInterstellarProjection([systems[0], nearSystem, distantSystem], observer);

    expect(withoutDistantSystem.find((marker) => marker.id === 2)?.brightness)
      .toBeCloseTo(withDistantSystem.find((marker) => marker.id === 2)?.brightness ?? 0);
  });

  it("uses Celestial Map marker positions for Jump Preview Tree arc endpoints", () => {
    const observerPosition: [number, number, number] = [9_000_050_000_000_000, -4_000_000_000_000_000, 8_000_000_000_000_000];
    const markers = projectInterstellarProjection(systems, observerPosition);
    const arcs = projectInterstellarPreview(markers, [[1, 3], [3, 2]]);

    expect(arcs).toEqual([
      { edge: [1, 3], from: [-1, 0, 0], to: [0, 1, 0] },
      { edge: [3, 2], from: [0, 1, 0], to: [1, 0, 0] },
    ]);
  });

  it("keeps Jump Preview Tree endpoints aligned with an intermediate travel frame", () => {
    const travel = {
      originSystemId: 1,
      destinationSystemId: 2,
      routeDirection: [100_000_000_000, 0, 0] as [number, number, number],
      phase: "accelerating" as const,
      startedAt: 0,
    };
    const markers = projectTravelInterstellarProjection(systems, 1, travel, 400);
    const arcs = projectInterstellarPreview(markers, [[1, 3], [3, 2]]);

    expect(arcs.map((arc) => arc.from)).toEqual([markers[0].direction, markers[2].direction]);
    expect(arcs.map((arc) => arc.to)).toEqual([markers[2].direction, markers[1].direction]);
  });

  it("uses the destination Celestial Map direction as the local-system far-point direction", () => {
    const routeDirection = projectInterstellarRouteDirection(systems, 1, 2);

    expect(routeDirection).toEqual([1, 0, 0]);
  });
});
