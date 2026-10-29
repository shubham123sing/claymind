/**
 * Tier A InputProvider: WebXR articulated hands (Quest hand tracking).
 * Reads joint poses from the current XRFrame, applies 1€ smoothing, pinch
 * hysteresis, finger-extension gestures and tracking-loss guards.
 */
import type { World } from '@iwsdk/core';
import type { Handedness } from '../../core/event-bus.js';
import { xrOrigin, type HandState, type InputProvider, type Vec3 } from './hand-state.js';
import { OneEuroFilter3 } from './one-euro.js';
import { PinchDetector } from './pinch-detector.js';

const TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const;
/** A teleport larger than this between frames is treated as a tracking glitch. */
const MAX_JUMP = 0.12;
export const HAND_BETA = 4;

/**
 * QA only (set from the test driver): disturb the tracked hands like a bad tracking day (V6, section 6).
 * `jitter`: the whole hand wanders up to this far (m), to a new random offset every `wobbleMs` (0 = a
 * new offset every frame: white noise, much harsher than real tracking); `jointJitter`: each joint moves
 * on its own up to this far every frame (the pinch distance gets noisy); `dropEvery` / `dropFor` (ms
 * ranges): the hand vanishes now and then. All zero = off, the normal path.
 */
export const handNoise = {
  jitter: 0,
  wobbleMs: 100,
  jointJitter: 0,
  dropEvery: [0, 0] as [number, number],
  dropFor: [0, 0] as [number, number],
  /** Force a hand out of tracking until this time (ms), e.g. mid-grab. */
  dropUntil: { left: 0, right: 0 } as Record<Handedness, number>,
  drops: 0,
  next: { left: 0, right: 0 } as Record<Handedness, number>,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The whole-hand offset (QA noise): eases toward a new random target every wobbleMs. */
const wobble: Record<Handedness, { at: number; from: number[]; to: number[]; now: number[] }> = {
  left: { at: 0, from: [0, 0, 0], to: [0, 0, 0], now: [0, 0, 0] },
  right: { at: 0, from: [0, 0, 0], to: [0, 0, 0], now: [0, 0, 0] },
};
function handOffset(side: Handedness, t: number): number[] {
  const n = handNoise, w = wobble[side], j = n.jitter;
  if (!n.wobbleMs) return (w.now = [rand(-j, j), rand(-j, j), rand(-j, j)]);
  if (t - w.at > n.wobbleMs) {
    w.at = t;
    w.from = w.now;
    w.to = [rand(-j, j), rand(-j, j), rand(-j, j)];
  }
  const k = Math.min(1, (t - w.at) / n.wobbleMs), e = k * k * (3 - 2 * k);
  return (w.now = w.from.map((v, i) => v + (w.to[i] - v) * e));
}

/** A dropped-out hand this frame (QA noise)? Schedules the next dropout. */
function droppedOut(side: Handedness, now: number): boolean {
  const n = handNoise;
  if (now < n.dropUntil[side]) return true;
  if (!n.dropEvery[1]) return false;
  if (!n.next[side]) n.next[side] = now + rand(n.dropEvery[0], n.dropEvery[1]);
  if (now < n.next[side]) return false;
  n.dropUntil[side] = now + rand(n.dropFor[0], n.dropFor[1]);
  n.next[side] = n.dropUntil[side] + rand(n.dropEvery[0], n.dropEvery[1]);
  n.drops++;
  return true;
}

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
    // beta is per m/s: 4 keeps a still hand smooth (1.2 Hz) but lets a 2-3 m/s throw or
    // flick through (~10 Hz); 0.03 held a throwing hand back by half (Step 5)
    pinchF: new OneEuroFilter3(1.2, HAND_BETA),
    tipF: new OneEuroFilter3(1.2, HAND_BETA),
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
        if (droppedOut(side, performance.now())) continue;
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
      h.pointing = h.palmOpen = h.thumbsUp = false;
      h.stableFrames = 0;
      h.speed = 0;
      this.f[side].pinchF.reset();
      this.f[side].tipF.reset();
    }
  }

  private read(hand: XRHand, frame: XRFrame, ref: XRReferenceSpace, h: HandState, dt: number): boolean {
    const raw = (name: XRHandJoint) => {
      const space = hand.get(name);
      return space ? frame.getJointPose?.(space, ref) ?? null : null;
    };
    const n = handNoise;
    const pose = n.jitter > 0 || n.jointJitter > 0 || xrOrigin.y !== 0
      ? (() => {
        const noisy = n.jitter > 0 || n.jointJitter > 0;
        const [ox, oy0, oz] = noisy ? handOffset(h.side, performance.now()) : [0, 0, 0], j = noisy ? n.jointJitter : 0;
        const oy = oy0 + xrOrigin.y; // the rig's seated-height offset (the camera gets it through the rig)
        return (name: XRHandJoint) => {
          const p = raw(name);
          if (!p) return null;
          const q = p.transform.position;
          return { transform: { position: { x: q.x + ox + rand(-j, j), y: q.y + oy + rand(-j, j), z: q.z + oz + rand(-j, j) } } };
        };
      })()
      : raw;
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
    // thumbs-up: every finger curled, the thumb tip well above the index knuckle and away from the fingers
    const k = idxMeta.transform.position;
    h.thumbsUp = extended === 0 && !h.pinching && t.y - k.y > 0.045 && dist > 0.05;

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
