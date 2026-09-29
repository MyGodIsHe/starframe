import { describe, expect, it } from "vitest";
import { fitFigure, MAX_TILT, type FigurePoint, type FittedStroke, type SigilFigure } from "./sigilFigure";
import { SIGIL_FIGURES } from "./sigilMotifs";

type ChartPoint = { systemId: number; x: number; y: number };

// A plain upright arrow: unmistakable when it survives a fit, obviously wrong when it does not.
const ARROW: SigilFigure = {
  name: "arrow",
  strokes: [[[0, -1], [0, 1]], [[-0.4, 0.5], [0, 1], [0.4, 0.5]]],
  anchors: [[0, 1], [0, -1], [-0.4, 0.5], [0.4, 0.5]],
};

const SPREAD: ChartPoint[] = [
  { systemId: 1, x: 0.05, y: 0.9 },
  { systemId: 2, x: -0.1, y: -0.95 },
  { systemId: 3, x: -0.5, y: 0.4 },
  { systemId: 4, x: 0.45, y: 0.35 },
  { systemId: 5, x: 0.7, y: -0.3 },
  { systemId: 6, x: -0.65, y: -0.2 },
];

function nearestDistanceToFigure(point: ChartPoint, strokes: readonly FittedStroke[]): number {
  let best = Infinity;
  for (const stroke of strokes) {
    if (stroke.kind !== "figure") continue;
    for (let index = 0; index + 1 < stroke.points.length; index += 1) {
      best = Math.min(best, distanceToSegment([point.x, point.y], stroke.points[index], stroke.points[index + 1]));
    }
  }
  return best;
}

function distanceToSegment(point: FigurePoint, from: FigurePoint, to: FigurePoint): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (from[0] + dx * amount), point[1] - (from[1] + dy * amount));
}

describe("fitFigure", () => {
  it("ties every real Solar System to the drawing, by proximity or by a lead line", () => {
    for (const figure of [ARROW, ...SIGIL_FIGURES]) {
      const fitted = fitFigure(figure, SPREAD);
      for (const star of SPREAD) {
        const onFigure = nearestDistanceToFigure(star, fitted.strokes) <= 0.07;
        const hasLead = fitted.strokes.some(
          (stroke) => stroke.kind === "lead" && Math.hypot(stroke.points[0][0] - star.x, stroke.points[0][1] - star.y) < 1e-9,
        );
        expect(onFigure || hasLead).toBe(true);
      }
    }
  });

  it("keeps the whole drawing inside the extent Glyph Occlusion reserves", () => {
    for (const figure of [ARROW, ...SIGIL_FIGURES]) {
      for (const stars of [SPREAD, SPREAD.slice(0, 3), SPREAD.map((star) => ({ ...star, x: star.x * 0.2 }))]) {
        for (const stroke of fitFigure(figure, stars).strokes) {
          for (const [x, y] of stroke.points) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1.35 + 1e-9);
        }
      }
    }
  });

  it("keeps a figure upright, so a crown never ends up lying on its side", () => {
    // The arrow's head must stay above its tail whatever the stars look like.
    for (const rotation of [0, 1, 2, 3, 4, 5]) {
      const angle = (rotation / 6) * Math.PI * 2;
      const stars = SPREAD.map((star) => ({
        systemId: star.systemId,
        x: star.x * Math.cos(angle) - star.y * Math.sin(angle),
        y: star.x * Math.sin(angle) + star.y * Math.cos(angle),
      }));
      const fitted = fitFigure(ARROW, stars);
      const spine = fitted.strokes.find((stroke) => stroke.kind === "figure")!;
      const [tail, head] = [spine.points[0], spine.points[spine.points.length - 1]];
      const tilt = Math.abs(Math.atan2(head[0] - tail[0], head[1] - tail[1]));

      expect(head[1]).toBeGreaterThan(tail[1]);
      // Allow the bounded tilt plus the warp's own nudge on the endpoints.
      expect(tilt).toBeLessThan(MAX_TILT * 2.5);
    }
  });

  it("produces only finite coordinates, for every figure in the library", () => {
    for (const figure of SIGIL_FIGURES) {
      for (const stroke of fitFigure(figure, SPREAD).strokes) {
        for (const [x, y] of stroke.points) {
          expect(Number.isFinite(x)).toBe(true);
          expect(Number.isFinite(y)).toBe(true);
        }
      }
    }
  });

  it("is deterministic for the same figure and the same stars", () => {
    expect(fitFigure(ARROW, SPREAD)).toEqual(fitFigure(ARROW, SPREAD));
  });

  it("draws nothing when there is nothing to fit", () => {
    expect(fitFigure(ARROW, []).strokes).toEqual([]);
    expect(fitFigure({ name: "empty", strokes: [], anchors: [] }, SPREAD).strokes).toEqual([]);
  });

  it("still fits a constellation with fewer stars than the figure has anchors", () => {
    const fitted = fitFigure(ARROW, SPREAD.slice(0, 2));

    expect(fitted.strokes.some((stroke) => stroke.kind === "figure")).toBe(true);
    expect(fitted.matched.filter((star) => star >= 0).length).toBeLessThanOrEqual(2);
  });
});

describe("the figure library", () => {
  it("ships figures that each carry at least three anchors and real artwork", () => {
    expect(SIGIL_FIGURES.length).toBeGreaterThan(0);
    for (const figure of SIGIL_FIGURES) {
      expect(figure.anchors.length).toBeGreaterThanOrEqual(3);
      expect(figure.strokes.length).toBeGreaterThan(0);
      for (const stroke of figure.strokes) expect(stroke.length).toBeGreaterThan(1);
    }
  });

  it("names every figure uniquely, so the motif table can reference them", () => {
    expect(new Set(SIGIL_FIGURES.map((figure) => figure.name)).size).toBe(SIGIL_FIGURES.length);
  });
});
