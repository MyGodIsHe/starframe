import type { SdeRecord, Vector3 } from "./generateUniverse";

type SdeJson = Record<string, unknown>;

export function parseOfficialSde(files: Map<string, unknown[]>): SdeRecord[] {
  const stars = records(files, "mapStars.jsonl");
  const starSystemIds = new Set(stars.map((star) => number(star, "solarSystemID")));
  // The official export includes service-only systems without a star; they cannot form a local system resource.
  const systems = records(files, "mapSolarSystems.jsonl").filter((system) => starSystemIds.has(number(system, "_key")));
  const systemIds = new Set(systems.map((system) => number(system, "_key")));
  const namesBySystemId = new Map(systems.map((system) => [number(system, "_key"), localizedName(system)]));

  return [
    ...records(files, "mapRegions.jsonl").map((region) => ({ kind: "region" as const, id: number(region, "_key"), name: localizedName(region) })),
    ...records(files, "mapConstellations.jsonl").map((constellation) => ({ kind: "constellation" as const, id: number(constellation, "_key"), name: localizedName(constellation), regionId: number(constellation, "regionID") })),
    ...systems.map((system) => ({
      kind: "system" as const,
      id: number(system, "_key"),
      name: localizedName(system),
      constellationId: number(system, "constellationID"),
      regionId: number(system, "regionID"),
      position: vector(system),
    })),
    ...stars.filter((star) => systemIds.has(number(star, "solarSystemID"))).map((star) => ({
      kind: "star" as const,
      id: number(star, "_key"),
      systemId: number(star, "solarSystemID"),
      typeId: number(star, "typeID"),
      radius: number(star, "radius"),
      spectralClass: stringValue(object(star, "statistics"), "spectralClass"),
    })),
    ...records(files, "mapPlanets.jsonl").filter((planet) => systemIds.has(number(planet, "solarSystemID"))).map((planet) => {
      const statistics = optionalObject(planet, "statistics");
      const orbitRadius = optionalNumber(statistics, "orbitRadius");
      const eccentricity = optionalNumber(statistics, "eccentricity");
      return {
        kind: "planet" as const,
        id: number(planet, "_key"),
        systemId: number(planet, "solarSystemID"),
        parentId: number(planet, "orbitID"),
        typeId: number(planet, "typeID"),
        name: optionalLocalizedName(planet) ?? `${namesBySystemId.get(number(planet, "solarSystemID")) ?? "Unknown"} ${number(planet, "celestialIndex")}`,
        radius: number(planet, "radius"),
        ...(orbitRadius !== undefined && eccentricity !== undefined ? { orbit: { radius: orbitRadius, eccentricity } } : {}),
        position: vector(planet),
      };
    }),
    ...records(files, "mapStargates.jsonl").filter((gate) => systemIds.has(number(gate, "solarSystemID")) && systemIds.has(number(object(gate, "destination"), "solarSystemID"))).map((gate) => ({
      kind: "stargate" as const,
      id: number(gate, "_key"),
      systemId: number(gate, "solarSystemID"),
      destinationGateId: number(object(gate, "destination"), "stargateID"),
      destinationSystemId: number(object(gate, "destination"), "solarSystemID"),
      position: vector(gate),
    })),
  ];
}

function records(files: Map<string, unknown[]>, name: string): SdeJson[] {
  const entries = files.get(name);
  if (!entries) throw new Error(`Official SDE is missing ${name}`);
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${name} contains an invalid record`);
    return entry as SdeJson;
  });
}

function object(record: SdeJson, key: string): SdeJson {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`SDE record has no object ${key}`);
  return value as SdeJson;
}

function optionalObject(record: SdeJson, key: string): SdeJson | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as SdeJson : undefined;
}

function number(record: SdeJson, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`SDE record has no finite number ${key}`);
  return value;
}

function optionalNumber(record: SdeJson | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(record: SdeJson, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`SDE record has no string ${key}`);
  return value;
}

function vector(record: SdeJson): Vector3 {
  const position = object(record, "position");
  return [number(position, "x"), number(position, "y"), number(position, "z")];
}

function localizedName(record: SdeJson): string {
  return stringValue(object(record, "name"), "en");
}

function optionalLocalizedName(record: SdeJson): string | undefined {
  const value = record.uniqueName;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const name = value as SdeJson;
  return typeof name.en === "string" ? name.en : undefined;
}
