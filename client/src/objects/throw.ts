import type { Vector3 } from '@iwsdk/core';

/**
 * Throw velocity: the fastest ~40 ms of the last 150 ms of held motion. Hand tracking sees
 * a pinch open late, when the hand has already slowed, so an average over the last frames
 * loses half the throw (Step 5: 2.7 m/s hands gave 1.1 m/s balls).
 */
export function throwVelocity(h: readonly { x: number; y: number; z: number; t: number }[], out: Vector3): Vector3 {
  out.set(0, 0, 0);
  if (h.length < 2) return out;
  const end = h[h.length - 1].t;
  let best = -1;
  for (let j = h.length - 1; j > 0 && end - h[j].t <= 150; j--) {
    const b = h[j];
    let i = j - 1;
    while (i > 0 && b.t - h[i].t < 40) i--;
    const a = h[i], dt = Math.max(0.016, (b.t - a.t) / 1000);
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, vz = (b.z - a.z) / dt, sp = vx * vx + vy * vy + vz * vz;
    if (sp > best) {
      best = sp;
      out.set(vx, vy, vz);
    }
  }
  return out;
}
