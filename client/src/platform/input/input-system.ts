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

export type HandClaim = 'object' | 'menu' | 'kg' | null;

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
  /** Phone AR: the screen touch being held (transient XR input source). */
  private touch: XRInputSource | null = null;
  private session: XRSession | null = null;
  private origin = new Vector3();
  private dir = new Vector3();

  init(): void {
    input.pointer = new PointerProvider(
      this.world.renderer.domElement,
      this.world.camera,
      (ray, dragging) => input.clayRaycast(ray, dragging),
      () => this.world.session != null,
    );
    this.providers = [new XrHandsProvider(this.world), input.pointer];
    this.cleanupFuncs.push(() => this.watch(null));
  }

  /** Listen for phone screen touches on the current session. */
  private watch(session: XRSession | null): void {
    if (session === this.session) return;
    this.session?.removeEventListener('selectstart', this.onSelectStart);
    this.session?.removeEventListener('selectend', this.onSelectEnd);
    this.session = session;
    this.touch = null;
    session?.addEventListener('selectstart', this.onSelectStart);
    session?.addEventListener('selectend', this.onSelectEnd);
  }

  private onSelectStart = (e: XRInputSourceEvent): void => {
    if (e.inputSource.targetRayMode !== 'screen' || this.touch) return;
    if (!this.readRay(e.frame, e.inputSource)) return;
    this.touch = e.inputSource;
    input.pointer!.touchStart(this.origin, this.dir);
  };

  private onSelectEnd = (e: XRInputSourceEvent): void => {
    if (e.inputSource !== this.touch) return;
    this.touch = null;
    input.pointer!.touchEnd();
  };

  /** Touch ray in world space (the reference space is the world: no locomotion). */
  private readRay(frame: XRFrame | undefined, source: XRInputSource): boolean {
    const ref = this.world.renderer.xr.getReferenceSpace();
    const pose = frame && ref ? frame.getPose(source.targetRaySpace, ref) : undefined;
    if (!pose) return false;
    const t = pose.transform;
    this.origin.set(t.position.x, t.position.y, t.position.z);
    const q = t.orientation; // rotate (0, 0, -1) by q
    const x = q.x, y = q.y, z = q.z, w = q.w;
    this.dir.set(-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y)));
    return true;
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    input.xr = this.world.session != null;
    this.watch(this.world.session ?? null);
    if (!input.xr) input.pointer!.xrTouch = false;
    if (this.touch && this.readRay(this.world.renderer.xr.getFrame?.(), this.touch)) {
      input.pointer!.touchMove(this.origin, this.dir);
    }
    for (const p of this.providers) if (p.active()) p.update(input.hands, dt);
  }
}
