import { describe, expect, it } from "vitest";
import { projectLocalSystem } from "./localSystemProjection";

describe("projectLocalSystem", () => {
  it("projects star, planets, and gates with one physical meters-to-scene scale", () => {
    const source = {
      star: { id: 1, typeId: 10, radius: 20, spectralClass: "G2 V" },
      planets: [{ id: 2, typeId: 20, position: [100, 0, 0] as [number, number, number], radius: 4 }],
      gates: [
        { id: 3, position: [0, 200, 0] as [number, number, number], destinationName: "Next" },
        { id: 4, position: [400, 0, 0] as [number, number, number], destinationName: "Far" },
      ],
    };

    const projected = projectLocalSystem(source, 0.01);

    expect(projected.metersPerSceneUnit).toBe(100);
    expect(projected.star).toMatchObject({ physicalRadius: 20, sceneRadius: 0.2 });
    expect(projected.planets[0]).toMatchObject({ physical: source.planets[0], scenePosition: [1, 0, 0], sceneRadius: 0.04 });
    expect(projected.gates[0]).toEqual({ physical: source.gates[0], scenePosition: [0, 2, 0] });
    expect(projected.gates[1]).toEqual({ physical: source.gates[1], scenePosition: [4, 0, 0] });
  });

  it("keeps accessibility aid sizes separate from physical dimensions", () => {
    const projected = projectLocalSystem({
      star: null,
      planets: [
        { id: 1, typeId: 10, position: [100, 0, 0], radius: 1 },
        { id: 2, typeId: 11, position: [200, 0, 0], radius: 10 },
      ],
      gates: [],
    }, 0.01);

    expect(projected.planets.map((planet) => planet.sceneRadius)).toEqual([0.01, 0.1]);
    expect(projected.planets.map((planet) => planet.markerSize)).toEqual([8, 8]);
  });

  it("projects SDE elliptical orbits onto the shared Solar System Map plane", () => {
    const source = {
      star: null,
      planets: [{ id: 1, typeId: 10, position: [100, 100, 100] as [number, number, number], radius: 1, orbit: { radius: 200, eccentricity: 0.6 } }],
      gates: [],
    };

    const planet = projectLocalSystem(source, 0.01).planets[0];

    expect(planet.physical.position).toEqual([100, 100, 100]);
    expect(planet.scenePosition[0]).toBeCloseTo(1.24939, 5);
    expect(planet.scenePosition[1]).toBe(0);
    expect(planet.scenePosition[2]).toBeCloseTo(1.24939, 5);
    expect(planet.orbit).toEqual({ kind: "sde-ellipse", semiMajorAxis: 2, semiMinorAxis: 1.6, sceneNormal: [0, -1, 0] });
  });

  it("keeps the positional projection when SDE orbit statistics are unavailable", () => {
    const planet = projectLocalSystem({
      star: null,
      planets: [{ id: 1, typeId: 10, position: [100, 200, 300], radius: 1 }],
      gates: [],
    }, 0.01).planets[0];

    expect(planet.scenePosition).toEqual([1, 2, 3]);
    expect(planet.orbit.kind).toBe("position-circle");
    if (planet.orbit.kind !== "position-circle") throw new Error("Expected position-circle fallback");
    expect(planet.orbit.sceneNormal[0]).toBeCloseTo(-0.9486832981, 10);
    expect(planet.orbit.sceneNormal[2]).toBeCloseTo(0.316227766, 10);
    expect(planet.orbit.radius).toBeCloseTo(3.7416573868, 10);
  });

});
