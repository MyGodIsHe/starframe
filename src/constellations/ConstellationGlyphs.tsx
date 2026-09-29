import { useFrame } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, type InterleavedBufferAttribute, NormalBlending, Points, ShaderMaterial } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { RenderQuality } from "../renderQuality";
import type { TravelFrame } from "../travelCoordinates";
import {
  projectTravelConstellationGlyphs,
  type ConstellationGlyph,
  type ConstellationGlyphIndex,
} from "./constellationGlyphModel";

type GlyphLineBucket = {
  geometry: LineSegmentsGeometry;
  objects: readonly [LineSegments2, LineSegments2];
  positions: Float32Array;
  colors: Float32Array;
  opacityStart: InstancedBufferAttribute;
  opacityEnd: InstancedBufferAttribute;
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

  useLayoutEffect(() => {
    const state = createRenderState(quality.name, glyphs);
    setRenderState(state);
    return () => disposeRenderState(state);
  }, [quality.name]);

  useLayoutEffect(() => {
    if (renderState) syncGlyphRenderData(glyphs, renderState, quality.name);
  }, [glyphs, quality.name, renderState]);

  useFrame(() => {
    if (!travel || !renderState) return;
    syncGlyphRenderData(
      projectTravelConstellationGlyphs(index, activeSystemId, travel, performance.now()),
      renderState,
      quality.name,
    );
  });

  if (!renderState) return null;
  return (
    <>
      {renderState.buckets.flatMap((bucket) => bucket.objects).map((object, layer) => <primitive key={layer} object={object} />)}
      <primitive object={renderState.nodes.object} />
    </>
  );
}

function createRenderState(profile: RenderQuality["name"], glyphs: readonly ConstellationGlyph[]): GlyphRenderState {
  const strokeCapacity = Math.max(1, glyphs.reduce((total, glyph) => total + glyph.strokes.length, 0));
  const nodeCapacity = Math.max(1, glyphs.reduce((total, glyph) => total + glyph.nodes.length, 0));
  const state = {
    buckets: createLineBuckets(profile, strokeCapacity),
    strokeCapacity,
    nodes: createNodePoints(nodeCapacity),
    nodeCapacity,
  };
  syncGlyphRenderData(glyphs, state, profile);
  return state;
}

// Three depth buckets for the figure, then one for the lead lines that tie each real Solar System
// to it. The lead bucket is thinner and barely haloed on purpose: a tie is bookkeeping, and it must
// never compete with either the artwork or the stars themselves.
const BUCKET_COUNT = 4;
const ORNAMENT_BUCKET = 3;

function createLineBuckets(profile: RenderQuality["name"], capacity: number): GlyphLineBucket[] {
  const coreWidths = profile === "mobile" ? [0.5, 0.8, 1.15, 0.42] : [0.65, 1.05, 1.5, 0.55];
  const haloWidths = profile === "mobile" ? [1.8, 2.3, 2.7, 1.2] : [2.4, 3, 3.5, 1.6];
  const coreOpacities = [0.48, 0.68, 0.9, 0.34];
  const haloOpacities = [0.18, 0.14, 0.1, 0.05];

  return Array.from({ length: BUCKET_COUNT }, (_, bucket) => createLineBucket(
    capacity,
    haloWidths[bucket],
    coreWidths[bucket],
    haloOpacities[bucket],
    coreOpacities[bucket],
    -30 + bucket * 2,
  ));
}

function createLineBucket(capacity: number, haloWidth: number, coreWidth: number, haloOpacity: number, coreOpacity: number, renderOrder: number): GlyphLineBucket {
  const geometry = new LineSegmentsGeometry();
  const positions = new Float32Array(capacity * 6);
  const colors = new Float32Array(capacity * 6);
  geometry.setPositions(positions);
  geometry.setColors(colors);
  interleavedData(geometry, "instanceStart").setUsage(DynamicDrawUsage);
  interleavedData(geometry, "instanceColorStart").setUsage(DynamicDrawUsage);
  const opacityStart = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const opacityEnd = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute("instanceOpacityStart", opacityStart);
  geometry.setAttribute("instanceOpacityEnd", opacityEnd);
  geometry.instanceCount = 0;

  const halo = createLineObject(geometry, haloWidth, haloOpacity, AdditiveBlending, renderOrder);
  const core = createLineObject(geometry, coreWidth, coreOpacity, NormalBlending, renderOrder + 1);
  return { geometry, objects: [halo, core], positions, colors, opacityStart, opacityEnd };
}

function createLineObject(geometry: LineSegmentsGeometry, linewidth: number, opacity: number, blending: typeof AdditiveBlending | typeof NormalBlending, renderOrder: number): LineSegments2 {
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
  addVertexOpacity(material);
  const object = new LineSegments2(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = renderOrder;
  return object;
}

function addVertexOpacity(material: LineMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("attribute vec3 instanceEnd;", "attribute vec3 instanceEnd;\nattribute float instanceOpacityStart;\nattribute float instanceOpacityEnd;\nvarying float vGlyphOpacity;")
      .replace("void main() {\n\n\t\t\t#ifdef USE_COLOR", "void main() {\n\n\t\t\tvGlyphOpacity = ( position.y < 0.5 ) ? instanceOpacityStart : instanceOpacityEnd;\n\n\t\t\t#ifdef USE_COLOR");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {\n\n\t\t\tfloat alpha = opacity;", "varying float vGlyphOpacity;\n\n\t\tvoid main() {\n\n\t\t\tfloat alpha = opacity * vGlyphOpacity;");
  };
  material.customProgramCacheKey = () => "constellation-glyph-vertex-opacity-v1";
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

function syncGlyphRenderData(glyphs: readonly ConstellationGlyph[], state: GlyphRenderState, profile: RenderQuality["name"]): void {
  ensureCapacity(state, glyphs);
  const strokeCounts = [0, 0, 0, 0];
  let nodeCount = 0;

  for (const glyph of glyphs) {
    for (const stroke of glyph.strokes) {
      if (stroke.opacity <= 0.001) continue;
      const isOrnament = stroke.kind === "lead";
      const bucketIndex = isOrnament ? ORNAMENT_BUCKET : Math.min(2, Math.floor(stroke.proximity * 3));
      const bucket = state.buckets[bucketIndex];
      const strokeIndex = strokeCounts[bucketIndex];
      const offset = strokeIndex * 6;
      bucket.positions.set(stroke.from, offset);
      bucket.positions.set(stroke.to, offset + 3);
      writeGlyphColor(bucket.colors, offset, stroke.proximity, isOrnament);
      writeGlyphColor(bucket.colors, offset + 3, stroke.proximity, isOrnament);
      const intensity = stroke.opacity * (isOrnament ? 0.26 + stroke.proximity * 0.3 : 0.38 + stroke.proximity * 0.62);
      bucket.opacityStart.setX(strokeIndex, intensity);
      bucket.opacityEnd.setX(strokeIndex, intensity);
      strokeCounts[bucketIndex] += 1;
    }

    for (const node of glyph.nodes) {
      if (node.opacity <= 0.001) continue;
      const offset = nodeCount * 3;
      state.nodes.positions.set(node.position, offset);
      writeGlyphColor(state.nodes.colors, offset, node.proximity);
      state.nodes.opacities[nodeCount] = node.opacity * 0.58;
      state.nodes.sizes[nodeCount] = (profile === "mobile" ? 7 : 10) + node.proximity * (profile === "mobile" ? 4 : 6);
      nodeCount += 1;
    }
  }

  for (let bucketIndex = 0; bucketIndex < BUCKET_COUNT; bucketIndex += 1) {
    const bucket = state.buckets[bucketIndex];
    bucket.geometry.instanceCount = strokeCounts[bucketIndex];
    interleavedData(bucket.geometry, "instanceStart").needsUpdate = true;
    interleavedData(bucket.geometry, "instanceColorStart").needsUpdate = true;
    bucket.opacityStart.needsUpdate = true;
    bucket.opacityEnd.needsUpdate = true;
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
  bucket.geometry.setAttribute("instanceOpacityStart", bucket.opacityStart);
  bucket.geometry.setAttribute("instanceOpacityEnd", bucket.opacityEnd);
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

function writeGlyphColor(target: Float32Array, offset: number, proximity: number, isOrnament = false): void {
  const red = 98 + (85 - 98) * proximity;
  const green = 91 + (223 - 91) * proximity;
  const blue = 220 + (255 - 220) * proximity;
  // A lead line shares the depth ramp but sits closer to mid-grey, so it reads as a faint tie
  // rather than as part of the drawing.
  const mix = isOrnament ? 0.45 : 0;
  const grey = (red + green + blue) / 3;
  target[offset] = (red + (grey - red) * mix) / 255;
  target[offset + 1] = (green + (grey - green) * mix) / 255;
  target[offset + 2] = (blue + (grey - blue) * mix) / 255;
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
