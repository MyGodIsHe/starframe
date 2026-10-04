export type Vector3 = [number, number, number];

export type SdeRecord =
  | { kind: "region"; id: number; name: string }
  | { kind: "constellation"; id: number; name: string; regionId: number }
  | { kind: "system"; id: number; name: string; constellationId: number; regionId: number; position: Vector3 }
  | { kind: "star"; id: number; systemId: number; typeId: number; radius: number; spectralClass: string }
  | { kind: "planet"; id: number; systemId: number; parentId: number; typeId: number; name?: string; radius?: number; orbit?: { radius: number; eccentricity: number }; position: Vector3 }
  | { kind: "stargate"; id: number; systemId: number; destinationGateId: number; destinationSystemId: number; position: Vector3 };

export type UniverseMetadata = {
  build: string;
  generatedAt: string;
  source: string;
};

type System = Extract<SdeRecord, { kind: "system" }>;
type Stargate = Extract<SdeRecord, { kind: "stargate" }>;

export type UniverseIndex = {
  metadata: UniverseMetadata;
  regions: { id: number; name: string; constellations: { id: number; name: string; systems: number[] }[] }[];
  systems: (Omit<System, "kind"> & { spectralClass: string; radius: number })[];
  edges: { systems: [number, number]; gates: Pick<Stargate, "id" | "systemId" | "destinationGateId">[] }[];
  startSystemId: number;
};

export type SystemResource = {
  star: Omit<Extract<SdeRecord, { kind: "star" }>, "kind" | "systemId"> | null;
  planets: Omit<Extract<SdeRecord, { kind: "planet" }>, "kind" | "systemId">[];
  gates: Omit<Stargate, "kind" | "systemId">[];
};

const AMARR_SYSTEM_ID = 30_002_187;

// The SDE's real region-ID convention: New Eden k-space regions (including Pochven) sit below
// 10000071, with a few named pocket regions (Yasna Zakh, Exordium) up to 10001004. Every ID from
// 11000000 up is non-New-Eden space the Celestial Map doesn't model - Anoikis/wormhole space
// (11000001-11000033, ~2600 systems with no stargates, since W-space only connects by wormhole)
// and several always-empty stub regions (Abyssal Deadspace, Void, etc). One threshold excludes
// all of it in a single rule.
const NEW_EDEN_MAX_REGION_ID = 11_000_000;

export function generateUniverse(records: SdeRecord[], metadata: UniverseMetadata): { index: UniverseIndex; systems: Record<string, SystemResource> } {
  const regions = records.filter((record): record is Extract<SdeRecord, { kind: "region" }> => record.kind === "region" && record.id < NEW_EDEN_MAX_REGION_ID);
  const constellations = records.filter((record): record is Extract<SdeRecord, { kind: "constellation" }> => record.kind === "constellation" && record.regionId < NEW_EDEN_MAX_REGION_ID);
  const systems = records.filter((record): record is System => record.kind === "system" && record.regionId < NEW_EDEN_MAX_REGION_ID).sort(byId);
  const systemIds = new Set(systems.map((system) => system.id));
  const stars = records.filter((record): record is Extract<SdeRecord, { kind: "star" }> => record.kind === "star" && systemIds.has(record.systemId));
  const planets = records.filter((record): record is Extract<SdeRecord, { kind: "planet" }> => record.kind === "planet" && systemIds.has(record.systemId));
  const gates = records.filter((record): record is Stargate => record.kind === "stargate" && systemIds.has(record.systemId) && systemIds.has(record.destinationSystemId));
  const regionIds = new Set(regions.map((region) => region.id));
  const constellationById = new Map(constellations.map((constellation) => [constellation.id, constellation]));
  const systemById = new Map(systems.map((system) => [system.id, system]));
  const starBySystemId = new Map(stars.map((star) => [star.systemId, star]));
  const gateById = new Map(gates.map((gate) => [gate.id, gate]));

  for (const constellation of constellations) {
    if (!regionIds.has(constellation.regionId)) fail(`Constellation ${constellation.id} has no region ${constellation.regionId}`);
  }
  for (const system of systems) {
    const constellation = constellationById.get(system.constellationId);
    if (!constellation || constellation.regionId !== system.regionId) fail(`System ${system.id} has an invalid hierarchy`);
    if (!starBySystemId.has(system.id)) fail(`System ${system.id} has no star`);
  }
  for (const planet of planets) {
    const star = starBySystemId.get(planet.systemId);
    if (!star || planet.parentId !== star.id) fail(`Planet ${planet.id} has an invalid parent`);
  }
  for (const gate of gates) {
    const destination = gateById.get(gate.destinationGateId);
    if (!systemById.has(gate.systemId) || !systemById.has(gate.destinationSystemId) || !destination || destination.destinationGateId !== gate.id || destination.systemId !== gate.destinationSystemId || destination.destinationSystemId !== gate.systemId) {
      fail(`Stargate ${gate.id} has a broken pair`);
    }
  }

  const resources: Record<string, SystemResource> = {};
  for (const system of systems) {
    const star = starBySystemId.get(system.id)!;
    resources[system.id] = {
      star: { id: star.id, typeId: star.typeId, radius: star.radius, spectralClass: star.spectralClass },
      planets: planets.filter((planet) => planet.systemId === system.id).sort(byId).map(({ kind: _, systemId: __, ...planet }) => planet),
      gates: gates.filter((gate) => gate.systemId === system.id).sort(byId).map(({ kind: _, systemId: __, ...gate }) => gate),
    };
  }

  const pairedGates = new Set<number>();
  const edges: UniverseIndex["edges"] = [];
  for (const gate of gates.sort(byId)) {
    if (pairedGates.has(gate.id)) continue;
    const destination = gateById.get(gate.destinationGateId)!;
    pairedGates.add(gate.id);
    pairedGates.add(destination.id);
    edges.push({
      systems: [Math.min(gate.systemId, destination.systemId), Math.max(gate.systemId, destination.systemId)],
      gates: [gate, destination].sort(byId).map(({ id, systemId, destinationGateId }) => ({ id, systemId, destinationGateId })),
    });
  }

  return {
    index: {
      metadata,
      regions: regions.sort(byId).map((region) => ({
        id: region.id,
        name: region.name,
        constellations: constellations.filter((constellation) => constellation.regionId === region.id).sort(byId).map((constellation) => ({
          id: constellation.id,
          name: constellation.name,
          systems: systems.filter((system) => system.constellationId === constellation.id).map((system) => system.id),
        })),
      })),
      // Duplicates the star's spectralClass and radius onto the whole-sky index (not just its
      // per-system resource), keeping whole-sky presentation data available without fetching an
      // individual system resource per star.
      systems: systems.map(({ kind: _, ...system }) => ({ ...system, spectralClass: starBySystemId.get(system.id)!.spectralClass, radius: starBySystemId.get(system.id)!.radius })),
      edges: edges.sort((left, right) => left.systems[0] - right.systems[0] || left.systems[1] - right.systems[1]),
      startSystemId: systemById.has(AMARR_SYSTEM_ID) ? AMARR_SYSTEM_ID : systems[0]?.id ?? fail("SDE contains no systems"),
    },
    systems: resources,
  };
}

function byId<T extends { id: number }>(left: T, right: T): number {
  return left.id - right.id;
}

function fail(message: string): never {
  throw new Error(message);
}
