import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, NormalBlending, Points, ShaderMaterial } from "three";
import {
  createDiffractionColorBuffer,
  createHaloColorBuffer,
  createSpectralColorBuffer,
  createStarFieldBuffers,
  PERSPECTIVE_HALO_SCALE_EXPONENT,
  toStarFieldQualityBudget,
  writeStarFieldFrame,
  type StarFieldBuffers,
  type StarFieldSystem,
} from "./celestialStarFieldModel";
import { resolveObserverPosition } from "./interstellarProjection";
import type { RenderQuality } from "./renderQuality";
import type { TravelFrame } from "./travelCoordinates";

// Shared by all three passes: gl_PointSize is set directly in framebuffer pixels, so the size
// attribute is a CSS-pixel diameter multiplied by the live device pixel ratio - predictable at any
// DPR without relying on Three's distance-based sizeAttenuation (the Celestial Map sphere always
// sits at a fixed distance from the camera, so attenuation would add cost without adding
// information). Every attribute here (including color) is declared explicitly rather than relying on
// Three's implicit `vertexColors` attribute injection, so the wiring stays self-documenting; every
// material below also sets `toneMapped = false`, so the renderer's tone mapping and color-space
// pipeline never touches these colors - what the shader writes is what the canvas shows, the same
// presentation-linear space spectralClassColor() already returns.
const CORE_VERTEX_SHADER = `
  uniform float uPixelRatio;
  attribute vec3 color;
  attribute float coreSize;
  attribute float coreOpacity;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    vColor = color;
    vOpacity = coreOpacity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = coreSize * uPixelRatio;
  }
`;

// A sharp disk with a narrow antialiased edge - stars stay crisp points, never blurry bloom.
const CORE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float edge = 1.0 - smoothstep(0.75, 1.0, radius);
    if (edge <= 0.001 || vOpacity <= 0.001) discard;
    gl_FragColor = vec4(vColor, vOpacity * edge);
  }
`;

const HALO_VERTEX_SHADER = `
  uniform float uPixelRatio;
  uniform float uEdgeScaleMax;
  attribute vec3 haloColor;
  attribute float haloSize;
  attribute float haloOpacity;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    vColor = haloColor;
    vOpacity = haloOpacity;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float viewCosine = clamp(-viewPosition.z / length(viewPosition.xyz), 0.001, 1.0);
    float edgeScale = min(uEdgeScaleMax, pow(viewCosine, -${PERSPECTIVE_HALO_SCALE_EXPONENT.toFixed(1)}));
    gl_PointSize = haloSize * uPixelRatio * edgeScale;
  }
`;

// A soft radial falloff, additively blended so overlapping halos in dense sky regions sum into one
// continuous glow instead of remaining visually separate points. Because haloColor is desaturated
// toward white (see celestialStarFieldModel.ts) and every channel of an additive sum grows together,
// a dense overlap trends toward a light neutral tone rather than clipping into one saturated channel.
const HALO_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (radius >= 1.0 || vOpacity <= 0.001) discard;
    float falloff = pow(1.0 - radius, 2.4);
    gl_FragColor = vec4(vColor * falloff, vOpacity * falloff);
  }
`;

// Rare diffraction spikes on the brightest individual stars. diffractionIntensity is precomputed
// per-star on the CPU (see celestialStarFieldModel.ts's computeDiffractionIntensity, driven purely
// by that star's own Visible Brightness) so the vertex shader only has to zero out ineligible stars'
// point size - no raster cost for a star below threshold, and no dynamic top-N reordering that would
// flicker during travel.
const DIFFRACTION_VERTEX_SHADER = `
  uniform float uPixelRatio;
  uniform float uSpriteSize;
  attribute vec3 diffractionColor;
  attribute float diffractionIntensity;
  varying vec3 vColor;
  varying float vIntensity;

  void main() {
    vColor = diffractionColor;
    vIntensity = diffractionIntensity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = diffractionIntensity > 0.001 ? uSpriteSize * uPixelRatio : 0.0;
  }
`;

// A compact center glow plus two thin rays along one fixed screen-space axis (45 degrees), with a
// soft round edge so the sprite never shows a square border. A single scene-wide orientation reads as
// one coherent optical cue and is visually quieter than jittering each star's rays independently -
// see celestialStarFieldModel.test.ts and the final report for that decision. sin/cos of 45 degrees.
const DIFFRACTION_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vIntensity;

  const float AXIS = 0.7071067811865476;

  void main() {
    if (vIntensity <= 0.001) discard;
    vec2 centered = (gl_PointCoord - vec2(0.5)) * 2.0;
    float radius = length(centered);
    float edgeFade = 1.0 - smoothstep(0.82, 1.0, radius);
    if (edgeFade <= 0.001) discard;

    vec2 axis = vec2(AXIS * centered.x - AXIS * centered.y, AXIS * centered.x + AXIS * centered.y);
    float core = exp(-radius * radius * 26.0);
    float rayA = exp(-abs(axis.y) * 42.0) * exp(-abs(axis.x) * 2.4);
    float rayB = exp(-abs(axis.x) * 42.0) * exp(-abs(axis.y) * 2.4);

    float intensity = (core + (rayA + rayB) * 0.6) * edgeFade * vIntensity;
    if (intensity <= 0.001) discard;
    gl_FragColor = vec4(vColor, intensity);
  }
`;

type RenderState = {
  geometry: BufferGeometry;
  core: Points;
  halo: Points;
  diffraction: Points;
  coreMaterial: ShaderMaterial;
  haloMaterial: ShaderMaterial;
  diffractionMaterial: ShaderMaterial;
  buffers: StarFieldBuffers;
};

// The Celestial Map's real-star layer: three GPU passes sharing one geometry - a sharp core, a soft
// additive halo, and a rare additive diffraction spike on only the brightest individual stars - so
// dense sky regions read as continuous light structure while individual stars stay crisp and only a
// handful of the brightest ever grow spikes. See celestialStarFieldModel.ts for the per-star math
// this component only adapts to R3F.
export function CelestialStarField({ systems, activeSystemId, travel, quality }: {
  systems: readonly StarFieldSystem[];
  activeSystemId: number;
  travel: TravelFrame | null;
  quality: RenderQuality;
}): ReactNode {
  const [renderState, setRenderState] = useState<RenderState | null>(null);
  const dpr = useThree((state) => state.viewport.dpr);
  const qualityBudget = useMemo(
    () => toStarFieldQualityBudget(quality),
    [quality.starHaloMaxSize, quality.starHaloIntensity, quality.starHaloEdgeScaleMax, quality.diffractionThreshold, quality.diffractionSpriteSize, quality.diffractionIntensity],
  );

  useLayoutEffect(() => {
    const state = createRenderState(systems);
    setRenderState(state);
    return () => disposeRenderState(state);
  }, [systems]);

  useEffect(() => {
    if (!renderState) return;
    renderState.coreMaterial.uniforms.uPixelRatio.value = dpr;
    renderState.haloMaterial.uniforms.uPixelRatio.value = dpr;
    renderState.haloMaterial.uniforms.uEdgeScaleMax.value = quality.starHaloEdgeScaleMax;
    renderState.diffractionMaterial.uniforms.uPixelRatio.value = dpr;
  }, [dpr, quality.starHaloEdgeScaleMax, renderState]);

  useEffect(() => {
    if (!renderState) return;
    renderState.diffractionMaterial.uniforms.uSpriteSize.value = quality.diffractionSpriteSize;
  }, [quality.diffractionSpriteSize, renderState]);

  // Stationary frames only need one write (on mount, or when the active system or quality budget
  // changes); the continuous per-frame write below is reserved for active Stargate travel.
  useLayoutEffect(() => {
    if (!renderState || travel) return;
    const observerPosition = resolveObserverPosition(systems, activeSystemId, null, 0);
    if (!observerPosition) return;
    writeStarFieldFrame(systems, observerPosition, qualityBudget, renderState.buffers);
    markFrameAttributesDirty(renderState);
  }, [renderState, systems, activeSystemId, travel, qualityBudget]);

  useFrame(() => {
    if (!renderState || !travel) return;
    const observerPosition = resolveObserverPosition(systems, activeSystemId, travel, performance.now());
    if (!observerPosition) return;
    writeStarFieldFrame(systems, observerPosition, qualityBudget, renderState.buffers);
    markFrameAttributesDirty(renderState);
  });

  if (!renderState) return null;
  return (
    <>
      <primitive object={renderState.halo} />
      <primitive object={renderState.core} />
      <primitive object={renderState.diffraction} />
    </>
  );
}

function createRenderState(systems: readonly StarFieldSystem[]): RenderState {
  const buffers = createStarFieldBuffers(systems.length);
  const coreColors = createSpectralColorBuffer(systems);
  const haloColors = createHaloColorBuffer(systems);
  const diffractionColors = createDiffractionColorBuffer(systems);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(buffers.positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("color", new BufferAttribute(coreColors, 3));
  geometry.setAttribute("coreSize", new BufferAttribute(buffers.coreSizes, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("coreOpacity", new BufferAttribute(buffers.coreOpacities, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("haloColor", new BufferAttribute(haloColors, 3));
  geometry.setAttribute("haloSize", new BufferAttribute(buffers.haloSizes, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("haloOpacity", new BufferAttribute(buffers.haloOpacities, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("diffractionColor", new BufferAttribute(diffractionColors, 3));
  geometry.setAttribute("diffractionIntensity", new BufferAttribute(buffers.diffractionIntensities, 1).setUsage(DynamicDrawUsage));

  const coreMaterial = createStarMaterial(CORE_VERTEX_SHADER, CORE_FRAGMENT_SHADER, false, { uPixelRatio: { value: 1 } });
  const haloMaterial = createStarMaterial(HALO_VERTEX_SHADER, HALO_FRAGMENT_SHADER, true, { uPixelRatio: { value: 1 }, uEdgeScaleMax: { value: 1 } });
  const diffractionMaterial = createStarMaterial(DIFFRACTION_VERTEX_SHADER, DIFFRACTION_FRAGMENT_SHADER, true, { uPixelRatio: { value: 1 }, uSpriteSize: { value: 1 } });

  // Halo, core, then diffraction, all just before the Constellation Glyph nodes (-20) and Battle
  // Beacon glow points (-5) in the shared Celestial Map render-order stack (see SpaceScene.tsx) - the
  // rare diffraction accent stays subordinate to glyphs, preview arcs and battle overlays.
  const halo = new Points(geometry, haloMaterial);
  halo.frustumCulled = false;
  halo.renderOrder = -11;

  const core = new Points(geometry, coreMaterial);
  core.frustumCulled = false;
  core.renderOrder = -9;

  const diffraction = new Points(geometry, diffractionMaterial);
  diffraction.frustumCulled = false;
  diffraction.renderOrder = -8;

  return { geometry, core, halo, diffraction, coreMaterial, haloMaterial, diffractionMaterial, buffers };
}

function createStarMaterial(vertexShader: string, fragmentShader: string, additive: boolean, uniforms: Record<string, { value: number }>): ShaderMaterial {
  const material = new ShaderMaterial({
    blending: additive ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    fragmentShader,
    transparent: true,
    vertexShader,
    uniforms,
  });
  material.toneMapped = false;
  return material;
}

function markFrameAttributesDirty(state: RenderState): void {
  const attributes = state.geometry.attributes;
  attributes.position.needsUpdate = true;
  attributes.coreSize.needsUpdate = true;
  attributes.coreOpacity.needsUpdate = true;
  attributes.haloSize.needsUpdate = true;
  attributes.haloOpacity.needsUpdate = true;
  attributes.diffractionIntensity.needsUpdate = true;
}

function disposeRenderState(state: RenderState): void {
  state.geometry.dispose();
  state.coreMaterial.dispose();
  state.haloMaterial.dispose();
  state.diffractionMaterial.dispose();
}
