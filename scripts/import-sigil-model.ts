// Brings a sculpted model into the figure library as a Sigil Figure's body.
//
// Generated volume never worked: flat line art plus a rule for depth is a guess about a shape
// nobody drew. This takes a model somebody already sculpted from every side and reduces it to
// something a glyph can be - a few hundred triangles, creases marked, upright, on the unit sphere.
//
//   npx tsx scripts/import-sigil-model.ts <model.stl> --name=wolf
//   npx tsx scripts/import-sigil-model.ts <model.stl> --name=wolf --floor=0.065
//   npx tsx scripts/import-sigil-model.ts <model.stl> --name=wolf --faces=420 --crease=24
//
//   --name    which Sigil Figure this is the body of; also the file written
//   --floor   height to cut the model off at, as a fraction of its own height: a print's display
//             plinth is the widest thing in the silhouette and says nothing about the subject
//   --faces   triangle budget; the facing test runs over every one of them, for every glyph drawn
//   --crease  dihedral angle, in degrees, above which an edge is part of the drawing rather than
//             only holding the surface together
//   --anchors how many extremities to mark for the fitter to land real Solar Systems on
//
// Run `npx tsx scripts/glyph-sheet.ts --turntable` afterwards to see the body walked round.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clipBelow, decimate, extremities, featureEdges, meshReport, normalise, parseStl, type Mesh } from "./sigilMesh";

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, "../src/data/sigil-models");

const PRECISION = 4;

const args = process.argv.slice(2);
const source = args.find((argument) => !argument.startsWith("--"));
const name = option("name") ?? (source ? basename(source).replace(/\.[^.]+$/, "") : null);
const floor = Number(option("floor") ?? NaN);
const faces = Number(option("faces") ?? 420);
const crease = Number(option("crease") ?? 24);
const anchorCount = Number(option("anchors") ?? 5);

if (!source || !name) {
  console.error("Usage: npx tsx scripts/import-sigil-model.ts <model.stl> --name=<figure> [--floor=0.06] [--faces=420] [--crease=24] [--anchors=5]");
  process.exit(1);
}

const imported = parseStl(new Uint8Array(readFileSync(resolve(process.cwd(), source))));
report("read", imported);
if (imported.triangles.length === 0) {
  console.error(`${source} holds no triangles.`);
  process.exit(1);
}

const trimmed = Number.isFinite(floor) ? clipBelow(imported, heightAt(imported, floor)) : imported;
if (Number.isFinite(floor)) report(`cut at ${floor} of its height`, trimmed);

const reduced = decimate(trimmed, faces);
report("reduced", reduced);

const { mesh, scale } = normalise(reduced);
const drawn = featureEdges(mesh, crease);
const anchors = extremities(mesh, anchorCount);
const closed = meshReport(mesh);
if (closed.boundary > 0 || closed.nonManifold > 0) {
  console.error(`The reduced surface is not closed: ${closed.boundary} boundary and ${closed.nonManifold} non-manifold edges. A body with a hole cannot hide its own far side.`);
  process.exit(1);
}

const output = {
  name,
  source: { file: basename(source), triangles: imported.triangles.length, floor: Number.isFinite(floor) ? floor : null, faces, crease, anchors: anchorCount },
  scale,
  vertices: mesh.vertices.map((vertex) => vertex.map(round)),
  triangles: mesh.triangles.map((triangle) => [...triangle]),
  drawn,
  anchors,
};

mkdirSync(outputDir, { recursive: true });
const path = resolve(outputDir, `${name}.json`);
writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);

console.log(`${drawn.length} of ${countEdges(mesh)} edges are part of the drawing, ${anchors.length} anchors marked.`);
console.log(`Wrote ${path}`);

function option(key: string): string | null {
  const found = args.find((argument) => argument.startsWith(`--${key}=`));
  return found ? found.slice(key.length + 3) : null;
}

function heightAt(mesh: Mesh, fraction: number): number {
  let low = Infinity;
  let high = -Infinity;
  for (const vertex of mesh.vertices) {
    low = Math.min(low, vertex[1]);
    high = Math.max(high, vertex[1]);
  }
  return low + (high - low) * fraction;
}

function countEdges(mesh: Mesh): number {
  const edges = new Set<string>();
  for (const triangle of mesh.triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const [from, to] = [triangle[corner], triangle[(corner + 1) % 3]];
      edges.add(from < to ? `${from}:${to}` : `${to}:${from}`);
    }
  }
  return edges.size;
}

function report(stage: string, mesh: Mesh): void {
  const counts = meshReport(mesh);
  console.log(`${stage}: ${counts.triangles} triangles, ${counts.vertices} vertices, ${counts.boundary} boundary edges, ${counts.nonManifold} non-manifold edges`);
}

function round(value: number): number {
  return Number(value.toFixed(PRECISION));
}
