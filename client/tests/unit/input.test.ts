import { describe, expect, it } from 'vitest';
import { JitterMeter, OneEuroFilter } from '../../src/platform/input/one-euro';
import { PinchDetector } from '../../src/platform/input/pinch-detector';

describe('PinchDetector', () => {
  it('uses hysteresis so a noisy distance near the threshold does not flicker', () => {
    const p = new PinchDetector();
    expect(p.update(0.05)).toBe('none');
    expect(p.update(0.012)).toBe('start');
    expect(p.update(0.02)).toBe('none'); // between start and end thresholds: still pinching
    expect(p.pinching).toBe(true);
    expect(p.update(0.035)).toBe('end');
  });

  it('survives short tracking loss but ends a pinch after the grace period', () => {
    const p = new PinchDetector({ startDistance: 0.015, endDistance: 0.03, lostFrameGrace: 3 });
    p.update(0.01);
    for (let i = 0; i < 3; i++) expect(p.update(null)).toBe('none');
    expect(p.pinching).toBe(true);
    expect(p.update(null)).toBe('end');
    expect(p.trackingLosses).toBe(1);
  });
});

describe('OneEuroFilter + JitterMeter', () => {
  it('reduces jitter on a stationary noisy signal', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004; // +/-2 mm
    const raw = new JitterMeter(60), filt = new JitterMeter(60);
    const fx = new OneEuroFilter(1, 0.02), fy = new OneEuroFilter(1, 0.02), fz = new OneEuroFilter(1, 0.02);
    for (let i = 0; i < 200; i++) {
      const x = rand(), y = 1 + rand(), z = rand();
      raw.push(x, y, z);
      filt.push(fx.filter(x, 1 / 72), fy.filter(y, 1 / 72), fz.filter(z, 1 / 72));
    }
    expect(filt.rms()).toBeLessThan(raw.rms() * 0.5);
  });
});
