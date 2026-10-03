export type RenderQuality = {
  name: "desktop" | "mobile";
  dpr: [number, number];
  starCount: number;
  sphereSegments: number;
  planetSegments: number;
  planetMarkerSegments: number;
  orbitSegments: number;
  gateSegments: number;
  trailSegments: number;
  previewSegments: number;
  maxFlareAnchors: number;
  maxGlowPointsPerAnchor: number;
  maxWaveShellsPerAnchor: number;
  maxBattleBeacons: number;
  maxSkyRingEffects: number;
  starHaloMaxSize: number;
  starHaloIntensity: number;
  starHaloEdgeScaleMax: number;
  skyNoiseComplexity: number;
};

type RenderEnvironment = {
  width: number;
  devicePixelRatio: number;
  coarsePointer: boolean;
};

const DESKTOP_QUALITY: RenderQuality = {
  name: "desktop",
  dpr: [1, 1.75],
  starCount: 520,
  sphereSegments: 64,
  planetSegments: 20,
  planetMarkerSegments: 10,
  orbitSegments: 96,
  gateSegments: 20,
  trailSegments: 12,
  previewSegments: 20,
  maxFlareAnchors: 3,
  maxGlowPointsPerAnchor: 40,
  maxWaveShellsPerAnchor: 5,
  maxBattleBeacons: 48,
  maxSkyRingEffects: 12,
  starHaloMaxSize: 26,
  starHaloIntensity: 1,
  starHaloEdgeScaleMax: 1.8,
  skyNoiseComplexity: 3,
};

const MOBILE_QUALITY: RenderQuality = {
  name: "mobile",
  dpr: [1, 1.25],
  starCount: 180,
  sphereSegments: 28,
  planetSegments: 12,
  planetMarkerSegments: 6,
  orbitSegments: 48,
  gateSegments: 12,
  trailSegments: 6,
  previewSegments: 10,
  maxFlareAnchors: 2,
  maxGlowPointsPerAnchor: 16,
  maxWaveShellsPerAnchor: 3,
  maxBattleBeacons: 24,
  maxSkyRingEffects: 6,
  starHaloMaxSize: 14,
  starHaloIntensity: 0.65,
  starHaloEdgeScaleMax: 1.45,
  skyNoiseComplexity: 1,
};

export function selectRenderQuality({ width, devicePixelRatio, coarsePointer }: RenderEnvironment): RenderQuality {
  return coarsePointer || width <= 600 || devicePixelRatio > 2 ? MOBILE_QUALITY : DESKTOP_QUALITY;
}
