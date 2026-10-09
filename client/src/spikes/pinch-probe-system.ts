/**
 * Spike 1: articulated-hand pinch events + jitter.
 * Reads WebXR hand joints directly (this becomes the tier-A InputProvider in
 * Phase 1). Reports per-hand pinch state, raw vs 1€-filtered index-tip jitter
 * (RMS over 0.5 s, in mm) and tracking-loss counts; emits pinch events on the bus.
 */
import { createSystem } from '@iwsdk/core';
import { bus, Handedness } from '../core/event-bus.js';
import { JitterMeter, OneEuroFilter3 } from '../platform/input/one-euro.js';
import { PinchDetector } from '../platform/input/pinch-detector.js';
import { spike } from './spike-state.js';

interface HandProbe {
  detector: PinchDetector;
  raw: JitterMeter;
  filtered: JitterMeter;
  filter: OneEuroFilter3;
  out: Float32Array;
  pinchCount: number;
  /** Lowest raw jitter seen while the hand was held still (best case). */
  bestRawMm: number;
  bestFilteredMm: number;
  seen: boolean;
}

function makeProbe(): HandProbe {
  return {
    detector: new PinchDetector(),
    raw: new JitterMeter(36),
    filtered: new JitterMeter(36),
    filter: new OneEuroFilter3(1.0, 0.02),
    out: new Float32Array(3),
    pinchCount: 0,
    bestRawMm: Infinity,
    bestFilteredMm: Infinity,
    seen: false,
  };
}

export class PinchProbeSystem extends createSystem({}) {
  private probes: Record<Handedness, HandProbe> = { left: makeProbe(), right: makeProbe() };
  private present: Record<Handedness, boolean> = { left: false, right: false };

  update(delta: number): void {
    const xr = this.world.renderer.xr;
    const frame = xr.getFrame?.();
    const ref = xr.getReferenceSpace();
    if (!this.world.session || !frame || !ref) return;

    this.present.left = false;
    this.present.right = false;
    for (const source of this.world.session.inputSources) {
      const hand = source.hand;
      const side = source.handedness as Handedness;
      if (!hand || (side !== 'left' && side !== 'right')) continue;
      const thumb = hand.get('thumb-tip');
      const index = hand.get('index-finger-tip');
      const tp = thumb && frame.getJointPose?.(thumb, ref);
      const ip = index && frame.getJointPose?.(index, ref);
      if (!tp || !ip) continue;
      this.present[side] = true;
      const p = this.probes[side];
      p.seen = true;
      const a = tp.transform.position, b = ip.transform.position;
      const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
      const tr = p.detector.update(dist);
      if (tr === 'start') {
        p.pinchCount++;
        bus.emit('hand:pinch-start', { hand: side, x: mx, y: my, z: mz });
      } else if (tr === 'end') {
        bus.emit('hand:pinch-end', { hand: side, x: mx, y: my, z: mz });
      }
      p.raw.push(b.x, b.y, b.z);
      p.filter.filter(b.x, b.y, b.z, delta, p.out);
      p.filtered.push(p.out[0], p.out[1], p.out[2]);
      const rawMm = p.raw.rms() * 1000;
      const filtMm = p.filtered.rms() * 1000;
      if (rawMm > 0) {
        p.bestRawMm = Math.min(p.bestRawMm, rawMm);
        p.bestFilteredMm = Math.min(p.bestFilteredMm, filtMm);
      }
      spike.hud?.set(
        `hand ${side[0].toUpperCase()}`,
        `${p.detector.pinching ? 'PINCH' : 'open '} d=${(dist * 100).toFixed(1)}cm n=${p.pinchCount} ` +
          `jit ${rawMm.toFixed(1)}->${filtMm.toFixed(1)}mm best ${fmt(p.bestRawMm)}->${fmt(p.bestFilteredMm)} ` +
          `loss ${p.detector.trackingLosses}`,
      );
    }
    for (const side of ['left', 'right'] as const) {
      if (this.present[side]) continue;
      const p = this.probes[side];
      const tr = p.detector.update(null);
      if (tr === 'end') bus.emit('hand:pinch-end', { hand: side, x: 0, y: -10, z: 0 });
      if (p.seen) {
        p.raw.reset();
        p.filtered.reset();
        p.filter.reset();
      }
    }
  }
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(1) : '-';
}
