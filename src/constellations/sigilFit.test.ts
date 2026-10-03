import { describe, expect, it } from "vitest";
import { fitAnchors, placePoint, FIGURE_EXTENT, MAX_TILT, type ChartStar, type FitPoint } from "./sigilFit";
import { SIGIL_MODELS } from "./sigilModel";

// Four anchors with an unmistakable upright: the head must stay above the tail whatever the stars
// look like, which is the one thing a fit is not allowed to lose.
const ARROW: FitPoint[] = [[0, 1], [0, -1], [-0.4, 0.5], [0.4, 0.5]];

const SPREAD: ChartStar[] = [
  { systemId: 1, x: 0.05, y: 0.9 },
  { systemId: 2, x: -0.1, y: -0.95 },
  { systemId: 3, x: -0.5, y: 0.4 },
  { systemId: 4, x: 0.45, y: 0.35 },
  { systemId: 5, x: 0.7, y: -0.3 },
  { systemId: 6, x: -0.65, y: -0.2 },
];

function placed(anchors: readonly FitPoint[], stars: readonly ChartStar[]): FitPoint[] {
  const fit = fitAnchors(anchors, stars)!;
  return anchors.map((anchor) => placePoint(anchor, fit.placement));
}

describe("fitAnchors", () => {
  it("puts the anchors on the real stars", () => {
    const fit = fitAnchors(ARROW, SPREAD)!;

    // Every anchor is claimed by a star of its own, and lands near it: that is what makes the
    // figure this constellation's rather than a shape dropped on top of it.
    expect(new Set(fit.matched).size).toBe(ARROW.length);
    for (const [index, anchor] of ARROW.entries()) {
      const star = SPREAD[fit.matched[index]];
      const point = placePoint(anchor, fit.placement);
      expect(Math.hypot(point[0] - star.x, point[1] - star.y)).toBeLessThan(0.45);
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
      const [head, tail] = placed(ARROW, stars);
      const tilt = Math.abs(Math.atan2(head[0] - tail[0], head[1] - tail[1]));

      expect(head[1]).toBeGreaterThan(tail[1]);
      expect(tilt).toBeLessThanOrEqual(MAX_TILT + 1e-9);
    }
  });

  it("moves the whole figure at once, because a body cannot be stretched", () => {
    const points = placed(ARROW, SPREAD);

    // Every distance in the figure is scaled by the same factor: no anchor is dragged towards its
    // own star at the expense of the shape, the way the line art used to allow.
    const ratio = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) / 2;
    for (const [left, right] of [[0, 2], [2, 3], [1, 3]] as const) {
      const before = Math.hypot(ARROW[left][0] - ARROW[right][0], ARROW[left][1] - ARROW[right][1]);
      const after = Math.hypot(points[left][0] - points[right][0], points[left][1] - points[right][1]);
      expect(after / before).toBeCloseTo(ratio, 6);
    }
  });

  it("is deterministic for the same anchors and the same stars", () => {
    expect(fitAnchors(ARROW, SPREAD)).toEqual(fitAnchors(ARROW, SPREAD));
  });

  it("still fits a constellation with fewer stars than the figure has anchors", () => {
    const fit = fitAnchors(ARROW, SPREAD.slice(0, 2))!;

    expect(fit.matched.filter((star) => star >= 0).length).toBeLessThanOrEqual(2);
    for (const anchor of ARROW) for (const value of placePoint(anchor, fit.placement)) expect(Number.isFinite(value)).toBe(true);
  });

  it("fits nothing when there is nothing to fit", () => {
    expect(fitAnchors(ARROW, [])).toBeNull();
    expect(fitAnchors([], SPREAD)).toBeNull();
  });

  it("places every figure in the library inside the reach Glyph Occlusion reserves", () => {
    // The fit itself only has to be sane here; containing the body is the shape builder's job, and
    // it needs a placement that does not start out wildly oversized.
    expect(SIGIL_MODELS.length).toBeGreaterThan(0);
    for (const model of SIGIL_MODELS) {
      const anchors = model.anchors.map((anchor): FitPoint => [anchor.position[0], anchor.position[1]]);
      for (const stars of [SPREAD, SPREAD.slice(0, 3), SPREAD.map((star) => ({ ...star, x: star.x * 0.2 }))]) {
        for (const point of placed(anchors, stars)) expect(Math.hypot(point[0], point[1])).toBeLessThan(FIGURE_EXTENT * 2);
      }
    }
  });
});
