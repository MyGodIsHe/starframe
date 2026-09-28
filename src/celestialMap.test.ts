import { describe, expect, it } from "vitest";
import { MINIMUM_MAP_BRIGHTNESS, projectCelestialMap } from "./celestialMap";

const systems = [
  { id: 1, name: "Active", constellationId: 10, regionId: 100, position: [10, 20, 30] as [number, number, number] },
  { id: 2, name: "East", constellationId: 10, regionId: 100, position: [14, 20, 30] as [number, number, number] },
  { id: 3, name: "North", constellationId: 10, regionId: 100, position: [10, 26, 30] as [number, number, number] },
  { id: 4, name: "Far", constellationId: 10, regionId: 100, position: [10, 20, 130] as [number, number, number] },
];

describe("projectCelestialMap", () => {
  it("projects every non-active system from the active system's SDE coordinates", () => {
    const markers = projectCelestialMap(systems, 1);

    expect(markers.map((marker) => marker.id)).toEqual([2, 3, 4]);
    expect(markers[0].direction).toEqual([1, 0, 0]);
    expect(markers[1].direction).toEqual([0, 1, 0]);
    expect(markers[2].direction).toEqual([0, 0, 1]);
  });

  it("dims distant systems without dropping below the map brightness floor", () => {
    const markers = projectCelestialMap(systems, 1);
    const east = markers.find((marker) => marker.id === 2);
    const far = markers.find((marker) => marker.id === 4);

    expect(east?.brightness).toBeGreaterThan(far?.brightness ?? 1);
    expect(far?.brightness).toBeGreaterThanOrEqual(MINIMUM_MAP_BRIGHTNESS);
  });

  it("recalculates directions when the active system changes", () => {
    const markers = projectCelestialMap(systems, 2);

    expect(markers.map((marker) => marker.id)).toEqual([1, 3, 4]);
    expect(markers.find((marker) => marker.id === 1)?.direction).toEqual([-1, 0, 0]);
  });
});
