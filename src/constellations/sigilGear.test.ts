import { describe, expect, it } from "vitest";
import { drawnEdges, isVertexVisible, type SolidPoint } from "./glyphSolid";
import { buildGear, CORNERS_PER_TOOTH, GEAR, gearProfile } from "./sigilGear";
import { readSigilModel } from "./sigilModel";

const gear = readSigilModel(buildGear())!;
const raw = buildGear();

// Everything the figure is written in is scaled on the way out, so its farthest point lands on the
// unit sphere: a tooth tip stands a half thickness off the plate's own plane, so that is the
// corner the whole body is sized by.
const SIZED = 1 / Math.hypot(1, GEAR.thickness);

// Halfway between the bore and the root of the teeth, and halfway between that root and the tips:
// the two radii that say which part of the figure a point belongs to without asking it to stand
// exactly on a radius the body was written at.
const INSIDE_THE_PLATE = ((GEAR.bore + GEAR.root) / 2) * SIZED;
const OUT_ON_A_TOOTH = ((GEAR.root + 1) / 2) * SIZED;

function acrossTheFace(point: SolidPoint): number {
  return Math.hypot(point[0], point[1]);
}

describe("buildGear", () => {
  it("is accepted as a body, so it is drawn exactly as an imported model would be", () => {
    expect(gear).not.toBeNull();
    expect(gear.name).toBe("gear");
    expect(gear.solid.faces.length).toBeGreaterThan(0);
  });

  it("closes, so the body can hide its own far side", () => {
    // A closed triangle mesh has exactly three halves of an edge per face.
    expect(gear.solid.edges).toHaveLength((gear.solid.faces.length * 3) / 2);
    for (const edge of gear.solid.edges) expect(edge.faces[0]).not.toBe(edge.faces[1]);
  });

  it("stays coarse enough to solve the facing test for, for every glyph on the sky", () => {
    // Two faces, the toothed wall and the bore, each two triangles per corner of the outline.
    expect(gear.solid.faces).toHaveLength(8 * CORNERS_PER_TOOTH * GEAR.teeth);
    expect(gear.solid.faces.length).toBeLessThanOrEqual(512);
  });

  it("cuts every tooth to the same shape, which is what makes it a gear and not a rough disc", () => {
    const profile = gearProfile();
    const first = profile.slice(0, CORNERS_PER_TOOTH);
    const pitch = (2 * Math.PI) / GEAR.teeth;

    expect(profile).toHaveLength(CORNERS_PER_TOOTH * GEAR.teeth);
    for (let tooth = 1; tooth < GEAR.teeth; tooth += 1) {
      for (let corner = 0; corner < CORNERS_PER_TOOTH; corner += 1) {
        const repeat = profile[tooth * CORNERS_PER_TOOTH + corner];
        expect(repeat.radius).toBeCloseTo(first[corner].radius);
        expect(repeat.angle - first[corner].angle).toBeCloseTo(pitch * tooth);
      }
    }
  });

  it("puts its tooth tips on the unit sphere, where a figure's farthest point goes", () => {
    const reach = gear.solid.vertices.map((vertex) => Math.hypot(vertex[0], vertex[1], vertex[2]));
    const tips = gear.solid.vertices.filter((vertex) => acrossTheFace(vertex) > OUT_ON_A_TOOTH);

    expect(Math.max(...reach)).toBeCloseTo(1);
    expect(tips).toHaveLength(2 * 2 * GEAR.teeth);
    for (const tip of tips) expect(acrossTheFace(tip)).toBeCloseTo(SIZED);
  });

  it("is a plate and not a solid: every point stands on one of its two faces, round a true bore", () => {
    for (const vertex of gear.solid.vertices) {
      expect(Math.abs(vertex[2])).toBeCloseTo(GEAR.thickness * SIZED);
      expect(acrossTheFace(vertex)).toBeGreaterThanOrEqual(GEAR.bore * SIZED - 1e-9);
    }
    // And the hole in the middle is a circle, not a polygon standing in for one.
    const bore = gear.solid.vertices.filter((vertex) => acrossTheFace(vertex) < INSIDE_THE_PLATE);
    expect(bore).toHaveLength(2 * CORNERS_PER_TOOTH * GEAR.teeth);
    for (const point of bore) expect(acrossTheFace(point)).toBeCloseTo(GEAR.bore * SIZED);
  });

  it("is wound outward, which is what lets the facing test read it at all", () => {
    for (const face of gear.solid.faces) {
      // A face of the plate points along the axis it turns about; a face of the toothed wall points
      // away from that axis, and a face of the bore points back into the hole.
      const turn = acrossTheFace(face.centre) > INSIDE_THE_PLATE ? 1 : -1;
      const outward: SolidPoint = Math.abs(face.normal[2]) > 0.5
        ? [0, 0, face.centre[2]]
        : [face.centre[0] * turn, face.centre[1] * turn, 0];

      expect(face.normal[0] * outward[0] + face.normal[1] * outward[1] + face.normal[2] * outward[2]).toBeGreaterThan(0);
    }
  });

  it("marks both face rims and the corners carried across the plate's thickness", () => {
    expect(raw.drawn).toHaveLength(5 * CORNERS_PER_TOOTH * GEAR.teeth);
    const acrossThickness = raw.drawn.filter(([from, to]) => Math.abs(raw.vertices[from][2] - raw.vertices[to][2]) > 1e-9);

    // Every turn in the toothed profile is authored through the thickness. Occlusion, rather than
    // omission from the drawing, decides which of these corners belongs to a narrow view.
    expect(acrossThickness).toHaveLength(CORNERS_PER_TOOTH * GEAR.teeth);
    for (const [from, to] of acrossThickness) {
      expect(raw.vertices[from][0]).toBeCloseTo(raw.vertices[to][0]);
      expect(raw.vertices[from][1]).toBeCloseTo(raw.vertices[to][1]);
    }
    expect(gear.solid.edges.filter((edge) => edge.drawn).length).toBeLessThan(gear.solid.edges.length / 2);
  });

  it("spreads its anchors over the tooth tips rather than pairing them across the thickness", () => {
    const anchors = gear.anchors.map((anchor) => anchor.position);

    expect(anchors.length).toBeGreaterThanOrEqual(4);
    for (const anchor of anchors) expect(Math.hypot(anchor[0], anchor[1], anchor[2])).toBeCloseTo(1);
    for (let left = 0; left < anchors.length; left += 1) {
      for (let right = left + 1; right < anchors.length; right += 1) {
        expect(Math.hypot(anchors[left][0] - anchors[right][0], anchors[left][1] - anchors[right][1])).toBeGreaterThan(0.5);
      }
    }
  });
});

describe("the gear as an observer sees it", () => {
  it("shows its teeth: the outline reaches the tips and falls back to the root between them", () => {
    // Face on, down the axis the gear turns about.
    const lines = drawnEdges(gear.solid, [0, 0, 12]);
    const radii = lines.flatMap((line) => [acrossTheFace(line.from), acrossTheFace(line.to)]);

    expect(Math.max(...radii)).toBeCloseTo(SIZED, 1);
    expect(radii.filter((radius) => Math.abs(radius - GEAR.root * SIZED) < 1e-6).length).toBeGreaterThanOrEqual(2 * GEAR.teeth);
  });

  it("shows its bore, which the plate's own near face never covers", () => {
    const radii = drawnEdges(gear.solid, [0, 0, 12]).flatMap((line) => [acrossTheFace(line.from), acrossTheFace(line.to)]);

    expect(Math.min(...radii)).toBeCloseTo(GEAR.bore * SIZED, 1);
  });

  it("collapses to a notched bar seen edge on, which is the honest view of a thing with volume", () => {
    // Along the plate's own plane: it is as wide as the gear and only as deep as the plate is thick.
    const lines = drawnEdges(gear.solid, [0, 12, 0]);
    const depth = Math.max(...lines.flatMap((line) => [Math.abs(line.from[2]), Math.abs(line.to[2])]));
    const width = Math.max(...lines.flatMap((line) => [Math.abs(line.from[0]), Math.abs(line.to[0])]));

    expect(depth).toBeCloseTo(GEAR.thickness * SIZED);
    expect(width).toBeCloseTo(SIZED, 1);
  });

  it("hides its own far face rather than drawing through itself", () => {
    const observer: SolidPoint = [0, 0, 12];
    // A tooth tip on the near face, and the same tip on the far face directly behind it. An opaque
    // plate shows the first and not the second.
    const tipAt = (side: number): number => gear.solid.vertices.findIndex((vertex) =>
      acrossTheFace(vertex) > OUT_ON_A_TOOTH && Math.sign(vertex[2]) === side && vertex[1] > 0);

    expect(tipAt(1)).toBeGreaterThanOrEqual(0);
    expect(tipAt(-1)).toBeGreaterThanOrEqual(0);
    expect(isVertexVisible(gear.solid, tipAt(1), observer)).toBe(true);
    expect(isVertexVisible(gear.solid, tipAt(-1), observer)).toBe(false);
  });
});
