/**
 * Browser InputProvider (mouse / touch / pen) mapped onto the right hand:
 *   drag on clay        -> pinch (pinchPoint depth-locked, aimPoint follows surface)
 *   Shift + drag        -> index poke into the surface
 *   drag on empty space -> orbit (rotate the clay), exposed as `orbitDx`
 */
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import type { Handedness } from '../../core/event-bus.js';
import type { HandState, InputProvider } from './hand-state.js';

/** `dragging` = true while a press is held: implementations should hit the surface as it was when the press began. */
export type SurfaceRaycast = (ray: Raycaster, dragging: boolean) => Vector3 | null;

export class PointerProvider implements InputProvider {
  readonly id = 'pointer';
  /** Horizontal drag on empty space this frame (pixels). */
  orbitDx = 0;
  private down = false;
  private shift = false;
  private orbiting = false;
  private startedThisFrame = false;
  private endedThisFrame = false;
  private ndc = new Vector2();
  private ray = new Raycaster();
  private depth = 0.4;
  private lastX = 0;
  private pendingDx = 0;
  private hit: Vector3 | null = null;
  private tmp = new Vector3();
  private last = new Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: PerspectiveCamera,
    private raycast: SurfaceRaycast,
    private isXr: () => boolean,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    canvas.style.touchAction = 'none';
  }

  active(): boolean {
    return !this.isXr();
  }

  private setNdc(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.setNdc(e);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.raycast(this.ray, false);
    this.shift = e.shiftKey;
    this.lastX = e.clientX;
    if (hit) {
      this.down = true;
      this.startedThisFrame = true;
      this.depth = hit.distanceTo(this.ray.ray.origin);
    } else {
      this.orbiting = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.setNdc(e);
    if (this.orbiting) {
      this.pendingDx += e.clientX - this.lastX;
      this.lastX = e.clientX;
    }
  };

  private onUp = (): void => {
    if (this.down) this.endedThisFrame = true;
    this.down = false;
    this.orbiting = false;
  };

  update(hands: Record<Handedness, HandState>, dt: number): void {
    const h = hands.right;
    hands.left.tracked = false;
    this.orbitDx = this.pendingDx;
    this.pendingDx = 0;
    this.ray.setFromCamera(this.ndc, this.camera);
    this.hit = this.raycast(this.ray, this.down);

    h.tracked = this.down || this.hit !== null;
    h.stableFrames = 10;
    const poke = this.down && this.shift;
    h.pinchStarted = this.startedThisFrame && !poke;
    h.pinchEnded = this.endedThisFrame && !this.shift;
    h.pinching = this.down && !poke;
    h.pointing = poke;
    h.palmOpen = false;
    this.startedThisFrame = this.endedThisFrame = false;

    this.tmp.copy(this.ray.ray.direction).multiplyScalar(this.depth).add(this.ray.ray.origin);
    h.pinchPoint[0] = this.tmp.x; h.pinchPoint[1] = this.tmp.y; h.pinchPoint[2] = this.tmp.z;
    // While dragging, `hit` is against the surface as it was at press time, so
    // tools follow the original surface instead of drilling into fresh cuts.
    const aim = this.hit ?? this.tmp;
    h.aimPoint[0] = aim.x; h.aimPoint[1] = aim.y; h.aimPoint[2] = aim.z;
    if (poke) {
      // fingertip a few mm past the depth where the press started
      this.tmp.copy(this.ray.ray.direction).multiplyScalar(this.depth + 0.004).add(this.ray.ray.origin);
      h.indexTip[0] = this.tmp.x; h.indexTip[1] = this.tmp.y; h.indexTip[2] = this.tmp.z;
    } else {
      h.indexTip[0] = h.indexTip[1] = h.indexTip[2] = -100; // far away: no poke
    }
    h.speed = dt > 0 ? aim.distanceTo(this.last) / dt : 0;
    this.last.copy(aim);
  }
}
