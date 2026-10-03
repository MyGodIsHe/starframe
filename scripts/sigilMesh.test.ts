import { describe, expect, it } from "vitest";
import { clipBelow, compact, decimate, extremities, featureEdges, meshReport, normalise, parseStl, type Mesh, type MeshPoint } from "./sigilMesh";

// A closed box, which is enough to tell a crease from a flat flank and a hole from a surface.
const BOX: Mesh = {
  vertices: [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ],
  triangles: [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ],
};

// A sphere, subdivided far past anything a glyph needs: the shape the reduction has to keep while
// throwing away nine tenths of the triangles.
function sphere(rings: number, segments: number): Mesh {
  const vertices: MeshPoint[] = [[0, 1, 0], [0, -1, 0]];
  for (let ring = 1; ring < rings; ring += 1) {
    const theta = (Math.PI * ring) / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const phi = (2 * Math.PI * segment) / segments;
      vertices.push([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]);
    }
  }

  const at = (ring: number, segment: number): number => 2 + (ring - 1) * segments + (segment % segments);
  const triangles: [number, number, number][] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    triangles.push([0, at(1, segment + 1), at(1, segment)], [1, at(rings - 1, segment), at(rings - 1, segment + 1)]);
  }
  for (let ring = 1; ring + 1 < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      triangles.push([at(ring, segment), at(ring, segment + 1), at(ring + 1, segment + 1)], [at(ring, segment), at(ring + 1, segment + 1), at(ring + 1, segment)]);
    }
  }
  return { vertices, triangles };
}

function binaryStl(mesh: Mesh): Uint8Array {
  const data = new Uint8Array(84 + mesh.triangles.length * 50);
  const view = new DataView(data.buffer);
  view.setUint32(80, mesh.triangles.length, true);
  mesh.triangles.forEach((triangle, index) => {
    const offset = 84 + index * 50;
    triangle.forEach((corner, position) => {
      for (let axis = 0; axis < 3; axis += 1) view.setFloat32(offset + 12 + position * 12 + axis * 4, mesh.vertices[corner][axis], true);
    });
  });
  return data;
}

describe("parseStl", () => {
  it("welds the corners an STL repeats, so the mesh has edges to measure at all", () => {
    const parsed = parseStl(binaryStl(BOX));

    expect(parsed.triangles).toHaveLength(12);
    expect(parsed.vertices).toHaveLength(8);
    expect(meshReport(parsed).boundary).toBe(0);
  });

  it("reads the same mesh out of an ASCII file", () => {
    const text = BOX.triangles
      .map((triangle) => `facet normal 0 0 0\nouter loop\n${triangle.map((corner) => `vertex ${BOX.vertices[corner].join(" ")}`).join("\n")}\nendloop\nendfacet`)
      .join("\n");
    const parsed = parseStl(new TextEncoder().encode(`solid box\n${text}\nendsolid box\n`));

    expect(parsed.vertices).toHaveLength(8);
    expect(parsed.triangles).toHaveLength(12);
  });
});

describe("clipBelow", () => {
  it("leaves a closed surface behind, because a body with a hole cannot hide its own far side", () => {
    const cut = clipBelow(sphere(12, 16), -0.4);
    const report = meshReport(cut);

    expect(report.boundary).toBe(0);
    expect(report.nonManifold).toBe(0);
  });

  it("keeps everything above the cut and nothing below it", () => {
    const cut = clipBelow(BOX, 0);

    for (const vertex of cut.vertices) expect(vertex[1]).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...cut.vertices.map((vertex) => vertex[1]))).toBeCloseTo(1);
  });

  it("caps each severed limb on its own rather than webbing them together", () => {
    // Two boxes side by side, cut through both: one hub for both holes would sew them into one web.
    const pair: Mesh = {
      vertices: [...BOX.vertices, ...BOX.vertices.map((vertex): MeshPoint => [vertex[0] + 4, vertex[1], vertex[2]])],
      triangles: [...BOX.triangles, ...BOX.triangles.map((triangle): [number, number, number] => [triangle[0] + 8, triangle[1] + 8, triangle[2] + 8])],
    };
    const cut = clipBelow(pair, 0);

    expect(meshReport(cut).boundary).toBe(0);
    // No triangle may straddle the gap between the two boxes.
    for (const triangle of cut.triangles) {
      const xs = triangle.map((corner) => cut.vertices[corner][0]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(3);
    }
  });
});

describe("decimate", () => {
  it("reaches the triangle budget the facing test has to run over every frame", () => {
    const reduced = decimate(sphere(20, 32), 300);

    expect(reduced.triangles.length).toBeLessThanOrEqual(300);
    expect(reduced.triangles.length).toBeGreaterThan(100);
  });

  it("keeps the surface closed, which is the one property a glyph body cannot do without", () => {
    const report = meshReport(decimate(sphere(20, 32), 300));

    expect(report.boundary).toBe(0);
    expect(report.nonManifold).toBe(0);
  });

  it("keeps the shape it was given rather than any shape of the right size", () => {
    const reduced = decimate(sphere(20, 32), 300);

    for (const vertex of reduced.vertices) expect(Math.hypot(vertex[0], vertex[1], vertex[2])).toBeCloseTo(1, 1);
  });

  it("leaves a mesh already under budget alone", () => {
    expect(decimate(BOX, 100).triangles).toHaveLength(12);
  });
});

describe("featureEdges", () => {
  it("marks the creases an artist modelled and not the triangles tiling a flat flank", () => {
    // Twelve creases on a box, whatever the triangulation of its sides.
    expect(featureEdges(BOX, 45)).toHaveLength(12);
  });

  it("marks nothing when no crease is sharp enough to read as a line", () => {
    expect(featureEdges(BOX, 100)).toHaveLength(0);
  });
});

describe("normalise", () => {
  it("puts the farthest point on the unit sphere, where the farthest Solar System sits", () => {
    const { mesh } = normalise({ ...BOX, vertices: BOX.vertices.map((vertex): MeshPoint => [vertex[0] * 3 + 7, vertex[1] * 3 + 7, vertex[2] * 3 + 7]) });

    expect(Math.max(...mesh.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1], vertex[2])))).toBeCloseTo(1);
    expect(Math.min(...mesh.vertices.map((vertex) => vertex[1]))).toBeCloseTo(-1 / Math.sqrt(3));
  });
});

describe("extremities", () => {
  it("spreads the anchors across the plane the figure is drawn on", () => {
    const anchors = extremities(BOX, 4).map((index) => BOX.vertices[index]);

    expect(anchors).toHaveLength(4);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(Math.hypot(anchors[left][0] - anchors[right][0], anchors[left][1] - anchors[right][1])).toBeGreaterThan(1);
      }
    }
  });
});

describe("compact", () => {
  it("drops the triangles a cut left with no area at all", () => {
    const flattened: Mesh = { vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2], [0, 1, 3]] };

    expect(compact(flattened).triangles).toHaveLength(1);
  });
});
