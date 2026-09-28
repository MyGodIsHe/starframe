import { describe, expect, it } from "vitest";
import type { BattleWindow } from "./battleSimulation";
import { eventOffset, eventsAliveAt, explosionPhaseAt, type ExplosionEvent } from "./battleExplosions";

function makeWindow(overrides: Partial<BattleWindow> = {}): BattleWindow {
  return {
    systemId: 1,
    seed: 12_345,
    startedAt: 0,
    tier: 3,
    riseDuration: 0,
    plateauDuration: 300_000,
    decayDuration: 0,
    anchorCount: 1,
    ...overrides,
  };
}

describe("battle explosions", () => {
  it("is deterministic for the same window/time/stream", () => {
    const window = makeWindow();
    expect(eventsAliveAt(window, 60_000, 0)).toEqual(eventsAliveAt(window, 60_000, 0));
  });

  it("gives independent streams (anchors) different events", () => {
    const window = makeWindow();
    expect(eventsAliveAt(window, 60_000, 1)).not.toEqual(eventsAliveAt(window, 60_000, 2));
  });

  it("keeps each tier's explosion rate in the right ballpark", () => {
    const expectedPerMinute: Record<1 | 2 | 3, number> = { 1: 5, 2: 22, 3: 100 };

    for (const tier of [1, 2, 3] as const) {
      const window = makeWindow({ tier });
      const startedTicks = new Set<number>();

      for (let time = 0; time <= window.plateauDuration; time += 150) {
        for (const event of eventsAliveAt(window, time, 0)) {
          if (event.startedAt === time) startedTicks.add(event.tickIndex);
        }
      }

      const perMinute = startedTicks.size / (window.plateauDuration / 60_000);
      expect(perMinute).toBeGreaterThan(expectedPerMinute[tier] * 0.5);
      expect(perMinute).toBeLessThan(expectedPerMinute[tier] * 1.5);
    }
  });

  it("can hold several overlapping events alive at once during a busy plateau", () => {
    const window = makeWindow({ tier: 3 });
    const counts = Array.from({ length: 200 }, (_, index) => eventsAliveAt(window, 100_000 + index * 150, 0).length);

    expect(Math.max(...counts)).toBeGreaterThan(1);
  });

  it("moves an event through flash, then wave, then scar, then nothing", () => {
    const event: ExplosionEvent = { tickIndex: 0, startedAt: 1_000, magnitude: 0.5 };

    expect(explosionPhaseAt(event, 500)).toBeNull();
    expect(explosionPhaseAt(event, 1_000)?.phase).toBe("flash");
    expect(explosionPhaseAt(event, 1_139)?.phase).toBe("flash");
    expect(explosionPhaseAt(event, 1_140)?.phase).toBe("wave");

    const wave = explosionPhaseAt(event, 1_140);
    expect(wave?.progress).toBeCloseTo(0);

    const midWave = explosionPhaseAt(event, 1_140 + 750);
    expect(midWave?.phase).toBe("wave");
    expect(midWave!.progress).toBeGreaterThan(0);
    expect(midWave!.progress).toBeLessThan(1);

    const scarStart = 1_140 + 1_450; // FLASH_MS(140) + WAVE_MS(lerp 700..2200 @ 0.5 = 1450)
    expect(explosionPhaseAt(event, scarStart)?.phase).toBe("scar");
    expect(explosionPhaseAt(event, scarStart + 19_000 - 1)?.phase).toBe("scar"); // SCAR_MS @ 0.5 = lerp(10000,28000,0.5) = 19000
    expect(explosionPhaseAt(event, scarStart + 19_000 + 1)).toBeNull();
  });

  it("scales wave and scar duration up with magnitude — bigger ships leave longer traces", () => {
    const small: ExplosionEvent = { tickIndex: 0, startedAt: 0, magnitude: 0 };
    const large: ExplosionEvent = { tickIndex: 0, startedAt: 0, magnitude: 1 };

    // Small ship's whole lifecycle (140 + 700 + 10000 = 10840ms) has already ended...
    expect(explosionPhaseAt(small, 10_840)).toBeNull();
    // ...while the same instant is still deep in the large ship's wave/scar (140 + 2200 + 28000).
    expect(explosionPhaseAt(large, 10_840)).not.toBeNull();
  });

  it("gives distinct events distinct, bounded offsets around an anchor", () => {
    const window = makeWindow();
    const spreadRadius = 2;
    const eventA: ExplosionEvent = { tickIndex: 10, startedAt: 1_500, magnitude: 0.4 };
    const eventB: ExplosionEvent = { tickIndex: 11, startedAt: 1_650, magnitude: 0.4 };

    const offsetA = eventOffset(window, eventA, 0, spreadRadius);
    const offsetB = eventOffset(window, eventB, 0, spreadRadius);
    expect(offsetA).not.toEqual(offsetB);
    expect(eventOffset(window, eventA, 0, spreadRadius)).toEqual(offsetA);

    for (const offset of [offsetA, offsetB]) {
      expect(Math.hypot(...offset)).toBeLessThanOrEqual(spreadRadius);
    }
  });
});
