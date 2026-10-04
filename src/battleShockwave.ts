import { DISTANCE_CUE_DISTANCE } from "./interstellarProjection";
import type { BattleTier } from "./battleSimulation";

// The warm colour a Tier burns at, shared by a Battle Beacon's point and the Battle Shockwave it
// throws, so the pulse and its wave read as one light rather than two effects that happen to
// overlap. Higher Tiers run deeper and angrier.
export const BATTLE_TIER_COLOR: Record<BattleTier, readonly [number, number, number]> = {
  1: [1, 0.55, 0.32],
  2: [1, 0.4, 0.22],
  3: [1, 0.28, 0.14],
};

// A Battle Shockwave's drawn diameter, as a fraction of the viewport height: the first number is a
// wave the observer all but stands inside, the second the farthest Battle Beacon the Celestial Map
// still shows one for. The falloff shares DISTANCE_CUE_DISTANCE with the Distance Cue - and takes
// the same hyperbolic shape as it and as Glyph Star Size - so how large a wave swells and how
// bright its Beacon burns tell one story about distance instead of two authored ones. Half of all
// gate neighbours stand within one light year, which is exactly the Distance Cue's midpoint: a
// battle one jump away fills about half the sky, while one across the cluster stays a small ring.
export const SHOCKWAVE_SPAN_NEAR = 1.15;
export const SHOCKWAVE_SPAN_FAR = 0.04;

// How much of a wave's size a small ship is worth. Magnitude never takes a wave to nothing, because
// the Explosion Event it belongs to is a ship dying either way; it only says how far the front gets.
export const SHOCKWAVE_MAGNITUDE_FLOOR = 0.6;

// Where the front stands across its own billboard, from the moment it leaves the hull to the edge
// of the quad, and the exponent that decelerates it. A real blast wave loses speed to the volume it
// sweeps, so it covers most of its reach early and crawls at the end; a linear ramp reads as an
// expanding circle rather than something driven outward by a detonation.
export const SHOCKWAVE_FRONT_MIN = 0.08;
export const SHOCKWAVE_FRONT_MAX = 0.88;
export const SHOCKWAVE_FRONT_EASE = 0.62;

// How thick the shell is at birth and at death, as a fraction of the billboard. The front thickens
// as it dissipates: a young wave is a hard-edged line of light, an old one a wide soft band.
export const SHOCKWAVE_THICKNESS_MIN = 0.07;
export const SHOCKWAVE_THICKNESS_MAX = 0.36;

// The shell's cross-section. It is deliberately asymmetric: compressed gas piles up against a near
// vertical outer edge, while behind the front the glow drains away over several times that width -
// which is what gives a wave a direction, instead of a ring that could be expanding or contracting.
export const SHOCKWAVE_OUTER_SHARPNESS = 7;
export const SHOCKWAVE_INNER_SOFTNESS = 1.05;
export const SHOCKWAVE_RIM_SHARPNESS = 26;
export const SHOCKWAVE_SHELL_GAIN = 0.7;
export const SHOCKWAVE_RIM_GAIN = 0.34;

// The fireball left where the ship was: bright while the front is still close to it, gone well
// before the wave is.
export const SHOCKWAVE_CORE_FALLOFF = 22;
export const SHOCKWAVE_CORE_GAIN = 0.35;

// The same light spread over an ever larger shell, plus the overall fade that retires the wave.
export const SHOCKWAVE_DISSIPATION_FLOOR = 0.85;
export const SHOCKWAVE_DISSIPATION_GAIN = 0.8;
export const SHOCKWAVE_FADE_EXPONENT = 0.75;

// How sharply "near the front" is measured when the shell is given its colour, and the ramps the
// colour runs: the leading edge burns white while the wave is young, the body of the shell carries
// the Tier's own colour, and everything behind it cools into ember - light with a temperature
// across it and along its life, not one fill tinted at the end.
export const SHOCKWAVE_PROXIMITY_FALLOFF = 2.2;
// Real optics - and real expanding plasma - spread a colour out across a front rather than ending it
// on one line. The red channel is read a little further out from the front than the green and the
// blue a little tighter in, so the shell carries a warm fringe ahead of it and a cooler thread
// through its brightest line, instead of one hue stretched across the whole band.
export const SHOCKWAVE_CHROMATIC_SPREAD: readonly [number, number, number] = [0.88, 1, 1.14];
export const SHOCKWAVE_BODY_RAMP = 0.65;
export const SHOCKWAVE_CORE_RAMP = 10;
export const SHOCKWAVE_COOLING = 0.8;
export const SHOCKWAVE_WHITE_LIFE = 0.95;

// The white-hot leading edge and the cooled trail, per Tier. The core runs bluer and the trail
// deeper the hotter the Tier, so a Tier 3 wave cools from near-white through its own orange into a
// violet ember while a Tier 1 skirmish stays a dull red flicker.
export const SHOCKWAVE_CORE_COLOR: Record<BattleTier, readonly [number, number, number]> = {
  1: [1, 0.95, 0.86],
  2: [1, 0.94, 0.9],
  3: [0.97, 0.94, 1],
};

export const SHOCKWAVE_TAIL_COLOR: Record<BattleTier, readonly [number, number, number]> = {
  1: [0.3, 0.1, 0.11],
  2: [0.33, 0.08, 0.17],
  3: [0.3, 0.06, 0.26],
};

// How far the front of one wave is allowed to depart from a perfect circle. A detonation throws its
// shell into whatever the hull and the fight left around it, so a front is lumpy: two low angular
// harmonics are enough to say so without the wave ceasing to read as one expanding shell, and they
// are what keeps several waves from one battle from looking like a target drawn on the sky.
export const SHOCKWAVE_LUMP_AMPLITUDE = 0.055;

// How wide a Battle Shockwave is drawn, from the physical distance between the observer's Solar
// System and the one hosting the Explosion Event. Nothing here is normalized against the battles
// currently in the sky: a wave keeps its size when another battle ends, and growing means the
// observer came closer.
export function battleShockwaveSpan(distance: number, magnitude: number): number {
  const reach = SHOCKWAVE_SPAN_FAR + (SHOCKWAVE_SPAN_NEAR - SHOCKWAVE_SPAN_FAR) / (1 + Math.max(0, distance) / DISTANCE_CUE_DISTANCE);
  return reach * (SHOCKWAVE_MAGNITUDE_FLOOR + (1 - SHOCKWAVE_MAGNITUDE_FLOOR) * clamp(magnitude, 0, 1));
}

// The span above is a fraction of the viewport height, like a Battle Beacon's point size is a count
// of CSS pixels: both say how much of the view the thing takes, which is what "half the sky" means,
// and neither moves when the camera's field of view or the window does. This is the one place that
// turns such a span into the world-space half-width of a billboard sitting on the Celestial Map's
// own sphere, where the visible height is what the field of view spans at that radius.
export function battleShockwaveWorldRadius(span: number, sphereRadius: number, verticalFov: number): number {
  return span * sphereRadius * Math.tan(verticalFov / 2);
}

// Where the front stands and how thick the shell is, this far into the wave's life. Mirrors the
// shockwave shader in BattleBeaconOverlay.tsx, and drives the in-system Battle Flare's own shells,
// so a wave decelerates identically whether it is watched from the sky or from inside the system.
export function battleShockwaveFront(progress: number): { radius: number; thickness: number } {
  const life = clamp(progress, 0, 1);
  return {
    radius: SHOCKWAVE_FRONT_MIN + (SHOCKWAVE_FRONT_MAX - SHOCKWAVE_FRONT_MIN) * Math.pow(life, SHOCKWAVE_FRONT_EASE),
    thickness: SHOCKWAVE_THICKNESS_MIN + (SHOCKWAVE_THICKNESS_MAX - SHOCKWAVE_THICKNESS_MIN) * life,
  };
}

// How much light the wave leaves at one point of its billboard, `radius` being the distance from the
// Explosion Event's own place as a fraction of the billboard's half-width. Mirrors the shockwave
// shader's brightness so the shell's shape can be reasoned about and tested outside the GPU.
export function battleShockwaveBrightness(radius: number, progress: number): number {
  const life = clamp(progress, 0, 1);
  const { radius: front, thickness } = battleShockwaveFront(life);
  const offset = (radius - front) / thickness;
  const shell = Math.exp(-offset * offset * (offset > 0 ? SHOCKWAVE_OUTER_SHARPNESS : SHOCKWAVE_INNER_SOFTNESS));
  const rim = Math.exp(-offset * offset * SHOCKWAVE_RIM_SHARPNESS);
  const core = Math.exp(-radius * radius * SHOCKWAVE_CORE_FALLOFF) * (1 - life) * (1 - life);
  const dissipation = 1 / (SHOCKWAVE_DISSIPATION_FLOOR + SHOCKWAVE_DISSIPATION_GAIN * front);

  return (shell * SHOCKWAVE_SHELL_GAIN + rim * SHOCKWAVE_RIM_GAIN + core * SHOCKWAVE_CORE_GAIN)
    * dissipation
    * Math.pow(1 - life, SHOCKWAVE_FADE_EXPONENT);
}

// How close a point of the billboard sits to the front, 1 on the front itself and 0 deep inside the
// shell. It is what the colour ramp below is read at, so that the gradient follows the front rather
// than the centre of the blast.
export function battleShockwaveFrontProximity(radius: number, progress: number): number {
  const { radius: front, thickness } = battleShockwaveFront(clamp(progress, 0, 1));
  const offset = (radius - front) / thickness;
  return Math.exp(-offset * offset * SHOCKWAVE_PROXIMITY_FALLOFF);
}

// The colour the shell carries at one point of its billboard. Mirrors the shockwave shader's ramp:
// the front is white-hot while the wave is young and cools through the Tier colour into ember as it
// expands, and at any moment the trail behind it is already cooler than the front itself.
export function battleShockwaveTint(tier: BattleTier, proximity: number, progress: number): [number, number, number] {
  const life = clamp(progress, 0, 1);
  const front = clamp(proximity, 0, 1);
  const edge = BATTLE_TIER_COLOR[tier];
  const tail = SHOCKWAVE_TAIL_COLOR[tier];
  const core = SHOCKWAVE_CORE_COLOR[tier];

  return [0, 1, 2].map((channel) => {
    const reach = Math.pow(front, SHOCKWAVE_CHROMATIC_SPREAD[channel]);
    const cooled = mix(edge[channel], tail[channel], life * SHOCKWAVE_COOLING);
    const body = mix(tail[channel], cooled, Math.pow(reach, SHOCKWAVE_BODY_RAMP));
    return mix(body, core[channel], Math.pow(reach, SHOCKWAVE_CORE_RAMP) * (1 - life * SHOCKWAVE_WHITE_LIFE));
  }) as [number, number, number];
}

// The four coefficients that lean one wave's front out of round, drawn from the Explosion Event it
// belongs to so the same ship always dies the same shape. They are settled here rather than in the
// shader because they are one value per wave, not one per pixel of the quad it covers.
export function battleShockwaveLumps(seed: number): [number, number, number, number] {
  return [0, 1, 2, 3].map((index) => {
    const unit = hash32(seed, index * 0x9e3779b1) / 0x1_0000_0000;
    return (unit - 0.5) * 2 * SHOCKWAVE_LUMP_AMPLITUDE;
  }) as [number, number, number, number];
}

// How far out the front stands in one direction, as a multiple of its round radius. Mirrors the
// shockwave shader, which reaches the same two harmonics through the doubled unit vector rather
// than an angle, because it is spending the arithmetic on every pixel of a quad half the sky wide.
export function battleShockwaveLumpFactor(lumps: readonly [number, number, number, number], angle: number): number {
  return 1
    + lumps[0] * Math.cos(2 * angle) + lumps[1] * Math.sin(2 * angle)
    + lumps[2] * Math.cos(3 * angle) + lumps[3] * Math.sin(3 * angle);
}

function hash32(...values: number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= Math.trunc(value) >>> 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x2545f491);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
