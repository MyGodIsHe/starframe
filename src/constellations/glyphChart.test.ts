import { describe, expect, it } from "vitest";
import { buildGlyphChart, chartAngularRadius, chartDirection } from "./glyphChart";

type System = { id: number; position: [number, number, number] };

const OBSERVER: [number, number, number] = [0, 0, 0];

const SQUARE: System[] = [
  { id: 1, position: [100, -10, -10] },
  { id: 2, position: [100, -10, 10] },
  { id: 3, position: [100, 10, -10] },
  { id: 4, position: [100, 10, 10] },
];

describe("buildGlyphChart", () => {
  it("normalises the members into the unit circle with the farthest one on it", () => {
    const chart = buildGlyphChart(SQUARE, OBSERVER)!;
    const radii = chart.points.map((point) => Math.hypot(point.x, point.y));

    expect(Math.max(...radii)).toBeCloseTo(1);
    expect(Math.min(...radii)).toBeGreaterThan(0);
  });

  it("keeps every member, identified by system id", () => {
    const chart = buildGlyphChart(SQUARE, OBSERVER)!;

    expect(chart.points.map((point) => point.systemId).sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
  });

  it("round-trips a chart point back to the direction of its own Solar System", () => {
    const chart = buildGlyphChart(SQUARE, OBSERVER)!;

    for (const point of chart.points) {
      const system = SQUARE.find((entry) => entry.id === point.systemId)!;
      const length = Math.hypot(...system.position);
      const expected = system.position.map((coordinate) => coordinate / length);
      const actual = chartDirection(chart, point.x, point.y);

      for (let axis = 0; axis < 3; axis += 1) expect(actual[axis]).toBeCloseTo(expected[axis], 9);
    }
  });

  it("maps a straight chart line onto a great circle, not a chord through the sphere", () => {
    const chart = buildGlyphChart(SQUARE, OBSERVER)!;
    const midpoint = chartDirection(chart, 0, 0);

    expect(Math.hypot(midpoint[0], midpoint[1], midpoint[2])).toBeCloseTo(1);
  });

  it("orients by the galactic axis, so the chart does not roll as the observer shifts", () => {
    const first = buildGlyphChart(SQUARE, [0, 0, 0])!;
    const second = buildGlyphChart(SQUARE, [0, 0.5, 0])!;

    // The up axis stays on the same side of the galactic vertical rather than flipping.
    expect(first.up[1] * second.up[1]).toBeGreaterThan(0);
    expect(first.up[0] * second.up[0] + first.up[1] * second.up[1] + first.up[2] * second.up[2]).toBeGreaterThan(0.99);
  });

  it("reports how wide the chart is on the sky", () => {
    const near = buildGlyphChart(SQUARE, OBSERVER)!;
    const far = buildGlyphChart(SQUARE.map((system) => ({ ...system, position: [system.position[0] * 10, system.position[1], system.position[2]] as [number, number, number] })), OBSERVER)!;

    expect(chartAngularRadius(near)).toBeGreaterThan(chartAngularRadius(far));
  });

  it("gives up rather than inventing a chart when the observer is surrounded", () => {
    const surrounding: System[] = [
      { id: 1, position: [10, 0, 0] },
      { id: 2, position: [-10, 0, 0] },
      { id: 3, position: [0, 10, 0] },
      { id: 4, position: [0, -10, 0] },
    ];

    expect(buildGlyphChart(surrounding, OBSERVER)).toBeNull();
  });

  it("gives up on fewer than two usable directions", () => {
    expect(buildGlyphChart([{ id: 1, position: [10, 0, 0] }], OBSERVER)).toBeNull();
    expect(buildGlyphChart([{ id: 1, position: [0, 0, 0] }, { id: 2, position: [10, 0, 0] }], OBSERVER)).toBeNull();
  });
});
