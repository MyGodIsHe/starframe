import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { generateUniverse, type SdeRecord, type UniverseMetadata } from "../src/universe/generateUniverse";
import { parseOfficialSde } from "../src/universe/parseSde";

type Options = { input: string; output: string; indexOutput: string; build: string; generatedAt: string; source: string };

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const files = await readJsonlFiles(options.input);
  const parsedRecords = isOfficialSde(files) ? parseOfficialSde(files) : [...files.values()].flat() as SdeRecord[];
  const metadata: UniverseMetadata = { build: options.build, generatedAt: options.generatedAt, source: options.source };
  const universe = generateUniverse(parsedRecords, metadata);

  await rm(options.output, { recursive: true, force: true });
  await mkdir(join(options.output, "systems"), { recursive: true });
  await writeJson(join(options.output, "universe-index.json"), universe.index);
  await writeJson(options.indexOutput, universe.index);
  await Promise.all(Object.entries(universe.systems).map(([systemId, resource]) => writeJson(join(options.output, "systems", `${systemId}.json`), resource)));
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1]);
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  return {
    input: required("--input"),
    output: values.get("--output") ?? "public/data",
    indexOutput: values.get("--index-output") ?? "src/data/universe-index.json",
    build: required("--build"),
    generatedAt: required("--generated-at"),
    source: required("--source"),
  };
}

async function jsonlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? jsonlFiles(join(directory, entry.name))
    : entry.name.endsWith(".jsonl") ? [join(directory, entry.name)] : [],
  ))).flat().sort();
}

async function readJsonlFiles(directory: string): Promise<Map<string, unknown[]>> {
  const files = await jsonlFiles(directory);
  return new Map(await Promise.all(files.map(async (file) => [basename(file), await parseJsonLines(file)] as const)));
}

function isOfficialSde(files: Map<string, unknown[]>): boolean {
  return ["mapRegions.jsonl", "mapConstellations.jsonl", "mapSolarSystems.jsonl", "mapStars.jsonl", "mapPlanets.jsonl", "mapStargates.jsonl"].every((name) => files.has(name));
}

async function parseJsonLines(file: string): Promise<unknown[]> {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${relative(process.cwd(), file)}:${index + 1} is not valid JSON`);
    }
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

void main();
