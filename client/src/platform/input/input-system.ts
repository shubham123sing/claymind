/**
 * Shared input hub. One system updates all InputProviders once per frame into
 * `input.hands`; game systems read them and *claim* a hand while they use it
 * (e.g. the object system holding a mug), so other systems ignore that hand.
 * Register before any system that reads hands (equal-priority systems run in
 * registration order).
 */
import { createSystem, Raycaster, Vector3 } from '@iwsdk/core';
import type { Handedness } from '../../core/event-bus.js';
import { createHandState, HandState, InputProvider } from './hand-state.js';
import { PointerProvider } from './pointer-provider.js';
import { XrHandsProvider } from './xr-hands-provider.js';

export type HandClaim = 'object' | 'menu' | null;

export const input: {
  hands: Record<Handedness, HandState>;
  claims: Record<Handedness, HandClaim>;
  pointer: PointerProvider | null;
  /** Set by the sculpt system: raycast against the clay (see PointerProvider). */
  clayRaycast: (ray: Raycaster, dragging: boolean) => Vector3 | null;
  xr: boolean;
} = {
  hands: { left: createHandState('left'), right: createHandState('right') },
  claims: { left: null, right: null },
  pointer: null,
  clayRaycast: () => null,
  xr: false,
};

export class InputHubSystem extends createSystem({}) {
  private providers: InputProvider[] = [];

  init(): void {
    input.pointer = new PointerProvider(
      this.world.renderer.domElement,
      this.world.camera,
      (ray, dragging) => input.clayRaycast(ray, dragging),
      () => this.world.session != null,
    );
    this.providers = [new XrHandsProvider(this.world), input.pointer];
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    input.xr = this.world.session != null;
    for (const p of this.providers) if (p.active()) p.update(input.hands, dt);
  }
}
