/**
 * Spike 2: impact detection without engine contact events.
 * IWSDK 1.0.1 exposes no collision/contact callbacks and no CCD flag, but it
 * mirrors each body's linear velocity to the main thread every physics step.
 * We detect impacts as sudden velocity changes: impulse ≈ m·|Δv|.
 * Also checks fast shots for tunnelling through the table.
 */
import { createSystem, PhysicsBody } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { SpikeBody } from './spike-components.js';
import { surface } from '../platform/surface/surface-system.js';
import { spike } from './spike-state.js';

/** Gravity alone changes v by ~0.14 m/s per 72 Hz step; stay well above it. */
const DV_THRESHOLD = 0.6;

export class ImpactProbeSystem extends createSystem({
  bodies: { required: [SpikeBody, PhysicsBody] },
}) {
  private prev = new Map<number, Float32Array>();
  private impacts = 0;
  private maxImpulse = 0;
  private tunnels = 0;
  private caught = 0;
  private frameMs = 16;

  init(): void {
    this.queries.bodies.subscribe('qualify', (e) => this.prev.set(e.index, new Float32Array(4)));
    this.queries.bodies.subscribe('disqualify', (e) => this.prev.delete(e.index));
  }

  update(delta: number): void {
    this.frameMs = this.frameMs * 0.95 + delta * 1000 * 0.05;
    for (const e of this.queries.bodies.entities) {
      const v = e.getVectorView(PhysicsBody, '_linearVelocity');
      const p = this.prev.get(e.index);
      if (!p) continue;
      if (v[0] === p[0] && v[1] === p[1] && v[2] === p[2]) continue; // no new physics step yet
      const dx = v[0] - p[0], dy = v[1] - p[1], dz = v[2] - p[2];
      const dv = Math.hypot(dx, dy, dz);
      const speedBefore = Math.hypot(p[0], p[1], p[2]);
      if (p[3] === 1 && dv > DV_THRESHOLD) {
        const m = e.getValue(SpikeBody, 'massKg') as number;
        const impulse = m * dv;
        this.impacts++;
        this.maxImpulse = Math.max(this.maxImpulse, impulse);
        const o = e.object3D!;
        bus.emit('physics:impact', { entityIndex: e.index, materialId: 'spike', piece: false, impulse, deltaV: dv, x: o.position.x, y: o.position.y, z: o.position.z });
        spike.hud?.set('impact', `#${this.impacts} v=${speedBefore.toFixed(2)} dv=${dv.toFixed(2)} m/s J=${impulse.toFixed(3)} Ns (max ${this.maxImpulse.toFixed(3)})`);
        if (e.getValue(SpikeBody, 'fastShot') === 1) {
          e.setValue(SpikeBody, 'fastShot', 2);
          this.caught++;
        }
      }
      p[0] = v[0]; p[1] = v[1]; p[2] = v[2]; p[3] = 1;

      // Tunnelling: a fast shot that ends up well below the table top within its footprint.
      if (e.getValue(SpikeBody, 'fastShot') === 1) {
        const o = e.object3D!;
        const overTable = Math.abs(o.position.x - surface.centerX) < 0.3 && Math.abs(o.position.z - surface.centerZ) < 0.2;
        if (overTable && o.position.y < surface.topY - 0.15) {
          e.setValue(SpikeBody, 'fastShot', 3);
          this.tunnels++;
        }
      }
    }
    spike.hud?.set('ccd', `fast shots stopped by table ${this.caught}, tunnelled ${this.tunnels}`);
    spike.hud?.set('perf', `${this.frameMs.toFixed(1)} ms/frame  calls ${this.world.renderer.info.render.calls}  tris ${this.world.renderer.info.render.triangles}`);
    spike.hud?.tick(performance.now());
  }
}
