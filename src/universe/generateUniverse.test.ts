import { describe, expect, it } from "vitest";
import { generateUniverse, type SdeRecord } from "./generateUniverse";

const metadata = {
  build: "3503375",
  generatedAt: "2026-09-21T00:00:00.000Z",
  source: "https://developers.eveonline.com/docs/services/sde/",
};

const records: SdeRecord[] = [
  { kind: "region", id: 10000043, name: "Domain" },
  { kind: "constellation", id: 20000314, name: "Throne Worlds", regionId: 10000043 },
  { kind: "system", id: 30002187, name: "Amarr", constellationId: 20000314, regionId: 10000043, position: [10, 20, 30] },
  { kind: "system", id: 30002188, name: "Hedion", constellationId: 20000314, regionId: 10000043, position: [40, 50, 60] },
  { kind: "star", id: 40001428, systemId: 30002187, typeId: 45030, radius: 1_004_000_000, spectralClass: "K2 V" },
  { kind: "star", id: 40001430, systemId: 30002188, typeId: 45030, radius: 900_000_000, spectralClass: "M4 V" },
  { kind: "planet", id: 40001429, systemId: 30002187, parentId: 40001428, typeId: 2014, position: [1, 2, 3] },
  { kind: "stargate", id: 50000001, systemId: 30002187, destinationGateId: 50000002, destinationSystemId: 30002188, position: [7, 8, 9] },
  { kind: "stargate", id: 50000002, systemId: 30002188, destinationGateId: 50000001, destinationSystemId: 30002187, position: [9, 8, 7] },
];

describe("generateUniverse", () => {
  it("builds a deterministic hierarchy, graph, and separate system resources", () => {
    const result = generateUniverse(records, metadata);

    expect(result).toEqual({
      index: {
        metadata,
        regions: [{ id: 10000043, name: "Domain", constellations: [{ id: 20000314, name: "Throne Worlds", systems: [30002187, 30002188] }] }],
        systems: [
          { id: 30002187, name: "Amarr", constellationId: 20000314, regionId: 10000043, position: [10, 20, 30], spectralClass: "K2 V", radius: 1_004_000_000 },
          { id: 30002188, name: "Hedion", constellationId: 20000314, regionId: 10000043, position: [40, 50, 60], spectralClass: "M4 V", radius: 900_000_000 },
        ],
        edges: [{ systems: [30002187, 30002188], gates: [{ id: 50000001, systemId: 30002187, destinationGateId: 50000002 }, { id: 50000002, systemId: 30002188, destinationGateId: 50000001 }] }],
        startSystemId: 30002187,
      },
      systems: {
        "30002187": {
          star: { id: 40001428, typeId: 45030, radius: 1_004_000_000, spectralClass: "K2 V" },
          planets: [{ id: 40001429, parentId: 40001428, typeId: 2014, position: [1, 2, 3] }],
          gates: [{ id: 50000001, destinationGateId: 50000002, destinationSystemId: 30002188, position: [7, 8, 9] }],
        },
        "30002188": { star: { id: 40001430, typeId: 45030, radius: 900_000_000, spectralClass: "M4 V" }, planets: [], gates: [{ id: 50000002, destinationGateId: 50000001, destinationSystemId: 30002187, position: [9, 8, 7] }] },
      },
    });
  });

  it("excludes non-New-Eden regions (Anoikis, Abyssal Deadspace, ...) entirely", () => {
    const result = generateUniverse([
      ...records,
      { kind: "region", id: 11000001, name: "A-R00001" },
      { kind: "constellation", id: 21000001, name: "AD-N76", regionId: 11000001 },
      { kind: "system", id: 31000001, name: "J165416", constellationId: 21000001, regionId: 11000001, position: [70, 80, 90] },
      { kind: "star", id: 41000001, systemId: 31000001, typeId: 45030, radius: 500_000_000, spectralClass: "K2 V" },
      { kind: "planet", id: 41000002, systemId: 31000001, parentId: 41000001, typeId: 2014, position: [4, 5, 6] },
    ], metadata);

    expect(result.index.regions.map((region) => region.id)).not.toContain(11000001);
    expect(result.index.systems.map((system) => system.id)).not.toContain(31000001);
    expect(result.systems).not.toHaveProperty("31000001");
  });

  it("retains available planet names and radii in the system resource", () => {
    const result = generateUniverse([
      ...records,
      { kind: "planet", id: 40001431, systemId: 30002187, parentId: 40001428, typeId: 2015, name: "Amarr I", radius: 3_390_000, position: [40_000_000, 0, 0] },
    ], metadata);

    expect(result.systems["30002187"].planets).toContainEqual({
      id: 40001431,
      parentId: 40001428,
      typeId: 2015,
      name: "Amarr I",
      radius: 3_390_000,
      position: [40_000_000, 0, 0],
    });
  });

  it.each<{ records: SdeRecord[] }>([
    { records: [{ kind: "constellation", id: 1, name: "Broken", regionId: 99 }] },
    { records: [{ kind: "system", id: 1, name: "Broken", constellationId: 2, regionId: 3, position: [0, 0, 0] }] },
    { records: [{ kind: "planet", id: 1, systemId: 2, parentId: 3, typeId: 4, position: [0, 0, 0] }] },
    { records: [
      { kind: "system", id: 1, name: "One", constellationId: 2, regionId: 3, position: [0, 0, 0] },
      { kind: "system", id: 4, name: "Two", constellationId: 2, regionId: 3, position: [0, 0, 0] },
      { kind: "stargate", id: 5, systemId: 1, destinationGateId: 6, destinationSystemId: 4, position: [0, 0, 0] },
    ] },
  ])("rejects invalid source data", ({ records: invalidRecords }) => {
    expect(() => generateUniverse(invalidRecords, metadata)).toThrow();
  });
});
