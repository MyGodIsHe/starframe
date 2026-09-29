// Assigns every Constellation a figure from the library, by its real name and Region.
//
// The model is used here for the thing it is reliable at: reading 799 EVE names and picking which
// figure suits each, plus a caption. It produces no geometry - the artwork comes from
// scripts/generate-figures.ts and is placed on the real Solar Systems by the fitter. Every answer
// is checked against the library before it is written.
//
// Offline and manual, like scripts/generate-sde.ts. The result is committed, so the running app
// never calls an API and never needs a key.
//
//   npx tsx scripts/generate-motifs.ts --dry-run     print one prompt and stop
//   npx tsx scripts/generate-motifs.ts --limit=40    a trial batch, written to the same file
//   npx tsx scripts/generate-motifs.ts               the whole corpus
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGIL_FIGURES } from "../src/constellations/sigilMotifs";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "../src/data/constellation-motifs.json");

const MODEL = "claude-haiku-4-5";
const BATCH_SIZE = 40;
const MAX_ATTEMPTS = 2;

type RawIndex = {
  metadata: { build: string };
  regions: { id: number; name: string; constellations: { id: number; name: string }[] }[];
};

type Candidate = { id: number; name: string; region: string };
type Motif = { figure: string; caption: string };

const FIGURE_NAMES = SIGIL_FIGURES.map((figure) => figure.name);
if (FIGURE_NAMES.length === 0) throw new Error("the figure library is empty - run scripts/generate-figures.ts first");

const SYSTEM_PROMPT = `You assign a figure to each constellation of New Eden, the setting of EVE Online.

For every constellation you are given its official name and the region it belongs to. Choose the figure that best fits what the name evokes and what its region is known for in EVE lore - the four empires (Amarr, Caldari, Gallente, Minmatar), their factional character, and the character of nullsec and lowsec space.

The figures available: ${FIGURE_NAMES.join(", ")}.

Rules:
- figure must be exactly one of the names above.
- caption is one short phrase in Russian, at most 40 characters, saying what the sigil stands for. No quotes, no trailing period.
- Let the individual name lead. Do not give the same figure to every constellation of a region, and spread your choices across the whole list rather than leaning on a few favourites.
- Return one entry for every constellation you were given, keyed by the id you were given.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["motifs"],
  properties: {
    motifs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "figure", "caption"],
        properties: {
          id: { type: "integer" },
          figure: { type: "string", enum: FIGURE_NAMES },
          caption: { type: "string" },
        },
      },
    },
  },
};

function loadCandidates(): Candidate[] {
  const universe = JSON.parse(readFileSync(resolve(here, "../src/data/universe-index.json"), "utf8")) as RawIndex;
  return universe.regions.flatMap((region) =>
    region.constellations.map((constellation) => ({ id: constellation.id, name: constellation.name, region: region.name })),
  );
}

function promptFor(batch: readonly Candidate[]): string {
  return batch.map((candidate) => `${candidate.id}\t${candidate.name}\t${candidate.region}`).join("\n");
}

function isValid(entry: { figure: string; caption: string }): boolean {
  return FIGURE_NAMES.includes(entry.figure) && entry.caption.trim().length > 0 && entry.caption.length <= 60;
}

// A constellation the model never answered for, or answered for with a figure that is not in the
// library, keeps a stable draw from its own id rather than blocking the run.
function fallbackFor(candidate: Candidate): Motif {
  let hash = candidate.id >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return { figure: FIGURE_NAMES[hash % FIGURE_NAMES.length], caption: candidate.name };
}

async function askFor(client: Anthropic, batch: readonly Candidate[]): Promise<Map<number, Motif>> {
  const resolved = new Map<number, Motif>();
  let pending = [...batch];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && pending.length > 0; attempt += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: promptFor(pending) }],
      output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    });

    if (response.stop_reason === "refusal") {
      console.warn(`  batch declined (${response.stop_details?.category ?? "no category"}), falling back`);
      break;
    }

    const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    let parsed: { motifs?: { id: number; figure: string; caption: string }[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn(`  attempt ${attempt}: response was not JSON, retrying`);
      continue;
    }

    const wanted = new Set(pending.map((candidate) => candidate.id));
    for (const entry of parsed.motifs ?? []) {
      if (!wanted.has(entry.id) || !isValid(entry)) continue;
      resolved.set(entry.id, { figure: entry.figure, caption: entry.caption.trim() });
    }

    pending = pending.filter((candidate) => !resolved.has(candidate.id));
    if (pending.length > 0) console.warn(`  attempt ${attempt}: ${pending.length} unanswered or invalid, retrying those`);
  }

  for (const candidate of pending) resolved.set(candidate.id, fallbackFor(candidate));
  return resolved;
}

const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = limitArgument ? Number(limitArgument.slice("--limit=".length)) : null;
const candidates = limit === null ? loadCandidates() : loadCandidates().slice(0, limit);

if (process.argv.includes("--dry-run")) {
  console.log(SYSTEM_PROMPT);
  console.log("\n--- first batch ---\n");
  console.log(promptFor(candidates.slice(0, BATCH_SIZE)));
  process.exit(0);
}

const client = new Anthropic();
const motifs = new Map<number, Motif>();
let fallbacks = 0;

for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
  const batch = candidates.slice(start, start + BATCH_SIZE);
  console.log(`batch ${start / BATCH_SIZE + 1} of ${Math.ceil(candidates.length / BATCH_SIZE)} (${batch.length} constellations)`);
  const answers = await askFor(client, batch);
  for (const candidate of batch) {
    const motif = answers.get(candidate.id) ?? fallbackFor(candidate);
    if (!answers.has(candidate.id)) fallbacks += 1;
    motifs.set(candidate.id, motif);
  }
}

const byId = Object.fromEntries([...motifs].sort((left, right) => left[0] - right[0]));
const universeBuild = (JSON.parse(readFileSync(resolve(here, "../src/data/universe-index.json"), "utf8")) as RawIndex).metadata.build;
writeFileSync(outputPath, `${JSON.stringify({ sdeBuild: universeBuild, model: MODEL, motifs: byId }, null, 2)}\n`);

const figureCounts = new Map<string, number>();
for (const motif of motifs.values()) figureCounts.set(motif.figure, (figureCounts.get(motif.figure) ?? 0) + 1);
console.log(`
${motifs.size} motifs written to ${outputPath}`);
console.log(`fallbacks used: ${fallbacks}`);
console.log(`figure spread: ${[...figureCounts].sort((left, right) => right[1] - left[1]).map(([figure, count]) => `${figure}=${count}`).join(" ")}`);
