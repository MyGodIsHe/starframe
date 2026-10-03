import { useFrame } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, type InterleavedBufferAttribute, NormalBlending, Points, ShaderMaterial } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { RenderQuality } from "../renderQuality";
import { SCENE_PALETTE } from "../scenePalette";
import { glyphBucketStyles, glyphStrokeIntensity, writeGlyphColor, GLYPH_BUCKET_BY_KIND, GLYPH_BUCKET_COUNT } from "./glyphLineStyle";
import { TRAVEL_DURATION, type TravelFrame } from "../travelCoordinates";
import { assignGlyphColors } from "./glyphColoring";
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
  object: Points<BufferGeometry, ShaderMaterial>;
  positions: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  sizes: Float32Array;
};

type GlyphRenderState = {
  buckets: GlyphLineBucket[];
  strokeCapacity: number;
  nodes: GlyphNodes;
  nodeCapacity: number;
};

const NODE_VERTEX_SHADER = `
  attribute float size;
  attribute float opacity;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    vColor = color;
    vOpacity = opacity;
    gl_PointSize = size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NODE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float glow = pow(max(0.0, 1.0 - radius), 2.2);
    if (glow <= 0.001) discard;
    gl_FragColor = vec4(vColor * glow, vOpacity * glow);
  }
`;

export function ConstellationGlyphs({ index, activeSystemId, travel, glyphs, quality }: {
  index: ConstellationGlyphIndex;
  activeSystemId: number;
  travel: TravelFrame | null;
  glyphs: readonly ConstellationGlyph[];
  quality: RenderQuality;
}): ReactNode {
  const [renderState, setRenderState] = useState<GlyphRenderState | null>(null);
  const colors = useRef(new Map<number, number>());

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

  useFrame(({ clock }) => {
    if (!renderState) return;
    updateGlowBreathing(renderState, clock.elapsedTime);
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
  const geometry = new BufferGeometry();
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const opacities = new Float32Array(capacity);
  const sizes = new Float32Array(capacity);
  geometry.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("color", new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("opacity", new BufferAttribute(opacities, 1).setUsage(DynamicDrawUsage));
  geometry.setAttribute("size", new BufferAttribute(sizes, 1).setUsage(DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fragmentShader: NODE_FRAGMENT_SHADER,
    transparent: true,
    vertexColors: true,
    vertexShader: NODE_VERTEX_SHADER,
  });
  material.toneMapped = false;
  const object = new Points(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = -20;
  return { object, positions, colors, opacities, sizes };
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
      state.nodes.opacities[nodeCount] = node.opacity * 0.58;
      state.nodes.sizes[nodeCount] = (profile === "mobile" ? 7 : 10) + node.proximity * (profile === "mobile" ? 4 : 6);
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

  state.nodes.object.geometry.setDrawRange(0, nodeCount);
  for (const attribute of Object.values(state.nodes.object.geometry.attributes)) attribute.needsUpdate = true;
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
  nodes.object.geometry.dispose();
  nodes.positions = new Float32Array(capacity * 3);
  nodes.colors = new Float32Array(capacity * 3);
  nodes.opacities = new Float32Array(capacity);
  nodes.sizes = new Float32Array(capacity);
  nodes.object.geometry.setAttribute("position", new BufferAttribute(nodes.positions, 3).setUsage(DynamicDrawUsage));
  nodes.object.geometry.setAttribute("color", new BufferAttribute(nodes.colors, 3).setUsage(DynamicDrawUsage));
  nodes.object.geometry.setAttribute("opacity", new BufferAttribute(nodes.opacities, 1).setUsage(DynamicDrawUsage));
  nodes.object.geometry.setAttribute("size", new BufferAttribute(nodes.sizes, 1).setUsage(DynamicDrawUsage));
}

function interleavedData(geometry: LineSegmentsGeometry, attribute: string): InterleavedBufferAttribute["data"] {
  return (geometry.getAttribute(attribute) as InterleavedBufferAttribute).data;
}

function disposeRenderState(state: GlyphRenderState): void {
  for (const bucket of state.buckets) {
    bucket.geometry.dispose();
    for (const object of bucket.objects) object.material.dispose();
  }
  state.nodes.object.geometry.dispose();
  state.nodes.object.material.dispose();
}
