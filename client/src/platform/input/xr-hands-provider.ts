/**
 * Tier A InputProvider: WebXR articulated hands (Quest hand tracking).
 * Reads joint poses from the current XRFrame, applies 1€ smoothing, pinch
 * hysteresis, finger-extension gestures and tracking-loss guards.
 */
import type { World } from '@iwsdk/core';
import type { Handedness } from '../../core/event-bus.js';
import type { HandState, InputProvider, Vec3 } from './hand-state.js';
import { OneEuroFilter3 } from './one-euro.js';
import { PinchDetector } from './pinch-detector.js';

const TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const;
/** A teleport larger than this between frames is treated as a tracking glitch. */
const MAX_JUMP = 0.12;

interface HandFilters {
  pinch: PinchDetector;
  pinchF: OneEuroFilter3;
  tipF: OneEuroFilter3;
  out: Float32Array;
  lastTip: Vec3;
}

function filters(): HandFilters {
  return {
    pinch: new PinchDetector(),
    pinchF: new OneEuroFilter3(1.2, 0.03),
    tipF: new OneEuroFilter3(1.2, 0.03),
    out: new Float32Array(3),
    lastTip: [0, 0, 0],
  };
}

export class XrHandsProvider implements InputProvider {
  readonly id = 'xr-hands';
  private f: Record<Handedness, HandFilters> = { left: filters(), right: filters() };
  private seen: Record<Handedness, boolean> = { left: false, right: false };

  constructor(private world: World) {}

  active(): boolean {
    return this.world.session !== undefined && this.world.session !== null;
  }

  update(hands: Record<Handedness, HandState>, dt: number): void {
    const xr = this.world.renderer.xr;
    const frame = xr.getFrame?.();
    const ref = xr.getReferenceSpace();
    this.seen.left = this.seen.right = false;
    if (frame && ref && this.world.session) {
      for (const source of this.world.session.inputSources) {
        const side = source.handedness as Handedness;
        if (!source.hand || (side !== 'left' && side !== 'right')) continue;
        if (this.read(source.hand, frame, ref, hands[side], dt)) this.seen[side] = true;
      }
    }
    for (const side of ['left', 'right'] as const) {
      if (this.seen[side]) continue;
      const h = hands[side];
      const tr = this.f[side].pinch.update(null);
      h.pinchStarted = false;
      h.pinchEnded = tr === 'end';
      h.pinching = this.f[side].pinch.pinching;
      h.tracked = false;
      h.pointing = h.palmOpen = false;
      h.stableFrames = 0;
      h.speed = 0;
      this.f[side].pinchF.reset();
      this.f[side].tipF.reset();
    }
  }

  private read(hand: XRHand, frame: XRFrame, ref: XRReferenceSpace, h: HandState, dt: number): boolean {
    const pose = (name: XRHandJoint) => {
      const space = hand.get(name);
      return space ? frame.getJointPose?.(space, ref) ?? null : null;
    };
    const wrist = pose('wrist'), thumb = pose('thumb-tip'), index = pose('index-finger-tip');
    const idxMeta = pose('index-finger-metacarpal'), pinkyMeta = pose('pinky-finger-metacarpal');
    const midProx = pose('middle-finger-phalanx-proximal');
    if (!wrist || !thumb || !index || !idxMeta || !pinkyMeta || !midProx) return false;
    const f = this.f[h.side];
    const w = wrist.transform.position, t = thumb.transform.position, ix = index.transform.position;

    // glitch guard: a huge jump resets filters and the stability counter
    const jump = Math.hypot(ix.x - f.lastTip[0], ix.y - f.lastTip[1], ix.z - f.lastTip[2]);
    if (h.tracked && jump > MAX_JUMP) {
      h.stableFrames = 0;
      f.pinchF.reset();
      f.tipF.reset();
    }
    h.tracked = true;
    h.stableFrames++;

    const dist = Math.hypot(t.x - ix.x, t.y - ix.y, t.z - ix.z);
    const tr = f.pinch.update(dist);
    h.pinchStarted = tr === 'start';
    h.pinchEnded = tr === 'end';
    h.pinching = f.pinch.pinching;

    f.pinchF.filter((t.x + ix.x) / 2, (t.y + ix.y) / 2, (t.z + ix.z) / 2, dt, f.out);
    h.pinchPoint[0] = f.out[0]; h.pinchPoint[1] = f.out[1]; h.pinchPoint[2] = f.out[2];
    h.aimPoint[0] = f.out[0]; h.aimPoint[1] = f.out[1]; h.aimPoint[2] = f.out[2];

    f.tipF.filter(ix.x, ix.y, ix.z, dt, f.out);
    const moved = Math.hypot(f.out[0] - h.indexTip[0], f.out[1] - h.indexTip[1], f.out[2] - h.indexTip[2]);
    h.speed = h.speed * 0.7 + (dt > 0 ? moved / dt : 0) * 0.3;
    h.indexTip[0] = f.out[0]; h.indexTip[1] = f.out[1]; h.indexTip[2] = f.out[2];
    f.lastTip[0] = ix.x; f.lastTip[1] = ix.y; f.lastTip[2] = ix.z;

    // finger extension = tip far from wrist
    let extended = 0;
    let indexExtended = false;
    for (const name of TIPS) {
      const p = pose(name);
      if (!p) continue;
      const q = p.transform.position;
      const ext = Math.hypot(q.x - w.x, q.y - w.y, q.z - w.z) > 0.135;
      if (ext) extended++;
      if (name === 'index-finger-tip') indexExtended = ext;
    }
    h.pointing = indexExtended && extended === 1 && !h.pinching;
    h.palmOpen = extended >= 4 && !h.pinching;

    const m = midProx.transform.position;
    h.palmCenter[0] = (w.x + m.x) / 2; h.palmCenter[1] = (w.y + m.y) / 2; h.palmCenter[2] = (w.z + m.z) / 2;
    const a = idxMeta.transform.position, b = pinkyMeta.transform.position;
    const ax = a.x - w.x, ay = a.y - w.y, az = a.z - w.z, bx = b.x - w.x, by = b.y - w.y, bz = b.z - w.z;
    // (index - wrist) x (pinky - wrist) points out of the palm for the right hand; mirrored for the left
    const s = h.side === 'right' ? 1 : -1;
    let nx = (ay * bz - az * by) * s, ny = (az * bx - ax * bz) * s, nz = (ax * by - ay * bx) * s;
    const len = Math.hypot(nx, ny, nz) || 1;
    h.palmNormal[0] = nx / len; h.palmNormal[1] = ny / len; h.palmNormal[2] = nz / len;
    return true;
  }
}
