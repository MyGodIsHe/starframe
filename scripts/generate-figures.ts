// Draws the figure library that Constellation Glyphs are built from.
//
// This is the one genuinely creative step, and the one place a model earns its keep: it is asked
// for a few dozen pieces of line art, not for 799. A few dozen can be looked at - run
// `npx tsx scripts/glyph-sheet.ts --figures --png` after this and regenerate whatever reads badly
// with --only. Per-constellation geometry is never generated; the fitter places these on the real
// Solar Systems.
//
//   npx tsx scripts/generate-figures.ts --dry-run          print the prompt and stop
//   npx tsx scripts/generate-figures.ts                    draw the default subject list
//   npx tsx scripts/generate-figures.ts --only=wolf,crown  redraw just these, keep the rest
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "../src/data/sigil-figures.json");

const MODEL = "claude-opus-5";
const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

// EVE's own iconography: empires and their heraldry, industry, piracy, ruin, navigation, faith.
const SUBJECTS = [
  "crown", "wolf", "raptor", "serpent", "hammer", "chalice", "eye", "vessel", "gate", "tower",
  "phoenix", "scarab", "whale", "spider", "stag", "moth", "ram", "hound", "crab", "ray",
  "anvil", "lantern", "key", "scales", "chain", "blade", "shield", "helm", "anchor", "drill",
  "obelisk", "arch", "bridge", "beacon", "reactor", "cog", "mask", "hand", "skull", "tree",
];

const SYSTEM_PROMPT = `You draw minimal line-art figures that will be used as constellation sigils in a star map.

Each figure is plain polylines in a square coordinate space from -1 to 1, with y pointing up. Think of a woodcut or a star-atlas engraving: a few confident strokes that read instantly at small size, not a detailed illustration.

Hard requirements for every figure:
- Between 2 and 6 strokes. Each stroke is an ordered list of 3 to 24 points. Close a shape by repeating its first point at the end.
- Every coordinate is between -1 and 1. Use the space: the figure's longest dimension should span at least 1.4.
- The figure must be upright. It will be drawn upright on the sky and may only be tilted by about 20 degrees, so it must read correctly in the orientation you draw it.
- Between 4 and 6 anchors. An anchor is a point where a real star will land, so put anchors on the figure's most characteristic extremities - a wingtip, the top of a crown, the prow of a ship, the tip of a horn. Every anchor must lie on or very near one of the strokes. Spread them out; do not cluster them.
- Anchors are listed most characteristic first.

What makes these good or bad:
- Good: a silhouette a viewer names in under a second. Strong outline, generous spacing, asymmetry where the subject is asymmetric.
- Bad: thin scribbles, near-symmetric blobs, shapes so simple they collapse into a triangle, or interior detail that disappears at small size.
- A viewer sees only lines, no fill and no colour. Anything that depends on shading will not read.

Draw the subject you are given. Use its name as the figure name, exactly as given.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["figures"],
  properties: {
    figures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "strokes", "anchors"],
        properties: {
          name: { type: "string" },
          strokes: {
            type: "array",
            items: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } },
          },
          anchors: {
            type: "array",
            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          },
        },
      },
    },
  },
};

type Figure = { name: string; strokes: number[][][]; anchors: number[][] };

function distanceToArtwork(point: number[], strokes: number[][][]): number {
  let best = Infinity;
  for (const stroke of strokes) {
    for (let index = 0; index + 1 < stroke.length; index += 1) {
      const [ax, ay] = stroke[index];
      const [bx, by] = stroke[index + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSquared));
      best = Math.min(best, Math.hypot(point[0] - (ax + dx * amount), point[1] - (ay + dy * amount)));
    }
  }
  return best;
}

// Everything the prompt promised, checked. A figure that fails is redrawn rather than shipped.
function rejectionFor(figure: Figure, subject: string): string | null {
  if (figure.name !== subject) return `name was "${figure.name}"`;
  if (figure.strokes.length < 2 || figure.strokes.length > 6) return `${figure.strokes.length} strokes`;
  if (figure.anchors.length < 4 || figure.anchors.length > 6) return `${figure.anchors.length} anchors`;

  const all = figure.strokes.flat();
  for (const stroke of figure.strokes) {
    if (stroke.length < 3 || stroke.length > 24) return `a stroke with ${stroke.length} points`;
  }
  for (const point of [...all, ...figure.anchors]) {
    if (point.length !== 2 || !point.every(Number.isFinite)) return "a malformed point";
    if (Math.abs(point[0]) > 1.001 || Math.abs(point[1]) > 1.001) return "a point outside the square";
  }

  const spanX = Math.max(...all.map((point) => point[0])) - Math.min(...all.map((point) => point[0]));
  const spanY = Math.max(...all.map((point) => point[1])) - Math.min(...all.map((point) => point[1]));
  if (Math.max(spanX, spanY) < 1.4) return `too small, spans ${Math.max(spanX, spanY).toFixed(2)}`;
  if (Math.min(spanX, spanY) < 0.25) return "flat, barely two-dimensional";

  for (const anchor of figure.anchors) {
    if (distanceToArtwork(anchor, figure.strokes) > 0.08) return "an anchor floating off the artwork";
  }
  for (let left = 0; left < figure.anchors.length; left += 1) {
    for (let right = left + 1; right < figure.anchors.length; right += 1) {
      const gap = Math.hypot(figure.anchors[left][0] - figure.anchors[right][0], figure.anchors[left][1] - figure.anchors[right][1]);
      if (gap < 0.25) return "two anchors sitting on top of each other";
    }
  }
  return null;
}

async function drawBatch(client: Anthropic, subjects: readonly string[]): Promise<Map<string, Figure>> {
  const accepted = new Map<string, Figure>();
  let pending = [...subjects];
  let note = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Draw these figures: ${pending.join(", ")}.${note}` }],
      output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    });

    if (response.stop_reason === "refusal") {
      console.warn(`  declined (${response.stop_details?.category ?? "no category"})`);
      break;
    }

    let parsed: { figures?: Figure[] };
    try {
      parsed = JSON.parse(response.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
    } catch {
      console.warn(`  attempt ${attempt}: response was not JSON`);
      continue;
    }

    const rejections: string[] = [];
    for (const figure of parsed.figures ?? []) {
      if (!pending.includes(figure.name)) continue;
      const rejection = rejectionFor(figure, figure.name);
      if (rejection) {
        rejections.push(`${figure.name}: ${rejection}`);
        continue;
      }
      accepted.set(figure.name, figure);
    }

    pending = pending.filter((subject) => !accepted.has(subject));
    if (pending.length > 0) {
      console.warn(`  attempt ${attempt}: redrawing ${pending.join(", ")}${rejections.length ? ` (${rejections.join("; ")})` : ""}`);
      note = rejections.length ? `\n\nThe previous attempt was rejected: ${rejections.join("; ")}. Fix those and draw them again.` : "";
    }
  }

  for (const subject of pending) console.warn(`  giving up on ${subject}`);
  return accepted;
}

const onlyArgument = process.argv.find((argument) => argument.startsWith("--only="));
const only = onlyArgument ? onlyArgument.slice("--only=".length).split(",").map((name) => name.trim()).filter(Boolean) : null;
const subjects = only ?? SUBJECTS;

if (process.argv.includes("--dry-run")) {
  console.log(SYSTEM_PROMPT);
  console.log(`\n--- first request ---\nDraw these figures: ${subjects.slice(0, BATCH_SIZE).join(", ")}.`);
  process.exit(0);
}

// Keep whatever is already on disk, so --only redraws one subject without losing the rest.
function existingFigures(): Figure[] {
  try {
    return (JSON.parse(readFileSync(outputPath, "utf8")) as { figures: Figure[] }).figures;
  } catch {
    return [];
  }
}

const library = new Map(existingFigures().map((figure) => [figure.name, figure]));
const client = new Anthropic();

for (let start = 0; start < subjects.length; start += BATCH_SIZE) {
  const batch = subjects.slice(start, start + BATCH_SIZE);
  console.log(`batch ${start / BATCH_SIZE + 1} of ${Math.ceil(subjects.length / BATCH_SIZE)}: ${batch.join(", ")}`);
  for (const [name, figure] of await drawBatch(client, batch)) library.set(name, figure);
}

const figures = [...library.values()].sort((left, right) => left.name.localeCompare(right.name));
writeFileSync(outputPath, `${JSON.stringify({ source: MODEL, figures }, null, 2)}\n`);
console.log(`\n${figures.length} figures in ${outputPath}`);
console.log("review them with: npx tsx scripts/glyph-sheet.ts --figures --png");
