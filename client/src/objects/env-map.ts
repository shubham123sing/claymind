/**
 * Reflections for the materials (plan v4: "steel stays shiny"): a small
 * room-like environment map generated once on the device (three's
 * RoomEnvironment through PMREM, no download). The scene's IBL gradient lights
 * everything evenly but gives metal and glass nothing to reflect.
 */
import { PMREMGenerator, Texture, WebGLRenderer } from '@iwsdk/core';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let env: Texture | null = null;

export function initEnvMap(renderer: WebGLRenderer): void {
  if (env) return;
  try {
    const pmrem = new PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch (e) {
    console.warn('[env] reflections unavailable', e);
  }
}

/** The environment map and how strongly a material shows it (metal, glass most). */
export function envFor(metalness: number, roughness: number): { map: Texture | null; intensity: number } {
  const intensity = metalness > 0.5 ? 1 : roughness < 0.2 ? 0.9 : 0.3;
  return { map: env, intensity };
}
