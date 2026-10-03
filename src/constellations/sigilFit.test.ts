import { describe, expect, it } from "vitest";
import { frameFigure, framingsFor, placePoint, turnCost, FIGURE_EXTENT, MAX_TILT, type ChartStar, type FitPoint } from "./sigilFit";
import { SIGIL_MODELS } from "./sigilModel";

// Four anchors with an unmistakable upright: the head must stay above the tail whatever the stars
// look like, which is the one thing a fit is not allowed to lose. The same four points stand in for
// the body, so the framing rule has an extent to work on.
const ARROW: FitPoint[] = [[0, 1], [0, -1], [-0.4, 0.5], [0.4, 0.5]];

const SPREAD: ChartStar[] = [
  { systemId: 1, x: 0.05, y: 0.9 },
  { systemId: 2, x: -0.1, y: -0.95 },
  { systemId: 3, x: -0.5, y: 0.4 },
  { systemId: 4, x: 0.45, y: 0.35 },
  { systemId: 5, x: 0.7, y: -0.3 },
  { systemId: 6, x: -0.65, y: -0.2 },
];

// A constellation whose systems all huddle on one side bar a single far one. This is the shape the
// retired least-squares fit collapsed on: there was nothing for most anchors to pair with, so the
// cheapest pose was a small figure tucked into the huddle.
const LOPSIDED: ChartStar[] = [
  { systemId: 1, x: 0.1, y: 0.12 },
  { systemId: 2, x: 0.18, y: 0.02 },
  { systemId: 3, x: 0.04, y: -0.1 },
  { systemId: 4, x: 0.22, y: 0.18 },
  { systemId: 5, x: 0.14, y: -0.2 },
  { systemId: 6, x: -0.88, y: -0.47 },
];

// Barely a plane at all: every system on one line across the chart.
const SQUASHED: ChartStar[] = SPREAD.map((star) => ({ ...star, y: star.y * 0.04 }));

const CLOUDS: readonly ChartStar[][] = [SPREAD, LOPSIDED, SQUASHED, SPREAD.slice(0, 2)];

function placed(body: readonly FitPoint[], anchors: readonly FitPoint[], stars: readonly ChartStar[]): FitPoint[] {
  const fit = frameFigure(framingsFor(body), anchors, stars)!;
  return body.map((point) => placePoint(point, fit.placement));
}

function bodyOf(model: (typeof SIGIL_MODELS)[number]): FitPoint[] {
  return model.solid.vertices.map((vertex): FitPoint => [vertex[0], vertex[1]]);
}

function anchorsOf(model: (typeof SIGIL_MODELS)[number]): FitPoint[] {
  return model.anchors.map((anchor): FitPoint => [anchor.position[0], anchor.position[1]]);
}

function reachOf(points: readonly FitPoint[]): number {
  return Math.max(...points.map((point) => Math.hypot(point[0], point[1])));
}

function middleOf(points: readonly FitPoint[]): FitPoint {
  const middle = (axis: 0 | 1): number =>
    (Math.min(...points.map((point) => point[axis])) + Math.max(...points.map((point) => point[axis]))) / 2;
  return [middle(0), middle(1)];
}

describe("frameFigure", () => {
  it("draws a figure the size of its constellation, whatever constellation it is", () => {
    // The whole point: a figure's drawn extent is the Constellation's radius times one fixed
    // multiple. Not a cap it may come in under - the size it is.
    expect(SIGIL_MODELS.length).toBeGreaterThan(0);
    for (const model of SIGIL_MODELS) {
      for (const stars of CLOUDS) {
        expect(reachOf(placed(bodyOf(model), anchorsOf(model), stars))).toBeCloseTo(FIGURE_EXTENT, 9);
      }
    }
  });

  it("centres a figure on the constellation, not on the few stars its anchors reached", () => {
    for (const model of SIGIL_MODELS) {
      for (const stars of CLOUDS) {
        const [x, y] = middleOf(placed(bodyOf(model), anchorsOf(model), stars));
        expect(Math.hypot(x, y)).toBeCloseTo(0, 9);
      }
    }
  });

  it("fills a lopsided constellation instead of huddling inside its crowded side", () => {
    // The regression the framing rule exists for. Least squares put a figure at as little as 0.27 of
    // its constellation's radius on clouds shaped like this; now the shape of the cloud cannot
    // change the size of the figure at all.
    for (const model of SIGIL_MODELS) {
      const huddled = reachOf(placed(bodyOf(model), anchorsOf(model), LOPSIDED));
      const even = reachOf(placed(bodyOf(model), anchorsOf(model), SPREAD));

      expect(huddled).toBeCloseTo(even, 9);
      expect(huddled).toBeCloseTo(FIGURE_EXTENT, 9);
    }
  });

  it("turns a figure towards the systems it has to reach", () => {
    // The turn is the one thing left for the anchors to choose, so it has to be the best turn going.
    // Probed twice as finely as the sweep itself, hence the small allowance: a turn half a degree off
    // the grid may answer marginally better, but nothing in the range answers it properly better.
    for (const model of SIGIL_MODELS) {
      const body = bodyOf(model);
      const anchors = anchorsOf(model);
      const chosen = turnCost(body, anchors, SPREAD, frameFigure(framingsFor(body), anchors, SPREAD)!.placement.rotation)!;

      for (let step = 0; step <= 96; step += 1) {
        expect(chosen).toBeLessThanOrEqual(turnCost(body, anchors, SPREAD, -MAX_TILT + (2 * MAX_TILT * step) / 96)! + 5e-3);
      }
    }
  });

  it("does not lean a figure that has no reason to lean", () => {
    // Four systems square to the figure's own upright are answered best by standing straight, so the
    // sweep has to land on nought - and on nought exactly, not on the first candidate near it.
    const mirrored: ChartStar[] = [
      { systemId: 1, x: -0.6, y: 0.6 },
      { systemId: 2, x: 0.6, y: 0.6 },
      { systemId: 3, x: -0.6, y: -0.6 },
      { systemId: 4, x: 0.6, y: -0.6 },
    ];
    const square: FitPoint[] = [[-1, 1], [1, 1], [-1, -1], [1, -1]];

    expect(frameFigure(framingsFor(square), square, mirrored)!.placement.rotation).toBeCloseTo(0, 9);
  });

  it("puts the anchors on the real stars", () => {
    const fit = frameFigure(framingsFor(ARROW), ARROW, SPREAD)!;

    // Every anchor is claimed by a star of its own: that is what makes the figure this
    // constellation's rather than a shape dropped on top of it.
    expect(new Set(fit.matched).size).toBe(ARROW.length);
    for (const [index, anchor] of ARROW.entries()) {
      const star = SPREAD[fit.matched[index]];
      const point = placePoint(anchor, fit.placement);
      expect(Math.hypot(point[0] - star.x, point[1] - star.y)).toBeLessThan(0.75);
    }
  });

  it("leaves no Solar System standing in empty sky when a limb could point at it", () => {
    // The other half of the cost, which the retired constant penalty only claimed to do.
    const points = placed(ARROW, ARROW, SPREAD);
    for (const star of SPREAD) {
      expect(Math.min(...points.map((point) => Math.hypot(point[0] - star.x, point[1] - star.y)))).toBeLessThan(0.9);
    }
  });

  it("keeps a figure upright, so a crown never ends up lying on its side", () => {
    for (const rotation of [0, 1, 2, 3, 4, 5]) {
      const angle = (rotation / 6) * Math.PI * 2;
      const stars = SPREAD.map((star) => ({
        systemId: star.systemId,
        x: star.x * Math.cos(angle) - star.y * Math.sin(angle),
        y: star.x * Math.sin(angle) + star.y * Math.cos(angle),
      }));
      const [head, tail] = placed(ARROW, ARROW, stars);
      const tilt = Math.abs(Math.atan2(head[0] - tail[0], head[1] - tail[1]));

      expect(head[1]).toBeGreaterThan(tail[1]);
      expect(tilt).toBeLessThanOrEqual(MAX_TILT + 1e-9);
    }
  });

  it("moves the whole figure at once, because a body cannot be stretched", () => {
    const points = placed(ARROW, ARROW, SPREAD);

    // Every distance in the figure is scaled by the same factor: no anchor is dragged towards its
    // own star at the expense of the shape, the way the line art used to allow.
    const ratio = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) / 2;
    for (const [left, right] of [[0, 2], [2, 3], [1, 3]] as const) {
      const before = Math.hypot(ARROW[left][0] - ARROW[right][0], ARROW[left][1] - ARROW[right][1]);
      const after = Math.hypot(points[left][0] - points[right][0], points[left][1] - points[right][1]);
      expect(after / before).toBeCloseTo(ratio, 6);
    }
  });

  it("is deterministic for the same body, the same anchors and the same stars", () => {
    expect(frameFigure(framingsFor(ARROW), ARROW, SPREAD)).toEqual(frameFigure(framingsFor(ARROW), ARROW, SPREAD));
  });

  it("still frames a constellation with fewer stars than the figure has anchors", () => {
    const fit = frameFigure(framingsFor(ARROW), ARROW, SPREAD.slice(0, 2))!;

    expect(fit.matched.filter((star) => star >= 0).length).toBeLessThanOrEqual(2);
    for (const anchor of ARROW) for (const value of placePoint(anchor, fit.placement)) expect(Number.isFinite(value)).toBe(true);
  });

  it("frames nothing when there is nothing to frame", () => {
    expect(frameFigure(framingsFor(ARROW), ARROW, [])).toBeNull();
    expect(frameFigure(framingsFor(ARROW), [], SPREAD)).toBeNull();
    expect(frameFigure(framingsFor([]), ARROW, SPREAD)).toBeNull();
    expect(framingsFor([[0, 0], [0, 0]])).toEqual([]);
  });
});
