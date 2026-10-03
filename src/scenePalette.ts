export type PlanetAppearance = {
  surface: string;
  emissive: string;
  marker: string;
};

export const SCENE_PALETTE = {
  gate: {
    idle: "#d19a52",
    active: "#ffe3a3",
  },
  orbit: {
    context: "#385268",
    trail: "#64879a",
  },
  flightTrail: {
    halo: "#238f7c",
    core: "#63e6b5",
    head: "#b8ffe3",
  },
  route: {
    arc: "#e7c568",
    connection: "#ffe0a1",
  },
} as const;

const FALLBACK_PLANET_APPEARANCE: PlanetAppearance = {
  surface: "#718b82",
  emissive: "#1c332d",
  marker: "#a9d0c1",
};

const PLANET_APPEARANCE_BY_TYPE_ID: Readonly<Record<number, PlanetAppearance>> = {
  11: { surface: "#568c70", emissive: "#173629", marker: "#9dd9b3" },
  12: { surface: "#8fb8c3", emissive: "#233f4a", marker: "#d5f4f6" },
  13: { surface: "#a58a5e", emissive: "#3b2e18", marker: "#d8bc82" },
  2014: { surface: "#397da3", emissive: "#102c40", marker: "#74c8e0" },
  2015: { surface: "#b85738", emissive: "#4a160d", marker: "#f08c5f" },
  2016: { surface: "#897461", emissive: "#2e241c", marker: "#c6aa8c" },
  2017: { surface: "#645b8d", emissive: "#211d42", marker: "#a59bd6" },
  2063: { surface: "#a65375", emissive: "#40152a", marker: "#e58fb2" },
};

export function planetAppearance(typeId: number): PlanetAppearance {
  return PLANET_APPEARANCE_BY_TYPE_ID[typeId] ?? FALLBACK_PLANET_APPEARANCE;
}
