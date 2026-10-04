import { describe, expect, it } from "vitest";
import { DISTANCE_CUE_DISTANCE } from "./interstellarProjection";
import {
  SHOCKWAVE_LUMP_AMPLITUDE,
  SHOCKWAVE_MAGNITUDE_FLOOR,
  SHOCKWAVE_SPAN_FAR,
  SHOCKWAVE_SPAN_NEAR,
  battleShockwaveBrightness,
  battleShockwaveFront,
  battleShockwaveFrontProximity,
  battleShockwaveLumpFactor,
  battleShockwaveLumps,
  battleShockwaveSpan,
  battleShockwaveTint,
  battleShockwaveWorldRadius,
} from "./battleShockwave";

const LIGHT_YEAR = DISTANCE_CUE_DISTANCE;
// Half of all gate neighbours in New Eden stand within about a light year of each other, which is
// the distance "a battle one jump away" means throughout these tests.
const NEIGHBOUR_DISTANCE = 0.95 * LIGHT_YEAR;
const CLUSTER_DISTANCE = 27 * LIGHT_YEAR;
const CELESTIAL_MAP_RADIUS = 24;
const DEFAULT_VERTICAL_FOV = (75 * Math.PI) / 180;

function luminance([r, g, b]: readonly [number, number, number]): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

describe("battleShockwaveSpan", () => {
  it("fills about half the viewport height for a battle one jump away", () => {
    const span = battleShockwaveSpan(NEIGHBOUR_DISTANCE, 0.5);

    expect(span).toBeGreaterThan(0.4);
    expect(span).toBeLessThan(0.65);
  });

  it("leaves a battle across the cluster a small ring, an order of magnitude smaller", () => {
    const near = battleShockwaveSpan(NEIGHBOUR_DISTANCE, 0.5);
    const far = battleShockwaveSpan(CLUSTER_DISTANCE, 0.5);

    expect(far).toBeGreaterThan(0);
    expect(far * 5).toBeLessThan(near);
  });

  it("shrinks monotonically with distance and never leaves its authored range", () => {
    let previous = Infinity;
    for (const lightYears of [0, 0.1, 0.5, 1, 2, 5, 12, 27, 65]) {
      const span = battleShockwaveSpan(lightYears * LIGHT_YEAR, 1);
      expect(span).toBeLessThan(previous);
      expect(span).toBeGreaterThanOrEqual(SHOCKWAVE_SPAN_FAR * SHOCKWAVE_MAGNITUDE_FLOOR);
      expect(span).toBeLessThanOrEqual(SHOCKWAVE_SPAN_NEAR);
      previous = span;
    }
  });

  it("gives a bigger ship a bigger wave at the same distance, without taking a small one to nothing", () => {
    const small = battleShockwaveSpan(NEIGHBOUR_DISTANCE, 0);
    const large = battleShockwaveSpan(NEIGHBOUR_DISTANCE, 1);

    expect(small).toBeGreaterThan(large * 0.5);
    expect(small).toBeLessThan(large);
  });

  it("falls off on the Distance Cue's own scale: one light year is its midpoint", () => {
    const midpoint = battleShockwaveSpan(DISTANCE_CUE_DISTANCE, 1);

    expect(midpoint).toBeCloseTo(SHOCKWAVE_SPAN_FAR + (SHOCKWAVE_SPAN_NEAR - SHOCKWAVE_SPAN_FAR) / 2, 5);
  });
});

describe("battleShockwaveWorldRadius", () => {
  it("turns a half-viewport span into a quad half as tall as what the view spans at that radius", () => {
    const visibleHeight = 2 * CELESTIAL_MAP_RADIUS * Math.tan(DEFAULT_VERTICAL_FOV / 2);
    const radius = battleShockwaveWorldRadius(0.5, CELESTIAL_MAP_RADIUS, DEFAULT_VERTICAL_FOV);

    expect(radius * 2).toBeCloseTo(visibleHeight * 0.5, 5);
  });

  it("keeps a span the same share of the view when the field of view changes", () => {
    const span = 0.5;
    for (const fov of [45, 60, 75, 100]) {
      const radians = (fov * Math.PI) / 180;
      const visibleHeight = 2 * CELESTIAL_MAP_RADIUS * Math.tan(radians / 2);
      expect(battleShockwaveWorldRadius(span, CELESTIAL_MAP_RADIUS, radians) * 2 / visibleHeight).toBeCloseTo(span, 5);
    }
  });
});

describe("battleShockwaveFront", () => {
  it("expands outward and thickens as it dissipates", () => {
    let previousRadius = -Infinity;
    let previousThickness = -Infinity;
    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const front = battleShockwaveFront(progress);
      expect(front.radius).toBeGreaterThan(previousRadius);
      expect(front.thickness).toBeGreaterThan(previousThickness);
      previousRadius = front.radius;
      previousThickness = front.thickness;
    }
  });

  it("decelerates: it is always ahead of a linear ramp, and every step is shorter than the last", () => {
    const reach = battleShockwaveFront(1).radius - battleShockwaveFront(0).radius;
    let previousStep = Infinity;

    for (let step = 1; step <= 10; step += 1) {
      const progress = step / 10;
      const travelled = (battleShockwaveFront(progress).radius - battleShockwaveFront(0).radius) / reach;
      if (progress < 1) expect(travelled).toBeGreaterThan(progress);

      const stepLength = travelled - (battleShockwaveFront(progress - 0.1).radius - battleShockwaveFront(0).radius) / reach;
      expect(stepLength).toBeLessThan(previousStep);
      previousStep = stepLength;
    }
  });

  it("stays inside its own billboard, lumps and all, so the front is never clipped by the quad's edge", () => {
    const widest = Math.max(...Array.from({ length: 64 }, (_, seed) => Math.max(
      ...Array.from({ length: 360 }, (_, degree) => battleShockwaveLumpFactor(battleShockwaveLumps(seed), (degree * Math.PI) / 180)),
    )));

    expect(battleShockwaveFront(1).radius * widest).toBeLessThan(1);
    expect(battleShockwaveFront(5).radius).toEqual(battleShockwaveFront(1).radius);
  });
});

describe("battleShockwaveLumps", () => {
  it("leans a front out of round without stopping it reading as one shell", () => {
    const lumps = battleShockwaveLumps(7);
    const factors = Array.from({ length: 360 }, (_, degree) => battleShockwaveLumpFactor(lumps, (degree * Math.PI) / 180));

    expect(Math.min(...factors)).toBeGreaterThan(1 - 4 * SHOCKWAVE_LUMP_AMPLITUDE);
    expect(Math.max(...factors)).toBeLessThan(1 + 4 * SHOCKWAVE_LUMP_AMPLITUDE);
    expect(Math.max(...factors) - Math.min(...factors)).toBeGreaterThan(0.01);
    // The harmonics only move light around the front; they never swell or shrink the wave overall.
    expect(factors.reduce((total, factor) => total + factor, 0) / factors.length).toBeCloseTo(1, 6);
  });

  it("gives one Explosion Event the same shape every time and different events different shapes", () => {
    expect(battleShockwaveLumps(42)).toEqual(battleShockwaveLumps(42));
    expect(battleShockwaveLumps(42)).not.toEqual(battleShockwaveLumps(43));
  });
});

describe("battleShockwaveBrightness", () => {
  it("peaks on the front itself, wherever the front happens to stand", () => {
    for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const { radius: front, thickness } = battleShockwaveFront(progress);
      const onFront = battleShockwaveBrightness(front, progress);

      expect(onFront).toBeGreaterThan(battleShockwaveBrightness(front - thickness * 2, progress));
      expect(onFront).toBeGreaterThan(battleShockwaveBrightness(front + thickness * 0.8, progress));
    }
  });

  it("drains inward rather than outward, which is what gives the wave a direction", () => {
    const progress = 0.5;
    const { radius: front, thickness } = battleShockwaveFront(progress);
    const behind = battleShockwaveBrightness(front - thickness, progress);
    const ahead = battleShockwaveBrightness(front + thickness, progress);

    expect(behind).toBeGreaterThan(ahead * 3);
  });

  it("hollows out: the centre burns while the wave is young and goes dark once it has left", () => {
    expect(battleShockwaveBrightness(0, 0.02)).toBeGreaterThan(0.2);
    expect(battleShockwaveBrightness(0, 0.7)).toBeLessThan(0.05);
  });

  it("dims as it spreads, and is gone when its wave phase ends", () => {
    let previous = Infinity;
    for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const peak = battleShockwaveBrightness(battleShockwaveFront(progress).radius, progress);
      expect(peak).toBeLessThan(previous);
      previous = peak;
    }

    expect(battleShockwaveBrightness(battleShockwaveFront(1).radius, 1)).toBeCloseTo(0, 5);
  });
});

describe("battleShockwaveTint", () => {
  it("burns white on a young front and carries the Tier colour through the body of the shell", () => {
    const front = battleShockwaveTint(3, battleShockwaveFrontProximity(battleShockwaveFront(0.05).radius, 0.05), 0.05);
    const body = battleShockwaveTint(3, 0.5, 0.05);

    expect(Math.min(...front)).toBeGreaterThan(0.8);
    expect(body[0]).toBeGreaterThan(body[1] * 2);
    expect(luminance(front)).toBeGreaterThan(luminance(body));
  });

  it("leaves a trail behind the front that is already cooler than the front itself", () => {
    const progress = 0.3;
    const front = battleShockwaveTint(2, 1, progress);
    const trail = battleShockwaveTint(2, 0.05, progress);

    expect(luminance(trail)).toBeLessThan(luminance(front));
  });

  it("cools the whole front from white through the Tier colour into ember as it expands", () => {
    let previous = Infinity;
    for (const progress of [0.05, 0.3, 0.6, 0.9]) {
      const brightness = luminance(battleShockwaveTint(3, 1, progress));
      expect(brightness).toBeLessThan(previous);
      previous = brightness;
    }

    const old = battleShockwaveTint(3, 1, 0.95);
    expect(old[0]).toBeGreaterThan(old[1]);
  });

  it("gives every Tier a front hotter than its own colour and a trail deeper than it", () => {
    for (const tier of [1, 2, 3] as const) {
      const front = luminance(battleShockwaveTint(tier, 1, 0));
      const trail = luminance(battleShockwaveTint(tier, 0, 0));

      expect(front).toBeGreaterThan(trail * 2);
    }
  });
});
