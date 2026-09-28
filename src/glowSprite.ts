import { CanvasTexture } from "three";

// A tiny cached radial-gradient sprite so PointsMaterial renders a soft glow instead of the flat
// square WebGL draws by default for unmapped points. Shared (module-level, never disposed) since
// every glow-point bucket across the app can reuse the same texture.
let cached: CanvasTexture | null = null;

export function glowSpriteTexture(): CanvasTexture {
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.82)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  cached = new CanvasTexture(canvas);
  return cached;
}
