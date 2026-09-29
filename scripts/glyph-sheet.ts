// Offline review tool for Constellation Glyphs. Renders two SVG contact sheets, because neither
// question can be answered from a live scene: whether 799 sigils actually look different from one
// another, and whether the sky stays uncluttered seen from many different Solar Systems.
//
//   npx tsx scripts/glyph-sheet.ts             both sheets
//   npx tsx scripts/glyph-sheet.ts --sky       sky sheet only
//   npx tsx scripts/glyph-sheet.ts --sigils    sigil sheet only
//   npx tsx scripts/glyph-sheet.ts --png       also rasterise, for viewing without a browser
//   npx tsx scripts/glyph-sheet.ts --rows=8    only the first N rows of the sigil sheet
//   npx tsx scripts/glyph-sheet.ts --figures   the raw figure library, unfitted, with its anchors
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileConstellationGlyphIndex, projectConstellationGlyphs } from "../src/constellations/constellationGlyphModel";
import { buildGlyphChart } from "../src/constellations/glyphChart";
import { fitFigure } from "../src/constellations/sigilFigure";
import { SIGIL_FIGURES } from "../src/constellations/sigilMotifs";
import type { Vector3 } from "../src/universe/generateUniverse";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, "../.scratch/glyph-sheet");

type RawIndex = {
  regions: { id: number; name: string; constellations: { id: number; name: string }[] }[];
  systems: { id: number; name: string; constellationId: number; position: Vector3 }[];
};

const universe = JSON.parse(readFileSync(resolve(here, "../src/data/universe-index.json"), "utf8")) as RawIndex;
const systems = universe.systems.map((system) => ({ id: system.id, constellationId: system.constellationId, position: system.position }));
const index = compileConstellationGlyphIndex(systems);

const constellationNames = new Map<number, string>();
for (const region of universe.regions) for (const constellation of region.constellations) constellationNames.set(constellation.id, constellation.name);

const SKY_OBSERVER_COUNT = 24;
const SKY_CELL_WIDTH = 460;
const SKY_CELL_HEIGHT = 260;
const SKY_COLUMNS = 3;

const SIGIL_CELL = 150;
const SIGIL_COLUMNS = 20;

const FIGURES = SIGIL_FIGURES;

// Until the motif table names a figure per Constellation, spread the library over the corpus by id.
function figureIndexFor(constellationId: number): number {
  let hash = constellationId >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) % FIGURES.length;
}

const SKELETON_COLOUR = "#57d8f5";
const ORNAMENT_COLOUR = "#8f93c4";
const HOME_COLOUR = "#3b3f6b";

// Hammer projection: the whole celestial sphere in one ellipse, so nothing is cropped and glyph
// crowding shows up everywhere at once rather than only where a camera happens to point.
function hammer(direction: Vector3): [number, number] {
  const longitude = Math.atan2(direction[1], direction[0]);
  const latitude = Math.asin(Math.max(-1, Math.min(1, direction[2])));
  const denominator = Math.sqrt(1 + Math.cos(latitude) * Math.cos(longitude / 2));
  return [
    (2 * Math.SQRT2 * Math.cos(latitude) * Math.sin(longitude / 2)) / denominator,
    (Math.SQRT2 * Math.sin(latitude)) / denominator,
  ];
}

function normalize(position: Vector3): Vector3 {
  const length = Math.hypot(position[0], position[1], position[2]) || 1;
  return [position[0] / length, position[1] / length, position[2] / length];
}

function escapeXml(value: string): string {
  return value.replace(/[<>&]/g, (character) => (character === "<" ? "&lt;" : character === ">" ? "&gt;" : "&amp;"));
}

function skySheet(): string {
  const stride = Math.floor(systems.length / SKY_OBSERVER_COUNT);
  const observers = systems.filter((_, position) => position % stride === 0).slice(0, SKY_OBSERVER_COUNT);
  const rows = Math.ceil(observers.length / SKY_COLUMNS);
  const width = SKY_COLUMNS * SKY_CELL_WIDTH;
  const height = rows * SKY_CELL_HEIGHT;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#05060d"/>`];
  const counts: number[] = [];

  observers.forEach((observer, position) => {
    const originX = (position % SKY_COLUMNS) * SKY_CELL_WIDTH + SKY_CELL_WIDTH / 2;
    const originY = Math.floor(position / SKY_COLUMNS) * SKY_CELL_HEIGHT + SKY_CELL_HEIGHT / 2 + 6;
    const scale = (SKY_CELL_WIDTH / 2 - 14) / (2 * Math.SQRT2);
    const glyphs = projectConstellationGlyphs(index, observer.id);
    counts.push(glyphs.length);

    parts.push(`<ellipse cx="${originX}" cy="${originY}" rx="${(2 * Math.SQRT2 * scale).toFixed(1)}" ry="${(Math.SQRT2 * scale).toFixed(1)}" fill="#090b16" stroke="#1b2036"/>`);

    for (const glyph of glyphs) {
      const isHome = glyph.constellationId === observer.constellationId;
      for (const stroke of glyph.strokes) {
        if (stroke.opacity <= 0.001) continue;
        const [x1, y1] = hammer(normalize(stroke.from));
        const [x2, y2] = hammer(normalize(stroke.to));
        // Segments that jump the seam of the projection are simply skipped; on a review sheet a
        // missing hair is better than a line ruled straight across the whole sky.
        if (Math.abs(x1 - x2) > 1.2) continue;
        const colour = isHome ? HOME_COLOUR : stroke.kind === "lead" ? ORNAMENT_COLOUR : SKELETON_COLOUR;
        const weight = isHome ? 0.55 : stroke.kind === "lead" ? 0.5 : 1.1;
        parts.push(`<line x1="${(originX + x1 * scale).toFixed(2)}" y1="${(originY - y1 * scale).toFixed(2)}" x2="${(originX + x2 * scale).toFixed(2)}" y2="${(originY - y2 * scale).toFixed(2)}" stroke="${colour}" stroke-width="${weight}" opacity="${(stroke.opacity * (isHome ? 0.5 : 0.92)).toFixed(3)}"/>`);
      }
      for (const node of glyph.nodes) {
        if (node.opacity <= 0.001) continue;
        const [px, py] = hammer(normalize(node.position));
        parts.push(`<circle cx="${(originX + px * scale).toFixed(2)}" cy="${(originY - py * scale).toFixed(2)}" r="${isHome ? 1.1 : 1.8}" fill="${isHome ? HOME_COLOUR : "#a8ecff"}" opacity="${node.opacity.toFixed(3)}"/>`);
      }
    }

    parts.push(`<text x="${originX - SKY_CELL_WIDTH / 2 + 10}" y="${originY - SKY_CELL_HEIGHT / 2 + 8}" fill="#7f88b5" font-family="monospace" font-size="10">${escapeXml(constellationNames.get(observer.constellationId) ?? "?")} - ${glyphs.length} glyphs</text>`);
  });

  parts.push("</svg>");
  counts.sort((left, right) => left - right);
  console.log(`sky sheet: ${observers.length} observers, glyphs per sky min=${counts[0]} p50=${counts[counts.length >> 1]} max=${counts[counts.length - 1]}`);
  return parts.join("\n");
}

function sigilSheet(): string {
  const all = [...index.systemsByConstellation.keys()].sort((left, right) => left - right);
  const constellationIds = sigilRowLimit === null ? all : all.slice(0, sigilRowLimit * SIGIL_COLUMNS);
  const rows = Math.ceil(constellationIds.length / SIGIL_COLUMNS);
  const width = SIGIL_COLUMNS * SIGIL_CELL;
  const height = rows * SIGIL_CELL;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#05060d"/>`];
  const signatures = new Set<string>();
  let drawn = 0;

  constellationIds.forEach((constellationId, position) => {
    const members = index.systemsByConstellation.get(constellationId)!;
    if (members.length < 2) return;

    // A synthetic observer a fixed multiple of the constellation's own size away, so every sigil is
    // reviewed at a comparable apparent size instead of whatever the live camera happens to give.
    const centroid: Vector3 = [0, 0, 0];
    for (const member of members) for (let axis = 0; axis < 3; axis += 1) centroid[axis] += member.position[axis] / members.length;
    let spread = 0;
    for (const member of members) spread = Math.max(spread, Math.hypot(member.position[0] - centroid[0], member.position[1] - centroid[1], member.position[2] - centroid[2]));
    const observerPosition: Vector3 = [centroid[0], centroid[1] - spread * 2.6, centroid[2]];

    const chart = buildGlyphChart(members, observerPosition);
    if (!chart) return;
    const figure = FIGURES[figureIndexFor(constellationId)];
    const fitted = fitFigure(figure, chart.points);
    if (fitted.strokes.length === 0) return;
    drawn += 1;
    signatures.add(figure.name);

    const originX = (position % SIGIL_COLUMNS) * SIGIL_CELL + SIGIL_CELL / 2;
    const originY = Math.floor(position / SIGIL_COLUMNS) * SIGIL_CELL + SIGIL_CELL / 2 - 4;
    const fit = (SIGIL_CELL - 40) / 2 / 1.35;
    const screen = (x: number, y: number): [number, number] => [originX + x * fit, originY - y * fit];

    for (const stroke of fitted.strokes) {
      const points = stroke.points.map(([x, y]) => screen(x, y).map((value) => value.toFixed(1)).join(",")).join(" ");
      const isLead = stroke.kind === "lead";
      parts.push(`<polyline points="${points}" fill="none" stroke="${isLead ? ORNAMENT_COLOUR : SKELETON_COLOUR}" stroke-width="${isLead ? 0.5 : 1.15}" stroke-linejoin="round" opacity="${isLead ? 0.55 : 0.95}"/>`);
    }
    for (const point of chart.points) {
      const [x, y] = screen(point.x, point.y);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#ffd9a0"/>`);
    }
    parts.push(`<text x="${originX}" y="${originY + SIGIL_CELL / 2 - 10}" fill="#6f78a3" font-family="monospace" font-size="7" text-anchor="middle">${escapeXml(constellationNames.get(constellationId) ?? String(constellationId))} / ${figure.name}</text>`);
  });

  parts.push("</svg>");
  console.log(`sigil sheet: ${drawn} constellations drawn from ${signatures.size} figures`);
  return parts.join("\n");
}

// The library on its own, before any constellation pulls it about: the only way to tell whether a
// figure reads as a wolf at all is to look at it drawn straight.
function figureSheet(): string {
  const figures = FIGURES;
  const columns = Math.min(5, figures.length);
  const rows = Math.ceil(figures.length / columns);
  const cell = 240;
  const width = columns * cell;
  const height = rows * cell;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#05060d"/>`];

  figures.forEach((figure, position) => {
    const originX = (position % columns) * cell + cell / 2;
    const originY = Math.floor(position / columns) * cell + cell / 2 - 6;
    const fit = (cell - 56) / 2;
    const screen = (x: number, y: number): [number, number] => [originX + x * fit, originY - y * fit];

    for (const stroke of figure.strokes) {
      const points = stroke.map(([x, y]) => screen(x, y).map((value) => value.toFixed(1)).join(",")).join(" ");
      parts.push(`<polyline points="${points}" fill="none" stroke="${SKELETON_COLOUR}" stroke-width="1.6" stroke-linejoin="round" opacity="0.95"/>`);
    }
    for (const [x, y] of figure.anchors) {
      const [px, py] = screen(x, y);
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.4" fill="none" stroke="#ffb347" stroke-width="1.2"/>`);
    }
    parts.push(`<text x="${originX}" y="${originY + cell / 2 - 14}" fill="#6f78a3" font-family="monospace" font-size="11" text-anchor="middle">${escapeXml(figure.name)} - ${figure.anchors.length} anchors</text>`);
  });

  parts.push("</svg>");
  console.log(`figure sheet: ${figures.length} figures, anchors ${figures.map((figure) => figure.anchors.length).join("/")}`);
  return parts.join("\n");
}

async function rasterise(name: string, svgWidth: number, svgHeight: number): Promise<void> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: svgWidth, height: svgHeight }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:#05060d">${readFileSync(resolve(outputDir, `${name}.svg`), "utf8")}</body>`);
  await page.screenshot({ path: resolve(outputDir, `${name}.png`) });
  await browser.close();
}

const rowsArgument = process.argv.find((argument) => argument.startsWith("--rows="));
const sigilRowLimit = rowsArgument ? Number(rowsArgument.slice("--rows=".length)) : null;
const wantsFigures = process.argv.includes("--figures");
const wantsSky = !wantsFigures && (process.argv.includes("--sky") || !process.argv.includes("--sigils"));
const wantsSigils = !wantsFigures && (process.argv.includes("--sigils") || !process.argv.includes("--sky"));
const wantsPng = process.argv.includes("--png");

mkdirSync(outputDir, { recursive: true });
if (wantsSky) writeFileSync(resolve(outputDir, "sky.svg"), skySheet());
if (wantsSigils) writeFileSync(resolve(outputDir, "sigils.svg"), sigilSheet());
if (wantsFigures) writeFileSync(resolve(outputDir, "figures.svg"), figureSheet());

if (wantsPng && wantsFigures) {
  const figures = FIGURES;
  const columns = Math.min(5, figures.length);
  await rasterise("figures", columns * 240, Math.ceil(FIGURES.length / columns) * 240);
}

if (wantsPng && !wantsFigures) {
  const sigilRows = sigilRowLimit ?? Math.ceil([...index.systemsByConstellation.keys()].length / SIGIL_COLUMNS);
  if (wantsSky) await rasterise("sky", SKY_COLUMNS * SKY_CELL_WIDTH, Math.ceil(SKY_OBSERVER_COUNT / SKY_COLUMNS) * SKY_CELL_HEIGHT);
  if (wantsSigils) await rasterise("sigils", SIGIL_COLUMNS * SIGIL_CELL, sigilRows * SIGIL_CELL);
}

console.log(`written to ${outputDir}`);
