import { describe, expect, it } from "vitest";
import {
  BACKGROUND_STAR_DIMMING,
  computePerspectiveHaloScale,
  computeStarVisualAttributes,
  createHaloColorBuffer,
  createSpectralColorBuffer,
  createStarFieldBuffers,
  FAR_STAR_DISTANCE,
  NEAR_STAR_DISTANCE,
  writeStarFieldFrame,
  type StarFieldQualityBudget,
  type StarFieldSystem,
} from "./celestialStarFieldModel";
import { MINIMUM_MAP_BRIGHTNESS, OBSERVER_FADE_DISTANCE, projectInterstellarProjection, resolveObserverPosition } from "./interstellarProjection";
import { desaturateTowardWhite, spectralClassColor } from "./spectralClass";
import { TRAVEL_DURATION } from "./travelCoordinates";

const DESKTOP_BUDGET: StarFieldQualityBudget = { haloMaxSize: 26, haloIntensity: 1, haloEdgeScaleMax: 1.8 };
const MOBILE_BUDGET: StarFieldQualityBudget = { haloMaxSize: 14, haloIntensity: 0.65, haloEdgeScaleMax: 1.45 };
function system(id: number, position: [number, number, number], spectralClass = "G2 V"): StarFieldSystem {
  return { id, position, spectralClass };
}

describe("computeStarVisualAttributes", () => {
  it("keeps every attribute within [0, 1] × its size budget across near, mid and far distances", () => {
    const distances = [0, NEAR_STAR_DISTANCE / 2, NEAR_STAR_DISTANCE, (NEAR_STAR_DISTANCE + FAR_STAR_DISTANCE) / 2, FAR_STAR_DISTANCE, FAR_STAR_DISTANCE * 4];

    for (const distance of distances) {
      const attributes = computeStarVisualAttributes(distance, 1, DESKTOP_BUDGET);
      expect(attributes.coreOpacity).toBeGreaterThanOrEqual(0);
      expect(attributes.coreOpacity).toBeLessThanOrEqual(1);
      expect(attributes.haloOpacity).toBeGreaterThanOrEqual(0);
      expect(attributes.haloOpacity).toBeLessThanOrEqual(1);
      expect(attributes.coreSize).toBeGreaterThan(0);
      expect(attributes.haloSize).toBeGreaterThan(0);
      expect(attributes.haloSize).toBeLessThanOrEqual(DESKTOP_BUDGET.haloMaxSize);
    }
  });

  it("gives near systems the most distinct core and mid systems a balanced core/halo", () => {
    const near = computeStarVisualAttributes(NEAR_STAR_DISTANCE / 4, 1, DESKTOP_BUDGET);
    const mid = computeStarVisualAttributes((NEAR_STAR_DISTANCE + FAR_STAR_DISTANCE) / 2, 1, DESKTOP_BUDGET);
    const far = computeStarVisualAttributes(FAR_STAR_DISTANCE * 2, 1, DESKTOP_BUDGET);

    expect(near.coreOpacity).toBeGreaterThan(mid.coreOpacity);
    expect(mid.coreOpacity).toBeGreaterThan(far.coreOpacity);
    expect(near.haloSize).toBeLessThan(mid.haloSize);
    expect(mid.haloSize).toBeLessThan(far.haloSize);
    expect(near.haloOpacity).toBeLessThan(far.haloOpacity);
  });

  it("changes continuously across the near and far thresholds instead of jumping", () => {
    for (const threshold of [NEAR_STAR_DISTANCE, FAR_STAR_DISTANCE]) {
      const before = computeStarVisualAttributes(threshold - 1_000_000, 1, DESKTOP_BUDGET);
      const at = computeStarVisualAttributes(threshold, 1, DESKTOP_BUDGET);
      const after = computeStarVisualAttributes(threshold + 1_000_000, 1, DESKTOP_BUDGET);

      expect(Math.abs(before.coreSize - at.coreSize)).toBeLessThan(0.01);
      expect(Math.abs(at.coreSize - after.coreSize)).toBeLessThan(0.01);
      expect(Math.abs(before.haloSize - at.haloSize)).toBeLessThan(0.01);
      expect(Math.abs(at.haloSize - after.haloSize)).toBeLessThan(0.01);
    }
  });

  it("preserves Minimum Map Brightness through the visual attribute mix", () => {
    // The dimmest possible real system: at MINIMUM_MAP_BRIGHTNESS with full observer-fade opacity.
    const attributes = computeStarVisualAttributes(FAR_STAR_DISTANCE * 10, MINIMUM_MAP_BRIGHTNESS, DESKTOP_BUDGET);

    // Must stay comfortably clear of the decorative background stars' fixed opacity ceiling (see
    // SpaceScene.tsx's DECORATIVE_STAR_MAX_OPACITY, which takes the same dimming) on both budgets.
    expect(attributes.coreOpacity).toBeGreaterThan(0.4 * BACKGROUND_STAR_DIMMING);
    expect(computeStarVisualAttributes(FAR_STAR_DISTANCE * 10, MINIMUM_MAP_BRIGHTNESS, MOBILE_BUDGET).haloOpacity).toBeGreaterThan(0.4 * BACKGROUND_STAR_DIMMING);
  });

  it("hands a star only its dimmed share of the brightness the Distance Cue asked for", () => {
    // The brightest a star can be drawn: right next to the observer, at full Distance Cue
    // brightness. Even there the core keeps a fifth of its light back for the Glyph Stars in front
    // of it, and the far end of the ramp keeps the same fifth back rather than a different one.
    expect(computeStarVisualAttributes(0, 1, DESKTOP_BUDGET).coreOpacity).toBeCloseTo(BACKGROUND_STAR_DIMMING);
    expect(computeStarVisualAttributes(FAR_STAR_DISTANCE * 10, 1, DESKTOP_BUDGET).coreOpacity).toBeCloseTo(0.55 * BACKGROUND_STAR_DIMMING);
    expect(computeStarVisualAttributes(FAR_STAR_DISTANCE * 10, 1, DESKTOP_BUDGET).haloOpacity).toBeCloseTo(DESKTOP_BUDGET.haloIntensity * BACKGROUND_STAR_DIMMING);
  });

  it("reuses a scratch object across calls without leaking state between systems", () => {
    const scratch = { coreSize: 0, coreOpacity: 0, haloSize: 0, haloOpacity: 0 };
    computeStarVisualAttributes(NEAR_STAR_DISTANCE / 4, 1, DESKTOP_BUDGET, scratch);
    const near = { ...scratch };
    computeStarVisualAttributes(FAR_STAR_DISTANCE * 2, 1, DESKTOP_BUDGET, scratch);

    expect(scratch).not.toEqual(near);
  });
});

describe("computePerspectiveHaloScale", () => {
  it("preserves halo coverage as perspective spreads angular density away from the optical axis", () => {
    expect(computePerspectiveHaloScale(1, DESKTOP_BUDGET.haloEdgeScaleMax)).toBe(1);

    const viewCosine = 0.9;
    const scale = computePerspectiveHaloScale(viewCosine, DESKTOP_BUDGET.haloEdgeScaleMax);
    expect(scale * scale * viewCosine ** 3).toBeCloseTo(1, 10);
  });

  it("caps edge growth using the active quality budget", () => {
    expect(computePerspectiveHaloScale(0.25, MOBILE_BUDGET.haloEdgeScaleMax)).toBe(MOBILE_BUDGET.haloEdgeScaleMax);
  });
});

describe("writeStarFieldFrame", () => {
  it("computes direction and distance from a single observer position, matching projectInterstellarProjection", () => {
    const systems = [system(1, [10, 20, 30]), system(2, [14, 20, 30]), system(3, [10, 26, 30])];
    const observerPosition: [number, number, number] = [10, 20, 30];
    const buffers = createStarFieldBuffers(systems.length);

    writeStarFieldFrame(systems, observerPosition, DESKTOP_BUDGET, buffers);
    const markers = projectInterstellarProjection(systems, observerPosition);

    for (const [index, marker] of markers.entries()) {
      const CELESTIAL_MAP_RADIUS = 24;
      expect(buffers.positions[index * 3]).toBeCloseTo(marker.direction[0] * CELESTIAL_MAP_RADIUS);
      expect(buffers.positions[index * 3 + 1]).toBeCloseTo(marker.direction[1] * CELESTIAL_MAP_RADIUS);
      expect(buffers.positions[index * 3 + 2]).toBeCloseTo(marker.direction[2] * CELESTIAL_MAP_RADIUS);
    }
  });

  it("does not change an existing system's attributes when an unrelated far system is added", () => {
    const observerPosition: [number, number, number] = [0, 0, 0];
    const near = system(1, [NEAR_STAR_DISTANCE, 0, 0]);
    const withoutFar = createStarFieldBuffers(1);
    const withFar = createStarFieldBuffers(2);

    writeStarFieldFrame([near], observerPosition, DESKTOP_BUDGET, withoutFar);
    writeStarFieldFrame([near, system(2, [FAR_STAR_DISTANCE * 100, 0, 0])], observerPosition, DESKTOP_BUDGET, withFar);

    expect(withFar.positions.slice(0, 3)).toEqual(withoutFar.positions.slice(0, 3));
    expect(withFar.coreOpacities[0]).toBeCloseTo(withoutFar.coreOpacities[0]);
    expect(withFar.haloOpacities[0]).toBeCloseTo(withoutFar.haloOpacities[0]);
  });

  it("fades a system exactly at the observer position to zero without NaN or Infinity", () => {
    const observerPosition: [number, number, number] = [1_000_000, 2_000_000, 3_000_000];
    const buffers = createStarFieldBuffers(1);

    writeStarFieldFrame([system(1, observerPosition)], observerPosition, DESKTOP_BUDGET, buffers);

    for (const array of [buffers.positions, buffers.coreOpacities, buffers.coreSizes, buffers.haloOpacities, buffers.haloSizes]) {
      for (const value of array) expect(Number.isFinite(value)).toBe(true);
    }
    expect(buffers.coreOpacities[0]).toBe(0);
    expect(buffers.haloOpacities[0]).toBe(0);
  });

  it("matches the destination's stationary projection at the final deceleration frame, through the same observer-resolution path the renderer uses", () => {
    const origin = system(1, [0, 0, 0]);
    const destination = system(2, [100_000_000_000, 0, 0]);
    const other = system(3, [50_000_000_000, 40_000_000_000, 0]);
    const systems = [origin, destination, other];
    const travel = { originSystemId: 1, destinationSystemId: 2, routeDirection: [100_000_000_000, 0, 0] as [number, number, number], phase: "decelerating" as const, startedAt: 1_000 };

    const finalFrame = createStarFieldBuffers(systems.length);
    const stationary = createStarFieldBuffers(systems.length);
    const finalObserverPosition = resolveObserverPosition(systems, 2, travel, 1_000 + TRAVEL_DURATION)!;
    const stationaryObserverPosition = resolveObserverPosition(systems, 2, null, 0)!;
    writeStarFieldFrame(systems, finalObserverPosition, DESKTOP_BUDGET, finalFrame);
    writeStarFieldFrame(systems, stationaryObserverPosition, DESKTOP_BUDGET, stationary);

    expect(finalFrame.positions).toEqual(stationary.positions);
    expect(finalFrame.coreOpacities).toEqual(stationary.coreOpacities);
    expect(finalFrame.haloOpacities).toEqual(stationary.haloOpacities);
  });

  it("applies desktop and mobile quality budgets without excluding any real system", () => {
    const observerPosition: [number, number, number] = [0, 0, 0];
    const systems = [system(1, [NEAR_STAR_DISTANCE, 0, 0]), system(2, [FAR_STAR_DISTANCE * 5, 0, 0]), system(3, [FAR_STAR_DISTANCE * 50, 0, 0])];

    const desktopBuffers = createStarFieldBuffers(systems.length);
    const mobileBuffers = createStarFieldBuffers(systems.length);
    writeStarFieldFrame(systems, observerPosition, DESKTOP_BUDGET, desktopBuffers);
    writeStarFieldFrame(systems, observerPosition, MOBILE_BUDGET, mobileBuffers);

    expect(desktopBuffers.coreSizes).toHaveLength(systems.length);
    expect(mobileBuffers.coreSizes).toHaveLength(systems.length);
    expect(mobileBuffers.haloSizes[1]).toBeLessThan(desktopBuffers.haloSizes[1]);
    expect(mobileBuffers.haloOpacities[1]).toBeLessThan(desktopBuffers.haloOpacities[1]);
    for (const size of mobileBuffers.haloSizes) expect(size).toBeLessThanOrEqual(MOBILE_BUDGET.haloMaxSize);
  });
});

describe("createSpectralColorBuffer", () => {
  it("writes each system's spectral color at its own stable slot", () => {
    const systems = [system(1, [0, 0, 0], "O5 V"), system(2, [0, 0, 0], "M2 V")];
    const colors = createSpectralColorBuffer(systems);

    expect([...colors.slice(0, 3)]).toEqual([...Float32Array.from(spectralClassColor("O5 V"))]);
    expect([...colors.slice(3, 6)]).toEqual([...Float32Array.from(spectralClassColor("M2 V"))]);
  });
});

describe("createHaloColorBuffer", () => {
  it("gives halo the star's own spectral color, desaturated rather than an unrelated random tint", () => {
    const systems = [system(1, [0, 0, 0], "M2 V")];
    const core = createSpectralColorBuffer(systems);
    const halo = createHaloColorBuffer(systems);

    // Same hue direction (not a different, arbitrary color)...
    expect(Math.sign(halo[0] - halo[2])).toBe(Math.sign(core[0] - core[2]));
    // ...but pulled measurably closer to white than the core color.
    const coreDistanceFromWhite = (1 - core[0]) + (1 - core[1]) + (1 - core[2]);
    const haloDistanceFromWhite = (1 - halo[0]) + (1 - halo[1]) + (1 - halo[2]);
    expect(haloDistanceFromWhite).toBeLessThan(coreDistanceFromWhite);
  });

  it("matches desaturateTowardWhite directly", () => {
    const systems = [system(1, [0, 0, 0], "K3 V")];
    expect([...createHaloColorBuffer(systems)]).toEqual([...Float32Array.from(desaturateTowardWhite(spectralClassColor("K3 V"), 0.45))]);
  });
});

describe("OBSERVER_FADE_DISTANCE re-export sanity", () => {
  it("stays a positive physical distance", () => {
    expect(OBSERVER_FADE_DISTANCE).toBeGreaterThan(0);
  });
});
