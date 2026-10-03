// Offline review tool for Constellation Glyphs. Renders two SVG contact sheets, because neither
// question can be answered from a live scene: whether 799 sigils actually look different from one
// another, and whether the sky stays uncluttered seen from many different Solar Systems.
//
//   npx tsx scripts/glyph-sheet.ts             both sheets
//   npx tsx scripts/glyph-sheet.ts --sky       sky sheet only
//   npx tsx scripts/glyph-sheet.ts --sigils    sigil sheet only
//   npx tsx scripts/glyph-sheet.ts --png       also rasterise, for viewing without a browser
//   npx tsx scripts/glyph-sheet.ts --rows=8    only the first N rows of the sigil sheet
//   npx tsx scripts/glyph-sheet.ts --turntable a few glyphs walked round, to judge their volume
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileConstellationGlyphIndex, projectConstellationGlyphs } from "../src/constellations/constellationGlyphModel";
import type { GlyphShape } from "../src/constellations/glyphShape";
import { drawnEdges } from "../src/constellations/glyphSolid";
import { figureForConstellation } from "../src/constellations/sigilMotifs";
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

const SKELETON_COLOUR = "#57d8f5";
const ORNAMENT_COLOUR = "#8f93c4";
const HOME_COLOUR = "#3b3f6b";

// The drawing's own ladder, the same one the app renders: the outline where the body turns away,
// then the edges on its near side, then the ties.
const LINE_STYLE = {
  silhouette: { colour: SKELETON_COLOUR, weight: 1.5, opacity: 1 },
  interior: { colour: "#3ba6cc", weight: 0.9, opacity: 0.8 },
  lead: { colour: ORNAMENT_COLOUR, weight: 0.5, opacity: 0.55 },
} as const;

type SheetLine = { kind: keyof typeof LINE_STYLE; points: Vector3[] };

// What one observer actually sees of a glyph: the body's visible edges, plus the ties to the Solar
// Systems it did not reach. Built from the same function the app calls, so the sheet cannot drift
// away from what a pilot gets.
function drawnLines(shape: GlyphShape, observer: Vector3): SheetLine[] {
  const lines: SheetLine[] = [];

  for (const solid of shape.solids) {
    for (const line of drawnEdges(solid, observer)) lines.push({ kind: line.kind, points: [line.from as Vector3, line.to as Vector3] });
  }
  for (const lead of shape.leads) lines.push({ kind: "lead", points: [lead.from, lead.to] });
  return lines;
}

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

// Flattens a point in space the way a camera at `observer` looking at `target` would see it, so
// the sigil sheet shows the same object the app draws rather than a separate construction.
function viewFrom(observer: Vector3, target: Vector3) {
  const axis = normalize([target[0] - observer[0], target[1] - observer[1], target[2] - observer[2]]);
  const rawUp: Vector3 = Math.abs(axis[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const dot = rawUp[0] * axis[0] + rawUp[1] * axis[1] + rawUp[2] * axis[2];
  const up = normalize([rawUp[0] - axis[0] * dot, rawUp[1] - axis[1] * dot, rawUp[2] - axis[2] * dot]);
  const right: Vector3 = [
    up[1] * axis[2] - up[2] * axis[1],
    up[2] * axis[0] - up[0] * axis[2],
    up[0] * axis[1] - up[1] * axis[0],
  ];

  return (point: Vector3): [number, number] => {
    const offset: Vector3 = [point[0] - observer[0], point[1] - observer[1], point[2] - observer[2]];
    const depth = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
    const scale = depth === 0 ? 0 : 1 / depth;
    return [
      (offset[0] * right[0] + offset[1] * right[1] + offset[2] * right[2]) * scale,
      (offset[0] * up[0] + offset[1] * up[1] + offset[2] * up[2]) * scale,
    ];
  };
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
        const style = LINE_STYLE[stroke.kind];
        const colour = isHome ? HOME_COLOUR : style.colour;
        const weight = isHome ? 0.55 : style.weight;
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

    // The glyph as it stands in space. This sheet is a portrait of the artwork, so the synthetic
    // observer stands off along the figure's own normal, a fixed multiple of its size away: every
    // sigil is reviewed face on and at a comparable size. The sky sheet is where real angles live.
    const shape = index.shapeByConstellation.get(constellationId);
    if (!shape) return;
    const observerPosition: Vector3 = [
      shape.centre[0] - shape.normal[0] * shape.radius * 4,
      shape.centre[1] - shape.normal[1] * shape.radius * 4,
      shape.centre[2] - shape.normal[2] * shape.radius * 4,
    ];
    const view = viewFrom(observerPosition, shape.centre);
    const figure = figureForConstellation(constellationId)!;
    drawn += 1;
    signatures.add(figure.name);

    const seen = drawnLines(shape, observerPosition).map((line) => ({ kind: line.kind, points: line.points.map(view) }));
    const starPoints = members.map((member) => view(member.position));
    const all = [...seen.flatMap((stroke) => stroke.points), ...starPoints];
    const spanX = Math.max(...all.map((point) => point[0])) - Math.min(...all.map((point) => point[0]));
    const spanY = Math.max(...all.map((point) => point[1])) - Math.min(...all.map((point) => point[1]));
    const centreX = (Math.max(...all.map((point) => point[0])) + Math.min(...all.map((point) => point[0]))) / 2;
    const centreY = (Math.max(...all.map((point) => point[1])) + Math.min(...all.map((point) => point[1]))) / 2;
    const fit = (SIGIL_CELL - 44) / Math.max(spanX, spanY, 1e-9);

    const originX = (position % SIGIL_COLUMNS) * SIGIL_CELL + SIGIL_CELL / 2;
    const originY = Math.floor(position / SIGIL_COLUMNS) * SIGIL_CELL + SIGIL_CELL / 2 - 4;
    const screen = (point: readonly [number, number]): [number, number] => [originX + (point[0] - centreX) * fit, originY - (point[1] - centreY) * fit];

    for (const stroke of seen) {
      const points = stroke.points.map((point) => screen(point).map((value) => value.toFixed(1)).join(",")).join(" ");
      const style = LINE_STYLE[stroke.kind];
      parts.push(`<polyline points="${points}" fill="none" stroke="${style.colour}" stroke-width="${style.weight}" stroke-linejoin="round" opacity="${style.opacity}"/>`);
    }
    for (const star of starPoints) {
      const [x, y] = screen(star);
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

// A handful of glyphs walked all the way round, which is the only way to judge whether a figure has
// volume: a flat drawing turned edge on collapses to a line, and a body does not. Each row is one
// constellation seen from the same distance at even steps of yaw about its own upright.
const TURN_STEPS = 8;
const TURN_CELL = 190;

function turntableSheet(): string {
  const constellationIds = [...index.shapeByConstellation.keys()].sort((left, right) => left - right).slice(0, turntableRows);
  const width = TURN_STEPS * TURN_CELL;
  const height = constellationIds.length * TURN_CELL;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#05060d"/>`];

  constellationIds.forEach((constellationId, row) => {
    const shape = index.shapeByConstellation.get(constellationId)!;
    const figure = figureForConstellation(constellationId)!;
    // The walk goes round the figure's own upright, the way a viewer would walk round a statue: a
    // turned body must look the same from every step of it, and a slab must not.
    const up = shape.up;
    const facing = shape.normal;
    const across: Vector3 = [
      up[1] * facing[2] - up[2] * facing[1],
      up[2] * facing[0] - up[0] * facing[2],
      up[0] * facing[1] - up[1] * facing[0],
    ];

    for (let step = 0; step < TURN_STEPS; step += 1) {
      const angle = (2 * Math.PI * step) / TURN_STEPS;
      const reach = shape.radius * 4;
      // A little above the equator, so the caps are never exactly edge on and a flat body cannot
      // hide its flatness behind a perfectly side-on view.
      const observerPosition: Vector3 = [
        shape.centre[0] + (Math.cos(angle) * facing[0] + Math.sin(angle) * across[0]) * reach + up[0] * shape.radius,
        shape.centre[1] + (Math.cos(angle) * facing[1] + Math.sin(angle) * across[1]) * reach + up[1] * shape.radius,
        shape.centre[2] + (Math.cos(angle) * facing[2] + Math.sin(angle) * across[2]) * reach + up[2] * shape.radius,
      ];
      const view = viewFrom(observerPosition, shape.centre);
      const seen = drawnLines(shape, observerPosition).map((line) => ({ kind: line.kind, points: line.points.map(view) }));
      const flat = seen.flatMap((line) => line.points);
      if (flat.length === 0) continue;

      // Every cell of a row is scaled the same way, or a figure turning edge on would be silently
      // zoomed back up to fill its cell and the collapse would never show.
      const span = shape.radius / reach;
      const originX = step * TURN_CELL + TURN_CELL / 2;
      const originY = row * TURN_CELL + TURN_CELL / 2 - 4;
      const fit = (TURN_CELL - 40) / (2.6 * span);
      const screen = (point: readonly [number, number]): [number, number] => [originX + point[0] * fit, originY - point[1] * fit];

      for (const line of seen) {
        const points = line.points.map((point) => screen(point).map((value) => value.toFixed(1)).join(",")).join(" ");
        const style = LINE_STYLE[line.kind];
        parts.push(`<polyline points="${points}" fill="none" stroke="${style.colour}" stroke-width="${style.weight}" stroke-linejoin="round" opacity="${style.opacity}"/>`);
      }
      const visible = seen.filter((line) => line.kind !== "lead").length;
      parts.push(`<text x="${originX}" y="${row * TURN_CELL + TURN_CELL - 8}" fill="#6f78a3" font-family="monospace" font-size="8" text-anchor="middle">${((angle * 180) / Math.PI).toFixed(0)}deg / ${visible} lines</text>`);
    }

    parts.push(`<text x="8" y="${row * TURN_CELL + 14}" fill="#7f88b5" font-family="monospace" font-size="9">${escapeXml(constellationNames.get(constellationId) ?? String(constellationId))} / ${figure.name}</text>`);
  });

  parts.push("</svg>");
  console.log(`turntable sheet: ${constellationIds.length} constellations at ${TURN_STEPS} angles`);
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
const wantsTurntable = process.argv.includes("--turntable");
const turntableRows = rowsArgument ? Number(rowsArgument.slice("--rows=".length)) : 6;
const special = wantsTurntable;
const wantsSky = !special && (process.argv.includes("--sky") || !process.argv.includes("--sigils"));
const wantsSigils = !special && (process.argv.includes("--sigils") || !process.argv.includes("--sky"));
const wantsPng = process.argv.includes("--png");

mkdirSync(outputDir, { recursive: true });
if (wantsSky) writeFileSync(resolve(outputDir, "sky.svg"), skySheet());
if (wantsSigils) writeFileSync(resolve(outputDir, "sigils.svg"), sigilSheet());
if (wantsTurntable) writeFileSync(resolve(outputDir, "turntable.svg"), turntableSheet());

if (wantsPng && wantsTurntable) {
  await rasterise("turntable", TURN_STEPS * TURN_CELL, turntableRows * TURN_CELL);
}

if (wantsPng && !special) {
  const sigilRows = sigilRowLimit ?? Math.ceil([...index.systemsByConstellation.keys()].length / SIGIL_COLUMNS);
  if (wantsSky) await rasterise("sky", SKY_COLUMNS * SKY_CELL_WIDTH, Math.ceil(SKY_OBSERVER_COUNT / SKY_COLUMNS) * SKY_CELL_HEIGHT);
  if (wantsSigils) await rasterise("sigils", SIGIL_COLUMNS * SIGIL_CELL, sigilRows * SIGIL_CELL);
}

console.log(`written to ${outputDir}`);
