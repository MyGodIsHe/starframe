import { Vector3 } from "three";

// Where the camera stands and how it gets there.
//
// Every viewport in the application is an orbit: the subject sits at the origin and the camera is a
// bearing, an elevation and a distance away from it. The damping is what keeps a drag from reading
// as a jump, and it is deliberately the camera's alone - nothing a pilot sees of a Constellation
// Glyph depends on where the camera is, only on where the observer's Solar System is.

export type CameraState = {
  azimuth: number;
  elevation: number;
  distance: number;
};

const CAMERA_DAMPING = 18;

export function dampCameraState(current: CameraState, target: CameraState, delta: number): CameraState {
  const interpolation = 1 - Math.exp(-CAMERA_DAMPING * delta);
  return {
    azimuth: current.azimuth + (target.azimuth - current.azimuth) * interpolation,
    elevation: current.elevation + (target.elevation - current.elevation) * interpolation,
    distance: current.distance + (target.distance - current.distance) * interpolation,
  };
}

export function orbitCameraPosition({ azimuth, elevation, distance }: CameraState, position = new Vector3()): Vector3 {
  const horizontal = Math.cos(elevation) * distance;
  return position.set(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation) * distance,
    Math.cos(azimuth) * horizontal,
  );
}
