import { useFrame } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, type InterleavedBufferAttribute, Points, ShaderMaterial } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { createAmbientFlightTrailState, updateAmbientFlightTrail, type AmbientFlightTrailPoint, type AmbientFlightTrailProfile } from "./ambientFlightTrails";

type TrailRenderState = {
  geometry: LineSegmentsGeometry;
  linePositions: Float32Array;
  opacityStart: InstancedBufferAttribute;
  opacityEnd: InstancedBufferAttribute;
  lines: [LineSegments2, LineSegments2];
  head: Points<BufferGeometry, ShaderMaterial>;
  headPosition: Float32Array;
};

const HEAD_VERTEX_SHADER = `
  uniform float size;

  void main() {
    gl_PointSize = size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HEAD_FRAGMENT_SHADER = `
  uniform vec3 color;
  uniform float opacity;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float glow = pow(max(0.0, 1.0 - radius), 2.2);
    if (glow <= 0.001) discard;
    gl_FragColor = vec4(color * glow, opacity * glow);
  }
`;

export function FlightTrailLayer({ points, seed, profile, snapshotTime, color = "#d9ecff" }: {
  points: readonly AmbientFlightTrailPoint[];
  seed: number;
  profile: AmbientFlightTrailProfile;
  snapshotTime: number | null;
  color?: string;
}): ReactNode {
  const [renderState, setRenderState] = useState<TrailRenderState | null>(null);
  const scheduler = useRef<ReturnType<typeof createAmbientFlightTrailState> | null>(null);

  useLayoutEffect(() => {
    const state = createRenderState(profile, color);
    setRenderState(state);
    return () => disposeRenderState(state);
  }, [profile, color]);

  useLayoutEffect(() => {
    scheduler.current = null;
  }, [profile, seed]);

  useFrame(({ clock }) => {
    if (!renderState) return;
    const now = snapshotTime ?? clock.getElapsedTime();
    scheduler.current ??= createAmbientFlightTrailState(seed, profile, snapshotTime === null ? now : 0);
    const frame = updateAmbientFlightTrail(scheduler.current, points, now);
    syncRenderState(renderState, frame);
  });

  if (!renderState) return null;
  return (
    <>
      {renderState.lines.map((line, index) => <primitive key={index} object={line} />)}
      <primitive object={renderState.head} />
    </>
  );
}

function createRenderState(profile: AmbientFlightTrailProfile, color: string): TrailRenderState {
  const geometry = new LineSegmentsGeometry();
  const linePositions = new Float32Array(6);
  geometry.setPositions(linePositions);
  interleavedData(geometry, "instanceStart").setUsage(DynamicDrawUsage);
  const opacityStart = new InstancedBufferAttribute(new Float32Array(1), 1).setUsage(DynamicDrawUsage);
  const opacityEnd = new InstancedBufferAttribute(new Float32Array(1), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute("instanceOpacityStart", opacityStart);
  geometry.setAttribute("instanceOpacityEnd", opacityEnd);
  geometry.instanceCount = 0;

  const halo = createLine(geometry, profile === "mobile" ? 2.2 : 3.2, 0.2, 10, color);
  const core = createLine(geometry, profile === "mobile" ? 0.85 : 1.15, 0.82, 11, color);
  const headPosition = new Float32Array(3);
  const headGeometry = new BufferGeometry();
  headGeometry.setAttribute("position", new BufferAttribute(headPosition, 3).setUsage(DynamicDrawUsage));
  const headMaterial = new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fragmentShader: HEAD_FRAGMENT_SHADER,
    transparent: true,
    uniforms: {
      color: { value: new Color(color) },
      opacity: { value: 0 },
      size: { value: profile === "mobile" ? 7 : 10 },
    },
    vertexShader: HEAD_VERTEX_SHADER,
  });
  headMaterial.toneMapped = false;
  const head = new Points(headGeometry, headMaterial);
  head.frustumCulled = false;
  head.renderOrder = 12;
  head.visible = false;

  return { geometry, linePositions, opacityStart, opacityEnd, lines: [halo, core], head, headPosition };
}

function createLine(geometry: LineSegmentsGeometry, linewidth: number, opacity: number, renderOrder: number, color: string): LineSegments2 {
  const material = new LineMaterial({
    blending: AdditiveBlending,
    color,
    depthTest: true,
    depthWrite: false,
    linewidth,
    opacity,
    transparent: true,
  });
  material.toneMapped = false;
  addVertexOpacity(material);
  const line = new LineSegments2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = renderOrder;
  line.visible = false;
  return line;
}

function addVertexOpacity(material: LineMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("attribute vec3 instanceEnd;", "attribute vec3 instanceEnd;\nattribute float instanceOpacityStart;\nattribute float instanceOpacityEnd;\nvarying float vTrailOpacity;")
      .replace("void main() {\n\n\t\t\t#ifdef USE_COLOR", "void main() {\n\n\t\t\tvTrailOpacity = ( position.y < 0.5 ) ? instanceOpacityStart : instanceOpacityEnd;\n\n\t\t\t#ifdef USE_COLOR");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {\n\n\t\t\tfloat alpha = opacity;", "varying float vTrailOpacity;\n\n\t\tvoid main() {\n\n\t\t\tfloat alpha = opacity * vTrailOpacity;");
  };
  material.customProgramCacheKey = () => "ambient-flight-trail-vertex-opacity-v1";
}

function syncRenderState(state: TrailRenderState, frame: ReturnType<typeof updateAmbientFlightTrail>): void {
  const visible = frame !== null && frame.opacity > 0.001;
  for (const line of state.lines) line.visible = visible;
  state.head.visible = visible;
  state.geometry.instanceCount = visible ? 1 : 0;
  if (!frame) return;

  state.linePositions.set(frame.tail, 0);
  state.linePositions.set(frame.head, 3);
  state.opacityStart.setX(0, 0);
  state.opacityEnd.setX(0, frame.opacity);
  interleavedData(state.geometry, "instanceStart").needsUpdate = true;
  state.opacityStart.needsUpdate = true;
  state.opacityEnd.needsUpdate = true;

  state.headPosition.set(frame.head);
  state.head.geometry.getAttribute("position").needsUpdate = true;
  state.head.material.uniforms.opacity.value = frame.opacity * 0.88;
}

function interleavedData(geometry: LineSegmentsGeometry, attribute: string): InterleavedBufferAttribute["data"] {
  return (geometry.getAttribute(attribute) as InterleavedBufferAttribute).data;
}

function disposeRenderState(state: TrailRenderState): void {
  state.geometry.dispose();
  for (const line of state.lines) line.material.dispose();
  state.head.geometry.dispose();
  state.head.material.dispose();
}
