/**
 * Impact detection for creations and pieces. IWSDK 1.0.1 has no contact
 * events (see KNOWN_LIMITS), but mirrors body velocity every physics step:
 * an impact is a sudden velocity change, impulse ≈ m·|Δv|.
 * Held / just-released / just-spawned bodies are ignored (their velocity is
 * set by code, not collisions).
 */
import { createSystem, PhysicsBody } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { PhysObject } from '../objects/object-components.js';

/** Gravity alone changes v by ~0.14 m/s per 72 Hz step; stay well above it. */
const DV_THRESHOLD = 0.6;

export class ImpactSystem extends createSystem({
  bodies: { required: [PhysObject, PhysicsBody] },
}) {
  private prev = new Map<number, Float32Array>();

  init(): void {
    this.queries.bodies.subscribe('qualify', (e) => this.prev.set(e.index, new Float32Array(4)));
    this.queries.bodies.subscribe('disqualify', (e) => this.prev.delete(e.index));
  }

  update(): void {
    const now = performance.now();
    for (const e of this.queries.bodies.entities) {
      const p = this.prev.get(e.index);
      if (!p) continue;
      const v = e.getVectorView(PhysicsBody, '_linearVelocity');
      const ignore = e.getValue(PhysObject, 'held') === 1 || now < (e.getValue(PhysObject, 'ignoreImpactsUntil') as number);
      if (v[0] === p[0] && v[1] === p[1] && v[2] === p[2]) continue; // no new physics step
      const dv = Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]);
      if (!ignore && p[3] === 1 && dv > DV_THRESHOLD) {
        const o = e.object3D!;
        bus.emit('physics:impact', {
          entityIndex: e.index,
          materialId: e.getValue(PhysObject, 'materialId') as string,
          piece: e.getValue(PhysObject, 'piece') === 1,
          impulse: (e.getValue(PhysObject, 'massKg') as number) * dv,
          deltaV: dv,
          x: o.position.x,
          y: o.position.y,
          z: o.position.z,
        });
      }
      p[0] = v[0]; p[1] = v[1]; p[2] = v[2];
      p[3] = ignore ? 0 : 1; // first sample after a held phase is a baseline, not an impact
    }
  }
}
