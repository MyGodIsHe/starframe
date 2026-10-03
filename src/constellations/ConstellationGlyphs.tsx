import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, type InterleavedBufferAttribute, Mesh, NormalBlending, ShaderMaterial, Vector2 } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { RenderQuality } from "../renderQuality";
import { SCENE_PALETTE } from "../scenePalette";
import { glyphBucketStyles, glyphStrokeIntensity, writeGlyphColor, GLYPH_BUCKET_BY_KIND, GLYPH_BUCKET_COUNT } from "./glyphLineStyle";
import { TRAVEL_DURATION, type TravelFrame } from "../travelCoordinates";
import { assignGlyphColors } from "./glyphColoring";
import {
  GLYPH_STAR_BODY_WHITENING,
  GLYPH_STAR_CHROMATIC_SPREAD,
  GLYPH_STAR_CORE_WHITENING,
  GLYPH_STAR_DEEPEN_FADE,
  GLYPH_STAR_SPIKE_REACH_MAX,
  GLYPH_STAR_SPIKE_REACH_MIN,
  GLYPH_STAR_TIP_SATURATION,
  GLYPH_STAR_TWINKLE_PERIOD_SECONDS,
  GLYPH_STAR_WHITE_FADE,
  glyphStarDiameter,
  glyphStarSpikePhase,
} from "./glyphStarSpikes";
import {
  projectTravelConstellationGlyphs,
  type ConstellationGlyph,
  type ConstellationGlyphIndex,
} from "./constellationGlyphModel";

type GlyphLineBucket = {
  geometry: LineSegmentsGeometry;
  objects: readonly [LineSegments2, LineSegments2, LineSegments2];
  outerOpacity: number;
  haloOpacity: number;
  positions: Float32Array;
  colors: Float32Array;
  opacityStart: InstancedBufferAttribute;
  opacityEnd: InstancedBufferAttribute;
  capStart: InstancedBufferAttribute;
  capEnd: InstancedBufferAttribute;
};

type GlyphNodes = {
  geometry: InstancedBufferGeometry;
  object: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  positions: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
};

type GlyphRenderState = {
  buckets: GlyphLineBucket[];
  strokeCapacity: number;
  nodes: GlyphNodes;
  nodeCapacity: number;
};

const SPIKE_VERTEX_SHADER = `
  uniform float uTime;
  uniform vec2 uViewport;
  uniform float uPixelRatio;
  attribute vec3 instancePosition;
  attribute vec3 instanceColor;
  attribute float instanceOpacity;
  attribute float instanceSize;
  attribute float twinklePhase;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vSwap;
  varying vec2 vAxisBias;
  varying float vUnitsPerPixel;

  const float TWINKLE_SPEED = ${(Math.PI * 2 / GLYPH_STAR_TWINKLE_PERIOD_SECONDS).toFixed(8)};

  void main() {
    vUv = uv;
    vColor = instanceColor;
    vOpacity = instanceOpacity;
    // Where the twinkle stands this frame, and which pair of optical axes this star leans on. Both
    // are one value per star rather than per pixel, so they are settled here instead of under every
    // one of the thousands of fragments a star covers.
    vSwap = sin(uTime * TWINKLE_SPEED + twinklePhase);
    vAxisBias = vec2(cos(twinklePhase), sin(twinklePhase));
    // The fragment shader measures everything in a [-1,1] square spanning the whole billboard, so
    // this is how much of that square a single device pixel covers - the spacing it reads the flare
    // at, several times per pixel. instanceSize is a CSS-pixel width, matching uViewport below.
    vUnitsPerPixel = 2.0 / max(instanceSize * uPixelRatio, 1.0);
    vec4 clipCenter = projectionMatrix * modelViewMatrix * vec4(instancePosition, 1.0);
    clipCenter.xy += position.xy * instanceSize * (2.0 / uViewport) * clipCenter.w;
    gl_Position = clipCenter;
  }
`;

// The reference is a soft overexposed flare, not a line drawing. Distance to four optical axes forms
// eight rays; a radius-dependent Gaussian width makes every ray broad at the white centre and taper
// into a blurred point. All math is evaluated on a billboard quad, avoiding POINTS raster snapping
// while the camera moves.
//
// Light is gathered into bands first and given a colour only afterwards, because a flare has a
// temperature across it rather than one fill: the core burns white, the body of an arm carries the
// Glyph colour, and the far half of the arm deepens into it with the channels spread slightly apart.
// The bands also hold three widths of blur, so an arm has a bright thread, a soft shoulder and a
// wide haze around it instead of one hard Gaussian edge.
const SPIKE_FRAGMENT_SHADER = `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vSwap;
  varying vec2 vAxisBias;
  varying float vUnitsPerPixel;

  const float REACH_MIN = ${GLYPH_STAR_SPIKE_REACH_MIN.toFixed(3)};
  const float REACH_MAX = ${GLYPH_STAR_SPIKE_REACH_MAX.toFixed(3)};
  const float CORE_WHITENING = ${GLYPH_STAR_CORE_WHITENING.toFixed(3)};
  const float BODY_WHITENING = ${GLYPH_STAR_BODY_WHITENING.toFixed(3)};
  const float TIP_SATURATION = ${GLYPH_STAR_TIP_SATURATION.toFixed(3)};
  const float CHROMATIC_SPREAD = ${GLYPH_STAR_CHROMATIC_SPREAD.toFixed(3)};
  const vec2 WHITE_FADE = vec2(${GLYPH_STAR_WHITE_FADE[0].toFixed(3)}, ${GLYPH_STAR_WHITE_FADE[1].toFixed(3)});
  const vec2 DEEPEN_FADE = vec2(${GLYPH_STAR_DEEPEN_FADE[0].toFixed(3)}, ${GLYPH_STAR_DEEPEN_FADE[1].toFixed(3)});

  float gaussian(float distanceToAxis, float width) {
    float ratio = distanceToAxis / width;
    return exp(-ratio * ratio);
  }

  float decay(float distance) {
    return exp(-distance * distance);
  }

  // One reading of the flare at one point of the billboard. x is the soft haze around the arms, y
  // all the light there is, z the white-hot core on its own, and w that light weighted by how far
  // out an arm it sits - which is how main() recovers one reach for a pixel the blur has mixed
  // several into.
  vec4 flareAt(vec2 point, float swap) {
    float radius = length(point);
    // Eight arms are the fourth harmonic of the angle, and doubling a unit direction twice gives
    // cos/sin of four times that angle outright. Every pixel of every star pays for this four times
    // over, so it is worth not spending an atan and a sine of a multiple angle to say the same thing.
    vec2 unit = point / max(radius, 1e-6);
    vec2 doubled = vec2(unit.x * unit.x - unit.y * unit.y, 2.0 * unit.x * unit.y);
    vec2 quadrupled = vec2(doubled.x * doubled.x - doubled.y * doubled.y, 2.0 * doubled.x * doubled.y);
    float axisDistance = radius * abs(quadrupled.y);
    // alternate is 1 on the four arms lying along the optical axes, 0 on the four between them, and the
    // sine hands the
    // stretch from one set to the other and back once per period, so four arms reach out while four
    // draw in and then they trade places - the star twinkles instead of breathing as a whole.
    // glyphStarSpikes.glyphStarSpikeReach mirrors this reach for tests.
    float alternate = 0.5 + 0.5 * quadrupled.x;
    float stretch = 0.5 + (alternate - 0.5) * swap;
    float along = clamp(radius / mix(REACH_MIN, REACH_MAX, stretch), 0.0, 1.2);
    float taper = mix(0.16, 0.014, smoothstep(0.0, 1.0, along));
    float petal = gaussian(axisDistance, taper) * decay(along * 1.15);
    float softPetal = gaussian(axisDistance, taper * 2.15) * decay(along * 1.34);
    float hazePetal = gaussian(axisDistance, taper * 4.6) * decay(along * 1.62);
    float ridge = gaussian(axisDistance, max(taper * 0.34, 0.004)) * exp(-along * 2.1);
    float tipFade = 1.0 - smoothstep(0.78, 1.04, along);

    float core = exp(-radius * radius * 34.0) * 1.55 + exp(-radius * radius * 120.0) * 1.3;
    float roundBloom = exp(-radius * radius * 9.0) * 0.34;
    // The haze no lens ever leaves out: light scattered so wide that no arm is left in it. It is
    // what keeps a star from ending at the edge of its rays, and it is almost all colour.
    float wideBloom = exp(-radius * radius * 2.8) * 0.13;
    // Reaching arms brighten and retreating ones dim, which is most of what reads as a twinkle; the
    // gain averages to 1 over a cycle and fades out near the centre, where the eight angular sectors
    // meet and a per-arm gain would otherwise band the core into a pinwheel. The star's own phase
    // also leans the gain onto one pair of axes for good, because a real flare is never symmetric.
    float rayGain = mix(1.0, 0.78 + stretch * 0.44, smoothstep(0.02, 0.2, radius))
      * (1.0 + 0.13 * dot(doubled, vAxisBias));
    float haze = (softPetal * 0.5 + hazePetal * 0.26) * rayGain * tipFade + roundBloom * 0.44 + wideBloom;
    float ray = (petal * 0.92 + ridge * 0.22) * rayGain * tipFade + core;
    return vec4(haze, ray, core, (haze + ray) * along);
  }

  vec3 whitened(vec3 hue, float amount) {
    return hue + (1.0 - hue) * amount;
  }

  vec3 deepened(vec3 hue) {
    return clamp(hue * hue * TIP_SATURATION, 0.0, 1.0);
  }

  // The colour an arm carries this far along its length. Optics spread a flare colour out along its
  // arms, so the red channel runs the ramp a little ahead of the green and the blue a little behind
  // it. glyphStarSpikes.glyphStarRayTint mirrors this ramp for tests.
  vec3 rayTint(vec3 hue, float along) {
    vec3 ramp = clamp(along * (1.0 + vec3(1.0, 0.0, -1.0) * CHROMATIC_SPREAD), 0.0, 1.0);
    vec3 near = mix(whitened(hue, CORE_WHITENING), whitened(hue, BODY_WHITENING), smoothstep(WHITE_FADE.x, WHITE_FADE.y, ramp));
    return mix(near, deepened(hue), smoothstep(DEEPEN_FADE.x, DEEPEN_FADE.y, ramp));
  }

  // A wide, nearly flat band of light crosses many pixels with less than one framebuffer level
  // between them, which shows up as rings. A fraction of a level of noise, fixed to the pixel grid,
  // turns that step into grain the eye reads as smooth light.
  float dither(vec2 fragment) {
    return fract(sin(dot(fragment, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }

  void main() {
    vec2 centered = (vUv - vec2(0.5)) * 2.0;
    if (length(centered) >= 0.995) discard;
    // An arm is a Gaussian a fraction of a pixel wide at its tip, so reading it once per pixel means
    // reading a different slice of it every frame: that is what made the rays stutter while the
    // camera turned. Four readings on a rotated grid inside the pixel cover the arm's width however
    // it happens to fall between pixel centres, and their average stays put as the star drifts.
    vec2 subPixel = vec2(vUnitsPerPixel * 0.25);
    vec4 light = flareAt(centered + subPixel * vec2(0.5, 1.5), vSwap)
      + flareAt(centered + subPixel * vec2(1.5, -0.5), vSwap)
      + flareAt(centered + subPixel * vec2(-0.5, -1.5), vSwap)
      + flareAt(centered + subPixel * vec2(-1.5, 0.5), vSwap);
    light *= 0.25;

    float energy = light.x + light.y;
    float intensity = energy * vOpacity * 1.46 + dither(gl_FragCoord.xy) * 0.004;
    if (intensity <= 0.002) discard;
    // Brightness lives in the alpha this additive pass weighs the colour by, so what is mixed here
    // is only the hue of the light the bands add up to. A pixel the core owns comes out white
    // however saturated the Glyph is; one the outer haze owns comes out in the Glyph colour.
    float along = light.w / max(energy, 1e-4);
    vec3 hazeTint = mix(whitened(vColor, BODY_WHITENING), deepened(vColor), 0.62);
    vec3 banded = hazeTint * light.x + rayTint(vColor, along) * (light.y - light.z) + vec3(1.0) * light.z;
    gl_FragColor = vec4(banded / max(energy, 1e-4), clamp(intensity, 0.0, 1.0));
  }
`;

export function ConstellationGlyphs({ index, activeSystemId, travel, glyphs, quality, reducedMotion, snapshotTime }: {
  index: ConstellationGlyphIndex;
  activeSystemId: number;
  travel: TravelFrame | null;
  glyphs: readonly ConstellationGlyph[];
  quality: RenderQuality;
  reducedMotion: boolean;
  snapshotTime: number | null;
}): ReactNode {
  const [renderState, setRenderState] = useState<GlyphRenderState | null>(null);
  const colors = useRef(new Map<number, number>());
  const viewportSize = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);

  useLayoutEffect(() => {
    const frames = travel
      ? Array.from({ length: 17 }, (_, step) => projectTravelConstellationGlyphs(
        index,
        activeSystemId,
        travel,
        travel.startedAt + (TRAVEL_DURATION * step) / 16,
      ))
      : [glyphs];
    colors.current = assignGlyphColors(frames, colors.current, SCENE_PALETTE.glyph.length);
  }, [activeSystemId, glyphs, index, travel]);

  useLayoutEffect(() => {
    const state = createRenderState(quality.name, glyphs, colors.current);
    setRenderState(state);
    return () => disposeRenderState(state);
  }, [quality.name]);

  useLayoutEffect(() => {
    if (renderState) syncGlyphRenderData(glyphs, renderState, quality.name, colors.current);
  }, [glyphs, quality.name, renderState]);

  useLayoutEffect(() => {
    if (!renderState) return;
    renderState.nodes.object.material.uniforms.uViewport.value.set(viewportSize.width, viewportSize.height);
    renderState.nodes.object.material.uniforms.uPixelRatio.value = dpr;
  }, [dpr, renderState, viewportSize.height, viewportSize.width]);

  useFrame(({ clock }) => {
    if (!renderState) return;
    const animationTime = reducedMotion ? 0 : snapshotTime === null ? clock.elapsedTime : snapshotTime / 1_000;
    updateGlowBreathing(renderState, animationTime);
    renderState.nodes.object.material.uniforms.uTime.value = animationTime;
    if (travel) {
      syncGlyphRenderData(
        projectTravelConstellationGlyphs(index, activeSystemId, travel, performance.now()),
        renderState,
        quality.name,
        colors.current,
      );
    }
  });

  if (!renderState) return null;
  return (
    <>
      {renderState.buckets.flatMap((bucket) => bucket.objects).map((object, layer) => <primitive key={layer} object={object} />)}
      <primitive object={renderState.nodes.object} />
    </>
  );
}

function createRenderState(profile: RenderQuality["name"], glyphs: readonly ConstellationGlyph[], colors: ReadonlyMap<number, number>): GlyphRenderState {
  const strokeCapacity = Math.max(1, glyphs.reduce((total, glyph) => total + glyph.strokes.length, 0));
  const nodeCapacity = Math.max(1, glyphs.reduce((total, glyph) => total + glyph.nodes.length, 0));
  const state = {
    buckets: createLineBuckets(profile, strokeCapacity),
    strokeCapacity,
    nodes: createNodePoints(nodeCapacity),
    nodeCapacity,
  };
  syncGlyphRenderData(glyphs, state, profile, colors);
  return state;
}

// The ladder itself - which line is strongest, how wide, how bright, and what colour depth makes it
// - lives in `glyphLineStyle`, because the sky is not the only place a glyph is drawn.
function createLineBuckets(profile: RenderQuality["name"], capacity: number): GlyphLineBucket[] {
  return glyphBucketStyles(profile).map((style, bucket) => createLineBucket(
    capacity,
    style.outerWidth,
    style.haloWidth,
    style.coreWidth,
    style.outerOpacity,
    style.haloOpacity,
    style.coreOpacity,
    -30 + bucket * 3,
  ));
}

function createLineBucket(capacity: number, outerWidth: number, haloWidth: number, coreWidth: number, outerOpacity: number, haloOpacity: number, coreOpacity: number, renderOrder: number): GlyphLineBucket {
  const geometry = new LineSegmentsGeometry();
  const positions = new Float32Array(capacity * 6);
  const colors = new Float32Array(capacity * 6);
  geometry.setPositions(positions);
  geometry.setColors(colors);
  interleavedData(geometry, "instanceStart").setUsage(DynamicDrawUsage);
  interleavedData(geometry, "instanceColorStart").setUsage(DynamicDrawUsage);
  const opacityStart = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const opacityEnd = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const capStart = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const capEnd = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute("instanceOpacityStart", opacityStart);
  geometry.setAttribute("instanceOpacityEnd", opacityEnd);
  geometry.setAttribute("instanceCapStart", capStart);
  geometry.setAttribute("instanceCapEnd", capEnd);
  geometry.instanceCount = 0;

  const outer = createLineObject(geometry, outerWidth, outerOpacity, AdditiveBlending, renderOrder, 1.2, 0);
  const halo = createLineObject(geometry, haloWidth, haloOpacity, AdditiveBlending, renderOrder + 1, 1.5, 0.04);
  const core = createLineObject(geometry, coreWidth, coreOpacity, NormalBlending, renderOrder + 2, null, 0.58);
  return { geometry, objects: [outer, halo, core], outerOpacity, haloOpacity, positions, colors, opacityStart, opacityEnd, capStart, capEnd };
}

function createLineObject(geometry: LineSegmentsGeometry, linewidth: number, opacity: number, blending: typeof AdditiveBlending | typeof NormalBlending, renderOrder: number, glowFalloff: number | null, whiten: number): LineSegments2 {
  const material = new LineMaterial({
    blending,
    color: 0xffffff,
    depthTest: true,
    depthWrite: false,
    linewidth,
    opacity,
    transparent: true,
    vertexColors: true,
  });
  material.toneMapped = false;
  addNeonProfile(material, glowFalloff, whiten);
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = renderOrder;
  return object;
}

function addNeonProfile(material: LineMaterial, glowFalloff: number | null, whiten: number): void {
  const profile = glowFalloff === null ? "" : `
            float glyphDistance = length(vec2(vUv.x, glyphCapDistance));
            alpha *= pow(max(0.0, 1.0 - glyphDistance), ${glowFalloff.toFixed(1)});`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("attribute vec3 instanceEnd;", "attribute vec3 instanceEnd;\nattribute float instanceOpacityStart;\nattribute float instanceOpacityEnd;\nattribute float instanceCapStart;\nattribute float instanceCapEnd;\nvarying float vGlyphOpacity;\nvarying vec2 vGlyphCaps;")
      .replace("void main() {\n\n\t\t\t#ifdef USE_COLOR", "void main() {\n\n\t\t\tvGlyphOpacity = ( position.y < 0.5 ) ? instanceOpacityStart : instanceOpacityEnd;\n\t\t\tvGlyphCaps = vec2(instanceCapStart, instanceCapEnd);\n\n\t\t\t#ifdef USE_COLOR");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {\n\n\t\t\tfloat alpha = opacity;", "varying float vGlyphOpacity;\nvarying vec2 vGlyphCaps;\n\n\t\tvoid main() {\n\n\t\t\tfloat alpha = opacity;")
      .replace("\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha );", `            if (vUv.y < -1.0 && vGlyphCaps.x < 0.5) discard;\n            if (vUv.y > 1.0 && vGlyphCaps.y < 0.5) discard;\n            float glyphCapDistance = max(abs(vUv.y) - 1.0, 0.0);${profile}\n            alpha *= vGlyphOpacity;\n            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), ${whiten.toFixed(2)});\n\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha );`);
  };
  material.customProgramCacheKey = () => `constellation-glyph-neon-v2-${glowFalloff ?? "core"}-${whiten}`;
}

function updateGlowBreathing(state: GlyphRenderState, elapsedSeconds: number): void {
  const pulse = Math.sin(elapsedSeconds * Math.PI * 2 / 5);
  for (const bucket of state.buckets) {
    bucket.objects[0].material.opacity = bucket.outerOpacity * (1 + pulse * 0.08);
    bucket.objects[1].material.opacity = bucket.haloOpacity * (1 + pulse * 0.05);
  }
}

function createNodePoints(capacity: number): GlyphNodes {
  const geometry = new InstancedBufferGeometry();
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const opacities = new Float32Array(capacity);
  const sizes = new Float32Array(capacity);
  const phases = new Float32Array(capacity);
  configureNodeGeometry(geometry, positions, colors, opacities, sizes, phases);
  geometry.instanceCount = 0;
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fragmentShader: SPIKE_FRAGMENT_SHADER,
    transparent: true,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uViewport: { value: new Vector2(1, 1) } },
    vertexShader: SPIKE_VERTEX_SHADER,
  });
  material.toneMapped = false;
  const object = new Mesh(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = -20;
  return { geometry, object, positions, colors, opacities, sizes, phases };
}

function configureNodeGeometry(geometry: InstancedBufferGeometry, positions: Float32Array, colors: Float32Array, opacities: Float32Array, sizes: Float32Array, phases: Float32Array): void {
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
    -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ]), 2));
  geometry.setAttribute("instancePosition", new InstancedBufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("instanceColor", new InstancedBufferAttribute(colors, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("instanceOpacity", new InstancedBufferAttribute(opacities, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("instanceSize", new InstancedBufferAttribute(sizes, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("twinklePhase", new InstancedBufferAttribute(phases, 1).setUsage(DynamicDrawUsage));
}

function syncGlyphRenderData(glyphs: readonly ConstellationGlyph[], state: GlyphRenderState, profile: RenderQuality["name"], colors: ReadonlyMap<number, number>): void {
  ensureCapacity(state, glyphs);
  const strokeCounts = [0, 0, 0, 0];
  let nodeCount = 0;

  for (const glyph of glyphs) {
    const color = colors.get(glyph.constellationId) ?? 0;
    for (const stroke of glyph.strokes) {
      if (stroke.opacity <= 0.001) continue;
      const bucketIndex = GLYPH_BUCKET_BY_KIND[stroke.kind];
      const bucket = state.buckets[bucketIndex];
      const strokeIndex = strokeCounts[bucketIndex];
      const offset = strokeIndex * 6;
      bucket.positions.set(stroke.from, offset);
      bucket.positions.set(stroke.to, offset + 3);
      writeGlyphColor(bucket.colors, offset, stroke.proximity, color);
      writeGlyphColor(bucket.colors, offset + 3, stroke.proximity, color);
      const intensity = glyphStrokeIntensity(stroke.kind, stroke.opacity, stroke.proximity);
      bucket.opacityStart.setX(strokeIndex, intensity);
      bucket.opacityEnd.setX(strokeIndex, intensity);
      bucket.capStart.setX(strokeIndex, stroke.capStart === false ? 0 : 1);
      bucket.capEnd.setX(strokeIndex, stroke.capEnd === false ? 0 : 1);
      strokeCounts[bucketIndex] += 1;
    }

    for (const node of glyph.nodes) {
      if (node.opacity <= 0.001) continue;
      const offset = nodeCount * 3;
      state.nodes.positions.set(node.position, offset);
      writeGlyphColor(state.nodes.colors, offset, node.proximity, color);
      state.nodes.opacities[nodeCount] = node.opacity * 0.72;
      state.nodes.sizes[nodeCount] = glyphStarDiameter(node.distance, profile);
      state.nodes.phases[nodeCount] = glyphStarSpikePhase(node.systemId);
      nodeCount += 1;
    }
  }

  for (let bucketIndex = 0; bucketIndex < GLYPH_BUCKET_COUNT; bucketIndex += 1) {
    const bucket = state.buckets[bucketIndex];
    bucket.geometry.instanceCount = strokeCounts[bucketIndex];
    interleavedData(bucket.geometry, "instanceStart").needsUpdate = true;
    interleavedData(bucket.geometry, "instanceColorStart").needsUpdate = true;
    bucket.opacityStart.needsUpdate = true;
    bucket.opacityEnd.needsUpdate = true;
    bucket.capStart.needsUpdate = true;
    bucket.capEnd.needsUpdate = true;
  }

  state.nodes.geometry.instanceCount = nodeCount;
  for (const attributeName of ["instancePosition", "instanceColor", "instanceOpacity", "instanceSize", "twinklePhase"]) {
    state.nodes.geometry.getAttribute(attributeName).needsUpdate = true;
  }
}

function ensureCapacity(state: GlyphRenderState, glyphs: readonly ConstellationGlyph[]): void {
  const strokeCount = glyphs.reduce((total, glyph) => total + glyph.strokes.length, 0);
  if (strokeCount > state.strokeCapacity) {
    const nextCapacity = Math.max(strokeCount, state.strokeCapacity * 2);
    for (const bucket of state.buckets) resizeLineBucket(bucket, nextCapacity);
    state.strokeCapacity = nextCapacity;
  }

  const nodeCount = glyphs.reduce((total, glyph) => total + glyph.nodes.length, 0);
  if (nodeCount > state.nodeCapacity) {
    const nextCapacity = Math.max(nodeCount, state.nodeCapacity * 2);
    resizeNodes(state.nodes, nextCapacity);
    state.nodeCapacity = nextCapacity;
  }
}

function resizeLineBucket(bucket: GlyphLineBucket, capacity: number): void {
  // Dispose releases the old GPU attributes and clears Three.js' cached maximum instance count.
  bucket.geometry.dispose();
  bucket.positions = new Float32Array(capacity * 6);
  bucket.colors = new Float32Array(capacity * 6);
  bucket.geometry.setPositions(bucket.positions);
  bucket.geometry.setColors(bucket.colors);
  interleavedData(bucket.geometry, "instanceStart").setUsage(DynamicDrawUsage);
  interleavedData(bucket.geometry, "instanceColorStart").setUsage(DynamicDrawUsage);
  bucket.opacityStart = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  bucket.opacityEnd = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  bucket.capStart = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  bucket.capEnd = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  bucket.geometry.setAttribute("instanceOpacityStart", bucket.opacityStart);
  bucket.geometry.setAttribute("instanceOpacityEnd", bucket.opacityEnd);
  bucket.geometry.setAttribute("instanceCapStart", bucket.capStart);
  bucket.geometry.setAttribute("instanceCapEnd", bucket.capEnd);
}

function resizeNodes(nodes: GlyphNodes, capacity: number): void {
  nodes.geometry.dispose();
  nodes.positions = new Float32Array(capacity * 3);
  nodes.colors = new Float32Array(capacity * 3);
  nodes.opacities = new Float32Array(capacity);
  nodes.sizes = new Float32Array(capacity);
  nodes.phases = new Float32Array(capacity);
  configureNodeGeometry(nodes.geometry, nodes.positions, nodes.colors, nodes.opacities, nodes.sizes, nodes.phases);
}

function interleavedData(geometry: LineSegmentsGeometry, attribute: string): InterleavedBufferAttribute["data"] {
  return (geometry.getAttribute(attribute) as InterleavedBufferAttribute).data;
}

function disposeRenderState(state: GlyphRenderState): void {
  for (const bucket of state.buckets) {
    bucket.geometry.dispose();
    for (const object of bucket.objects) object.material.dispose();
  }
  state.nodes.geometry.dispose();
  state.nodes.object.material.dispose();
}
