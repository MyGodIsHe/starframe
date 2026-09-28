import { useFrame } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { BackSide, type Group, Mesh, ShaderMaterial, SphereGeometry } from "three";
import type { RenderQuality } from "./renderQuality";

// Bigger than the Celestial Map radius (24, see constellationGlyphModel.ts) so real stars and
// Constellation Glyphs always sit in front of it, and comfortably inside the camera's far plane.
const SKY_RADIUS = 60;
// Kept low enough that it never competes with a real system at Minimum Map Brightness (0.82) or
// even the dimmer decorative background stars - this is texture, not a second light source.
const SKY_MAX_INTENSITY = 0.055;

const SKY_VERTEX_SHADER = `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A cheap direction-space value-noise texture: fixed relative to sky direction (not camera
// rotation or time), so it reads as a stable faint nebular structure rather than a moving effect.
// Exactly one noise sample per pixel drives both the glow and the dark veins (a smoothstep of that
// same value) - this pass runs full-screen, every frame, so it stays deliberately minimal rather
// than an fbm sum. uDetail only sharpens the existing sample's vein contrast (free: no extra
// sampling), giving desktop a slightly richer look without desktop-only shader cost.
const SKY_FRAGMENT_SHADER = `
  varying vec3 vDirection;
  uniform float uVeinContrast;
  uniform float uIntensity;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float n = valueNoise(direction * 1.5);
    float darkVein = smoothstep(0.32, 0.78, n) * uVeinContrast;
    float glow = n * (1.0 - darkVein * 0.75);
    vec3 coldTint = vec3(0.08, 0.11, 0.18);
    gl_FragColor = vec4(coldTint * glow * uIntensity, 1.0);
  }
`;

type SkyRenderState = {
  geometry: SphereGeometry;
  material: ShaderMaterial;
  mesh: Mesh;
};

// One cheap camera-centred sphere drawn before every other Celestial Map layer: a single extra
// draw call that gives the sky a faint stable structure without competing with real SDE systems.
export function SkyBackground({ quality }: { quality: RenderQuality }): ReactNode {
  const group = useRef<Group>(null);
  const state = useMemo(createSkyRenderState, []);

  useEffect(() => () => disposeSkyRenderState(state), [state]);
  useEffect(() => {
    state.material.uniforms.uVeinContrast.value = quality.skyNoiseComplexity > 1 ? 1 : 0.6;
  }, [quality.skyNoiseComplexity, state]);
  useFrame(({ camera }) => group.current?.position.copy(camera.position));

  return (
    <group ref={group}>
      <primitive object={state.mesh} />
    </group>
  );
}

function createSkyRenderState(): SkyRenderState {
  const geometry = new SphereGeometry(SKY_RADIUS, 18, 12);
  const material = new ShaderMaterial({
    depthWrite: false,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: BackSide,
    uniforms: { uVeinContrast: { value: 1 }, uIntensity: { value: SKY_MAX_INTENSITY } },
    vertexShader: SKY_VERTEX_SHADER,
  });
  material.toneMapped = false;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;

  return { geometry, material, mesh };
}

function disposeSkyRenderState(state: SkyRenderState): void {
  state.geometry.dispose();
  state.material.dispose();
}
