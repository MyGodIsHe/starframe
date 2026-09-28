export type AmbientFlightTrailPoint = {
  id: string;
  position: [number, number, number];
};

export type AmbientFlightTrail = {
  from: AmbientFlightTrailPoint;
  to: AmbientFlightTrailPoint;
  startedAt: number;
  duration: number;
  tailFraction: number;
};

export type AmbientFlightTrailFrame = {
  head: [number, number, number];
  tail: [number, number, number];
  opacity: number;
};

export type AmbientFlightTrailProfile = "desktop" | "mobile";

type AmbientFlightTrailState = {
  randomState: number;
  nextStartedAt: number;
  active: AmbientFlightTrail | null;
  profile: AmbientFlightTrailProfile;
};

const PROFILE_SETTINGS = {
  desktop: { interval: [1, 2], duration: [0.7, 1.2], tailFraction: 0.16 },
  mobile: { interval: [1, 2], duration: [0.75, 1.15], tailFraction: 0.13 },
} as const;

const MAX_SCHEDULE_CATCH_UP = 60;
const MAX_SUPPORTED_TIME = 1_000_000_000;

export function createAmbientFlightTrailState(seed: number, profile: AmbientFlightTrailProfile, startedAt = 0): AmbientFlightTrailState {
  const state: AmbientFlightTrailState = {
    randomState: seed >>> 0 || 0x9e3779b9,
    nextStartedAt: startedAt,
    active: null,
    profile,
  };
  const [minimumInterval, maximumInterval] = PROFILE_SETTINGS[profile].interval;
  state.nextStartedAt += randomBetween(state, minimumInterval, maximumInterval);
  return state;
}

export function updateAmbientFlightTrail(state: AmbientFlightTrailState, points: readonly AmbientFlightTrailPoint[], now: number): AmbientFlightTrailFrame | null {
  if (!Number.isFinite(now) || Math.abs(now) > MAX_SUPPORTED_TIME) return null;
  if (now - state.nextStartedAt > MAX_SCHEDULE_CATCH_UP) {
    state.active = null;
    const [minimumInterval, maximumInterval] = PROFILE_SETTINGS[state.profile].interval;
    state.nextStartedAt = now + randomBetween(state, minimumInterval, maximumInterval);
    return null;
  }

  while (now >= state.nextStartedAt) {
    const route = selectRoute(state, points);
    if (!route) {
      state.active = null;
      return null;
    }

    const startedAt = state.nextStartedAt;
    const settings = PROFILE_SETTINGS[state.profile];
    const duration = randomBetween(state, settings.duration[0], settings.duration[1]);
    state.active = { ...route, startedAt, duration, tailFraction: settings.tailFraction };
    state.nextStartedAt = startedAt + duration + randomBetween(state, settings.interval[0], settings.interval[1]);
  }

  const trail = state.active;
  if (!trail || now > trail.startedAt + trail.duration) {
    state.active = null;
    return null;
  }

  return sampleAmbientFlightTrail(trail, now);
}

export function sampleAmbientFlightTrail(trail: AmbientFlightTrail, now: number): AmbientFlightTrailFrame {
  const progress = clamp((now - trail.startedAt) / trail.duration, 0, 1);
  const tailProgress = Math.max(0, progress - trail.tailFraction);
  const fadeIn = clamp(progress / 0.12, 0, 1);
  const fadeOut = clamp((1 - progress) / 0.22, 0, 1);

  return {
    head: interpolate(trail.from.position, trail.to.position, progress),
    tail: interpolate(trail.from.position, trail.to.position, tailProgress),
    opacity: fadeIn * fadeOut,
  };
}

function selectRoute(state: AmbientFlightTrailState, points: readonly AmbientFlightTrailPoint[]): Pick<AmbientFlightTrail, "from" | "to"> | null {
  const routes: [AmbientFlightTrailPoint, AmbientFlightTrailPoint][] = [];
  for (let fromIndex = 0; fromIndex < points.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < points.length; toIndex += 1) {
      routes.push([points[fromIndex], points[toIndex]]);
    }
  }
  if (routes.length === 0) return null;

  const route = routes[Math.floor(random(state) * routes.length)];
  return random(state) < 0.5 ? { from: route[0], to: route[1] } : { from: route[1], to: route[0] };
}

function randomBetween(state: AmbientFlightTrailState, min: number, max: number): number {
  return min + (max - min) * random(state);
}

function random(state: AmbientFlightTrailState): number {
  state.randomState = (state.randomState * 1664525 + 1013904223) >>> 0;
  return state.randomState / 0x100000000;
}

function interpolate(from: [number, number, number], to: [number, number, number], amount: number): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
