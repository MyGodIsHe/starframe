import { describe, expect, it } from "vitest";
import { generateUniverse } from "./generateUniverse";
import { parseOfficialSde } from "./parseSde";

const files = new Map<string, unknown[]>([
  ["mapRegions.jsonl", [{ _key: 10000043, name: { en: "Domain" } }]],
  ["mapConstellations.jsonl", [{ _key: 20000322, name: { en: "Throne Worlds" }, regionID: 10000043 }]],
  ["mapSolarSystems.jsonl", [{ _key: 30002187, name: { en: "Amarr" }, constellationID: 20000322, regionID: 10000043, position: { x: 10, y: 20, z: 30 } }]],
  ["mapStars.jsonl", [{ _key: 40139383, solarSystemID: 30002187, typeID: 45037, radius: 310900000, statistics: { spectralClass: "K3 V" } }]],
  ["mapPlanets.jsonl", [{ _key: 40139384, solarSystemID: 30002187, orbitID: 40139383, typeID: 2063, radius: 2080000, position: { x: -36384790808, y: 2122964164, z: 16207055016 }, statistics: { orbitRadius: 39887700000, eccentricity: 0.0167 }, uniqueName: { en: "Amarr I (Mikew)" } }]],
  ["mapStargates.jsonl", []],
]);

describe("parseOfficialSde", () => {
  it("preserves official Amarr star and planet physical data", () => {
    const result = generateUniverse(parseOfficialSde(files), {
      build: "3503375",
      generatedAt: "2026-09-10T11:09:04Z",
      source: "https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-3503375-jsonl.zip",
    });

    expect(result.index.startSystemId).toBe(30002187);
    expect(result.systems["30002187"]).toMatchObject({
      star: { id: 40139383, typeId: 45037, radius: 310900000, spectralClass: "K3 V" },
      planets: [{ id: 40139384, parentId: 40139383, name: "Amarr I (Mikew)", radius: 2080000, position: [-36384790808, 2122964164, 16207055016], orbit: { radius: 39887700000, eccentricity: 0.0167 } }],
    });
  });

  it("rejects an incomplete official SDE", () => {
    expect(() => parseOfficialSde(new Map())).toThrow("Official SDE is missing");
  });
});
