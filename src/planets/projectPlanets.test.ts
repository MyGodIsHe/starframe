import { describe, expect, it } from "vitest";
import { projectPlanets } from "./projectPlanets";

const planets = [
  { id: 11, name: "Amarr I", typeId: 2014, position: [20_000_000, 0, 0] as [number, number, number], radius: 1_000 },
  { id: 12, name: "Amarr II", typeId: 2015, position: [0, 80_000_000, 0] as [number, number, number], radius: 9_000 },
];

describe("projectPlanets", () => {
  it("preserves physical values while placing more distant planets farther from the star", () => {
    const projected = projectPlanets(planets);

    expect(projected.map((planet) => planet.physical)).toEqual(planets);
    expect(projected[0].display.distance).toBeLessThan(projected[1].display.distance);
  });

  it("uses a constant schematic marker independent from physical radius", () => {
    const projected = projectPlanets(planets);

    expect(projected.map((planet) => planet.display.markerSize)).toEqual([8, 8]);
  });

  it("assigns stable tangential trail directions", () => {
    const firstVisit = projectPlanets(planets);
    const secondVisit = projectPlanets(planets);

    expect(firstVisit.map((planet) => planet.display.trailDirection)).toEqual(secondVisit.map((planet) => planet.display.trailDirection));
    expect(firstVisit[0].display.trailDirection).toEqual([0, 0, 1]);
  });
});
