import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { throwVelocity } from '../../src/objects/throw';

/** Held positions: `moving` frames at `speed` m/s along -z, then `still` frames (the late pinch release). */
function swing(speed: number, moving: number, still: number, frameMs = 14) {
  const h: { x: number; y: number; z: number; t: number }[] = [];
  let z = 0, t = 0;
  for (let i = 0; i < moving; i++, t += frameMs) {
    h.push({ x: 0, y: 1, z, t });
    z -= (speed * frameMs) / 1000;
  }
  for (let i = 0; i < still; i++, t += frameMs) h.push({ x: 0, y: 1, z, t });
  return h;
}

describe('throw velocity (Step 5)', () => {
  it('keeps the hand speed when the pinch opens a few frames after the hand slowed', () => {
    const v = throwVelocity(swing(2.7, 8, 4), new Vector3());
    expect(v.length()).toBeGreaterThan(2.4);
    expect(v.z).toBeLessThan(0);
  });

  it('a hand that stopped long ago throws nothing', () => {
    expect(throwVelocity(swing(2.7, 6, 14), new Vector3()).length()).toBeLessThan(0.05);
  });

  it('no history, no throw', () => {
    expect(throwVelocity([], new Vector3()).length()).toBe(0);
  });
});
