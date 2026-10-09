/**
 * Drop-test bodies: a ball falls on the table at start; pinch-release drops a
 * ball from your fingers; keys/buttons drive the physics spikes.
 *   B drop ball · F fast shot (CCD test, cycles 5/10/20 m/s) · N spawn 10 (stress)
 *   R clear · C camera probe
 */
import {
  createSystem, Entity, Mesh, MeshStandardMaterial, PhysicsBody, PhysicsManipulation, PhysicsShape,
  PhysicsShapeType, PhysicsState, SphereGeometry,
} from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { runCameraProbe } from './camera-probe.js';
import { SpikeBody } from './spike-components.js';
import { spike, TABLE } from './spike-state.js';

const MATERIALS = [
  { name: 'rubber', density: 1100, restitution: 0.8, friction: 0.9, color: 0xe2733b },
  { name: 'ceramic', density: 2400, restitution: 0.15, friction: 0.5, color: 0xf2efe8 },
  { name: 'steel', density: 7850, restitution: 0.3, friction: 0.4, color: 0x9aa3ad },
] as const;
const MAX_BODIES = 12;
const FAST_SPEEDS = [5, 10, 20];

export class BallSpawnerSystem extends createSystem({}) {
  private bodies: Entity[] = [];
  private materialIdx = 0;
  private fastIdx = 0;
  private geo = new SphereGeometry(1, 24, 16);
  private mats = MATERIALS.map((m) => new MeshStandardMaterial({ color: m.color, roughness: 0.4, metalness: m.name === 'steel' ? 0.8 : 0 }));
  private queue: string[] = [];

  init(): void {
    this.cleanupFuncs.push(
      bus.on('hand:pinch-end', (e) => {
        if (e.y > 0.2) this.spawn(e.x, e.y - 0.03, e.z, 0.025);
      }),
    );
    if (!this.world.session) this.addButtons();
    setTimeout(() => this.queue.push('drop'), 800);
    if (new URLSearchParams(location.search).has('camera')) {
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe((s) => {
          if (s === 'visible') this.queue.push('camera');
        }),
      );
    }
  }

  private addButtons(): void {
    const bar = document.createElement('div');
    Object.assign(bar.style, { position: 'fixed', left: '12px', bottom: '12px', display: 'flex', gap: '8px', zIndex: '10', flexWrap: 'wrap' });
    const add = (label: string, action: string) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, { font: '14px system-ui', padding: '10px 14px', borderRadius: '10px', border: '0', background: '#2f343d', color: '#fff', cursor: 'pointer' });
      b.onclick = () => this.queue.push(action);
      bar.appendChild(b);
    };
    add('Drop ball (B)', 'drop');
    add('Fast shot / CCD (F)', 'fast');
    add('Spawn 10 (N)', 'ten');
    add('Clear (R)', 'clear');
    add('Camera probe (C)', 'camera');
    document.body.appendChild(bar);
  }

  private spawn(x: number, y: number, z: number, r: number, fastSpeed = 0): void {
    const m = MATERIALS[this.materialIdx++ % MATERIALS.length];
    const mesh = new Mesh(this.geo, this.mats[MATERIALS.indexOf(m)]);
    mesh.scale.setScalar(r);
    mesh.position.set(x, y, z);
    const e = this.world.createTransformEntity(mesh);
    e.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Sphere,
      dimensions: [r, 0, 0],
      density: m.density,
      restitution: m.restitution,
      friction: m.friction,
    });
    e.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, angularDamping: 0.3 });
    const massKg = m.density * (4 / 3) * Math.PI * r ** 3;
    e.addComponent(SpikeBody, { radius: r, massKg, fastShot: fastSpeed > 0 ? 1 : 0 });
    if (fastSpeed > 0) e.addComponent(PhysicsManipulation, { linearVelocity: [0, -fastSpeed, 0] });
    this.bodies.push(e);
    while (this.bodies.length > MAX_BODIES) this.bodies.shift()!.dispose({ disposeResources: false });
    spike.hud?.set('spawn', `${m.name} r=${(r * 100).toFixed(1)}cm m=${(massKg * 1000).toFixed(0)}g${fastSpeed ? ` FAST ${fastSpeed} m/s` : ''}`);
  }

  private run(action: string): void {
    const top = spike.tableTopY;
    if (action === 'drop') this.spawn(TABLE.centerX + (Math.random() - 0.5) * 0.1, top + 0.4, TABLE.centerZ, 0.03);
    else if (action === 'fast') {
      const v = FAST_SPEEDS[this.fastIdx++ % FAST_SPEEDS.length];
      this.spawn(TABLE.centerX, top + 0.5, TABLE.centerZ, 0.02, v);
    } else if (action === 'ten') {
      for (let i = 0; i < 10; i++)
        this.spawn(TABLE.centerX + (i % 5 - 2) * 0.07, top + 0.3 + Math.floor(i / 5) * 0.1, TABLE.centerZ, 0.025);
    } else if (action === 'clear') {
      for (const b of this.bodies) b.dispose({ disposeResources: false });
      this.bodies.length = 0;
    } else if (action === 'camera') void runCameraProbe(this.world);
  }

  update(): void {
    const kb = this.input.keyboard;
    if (kb.getKeyDown('KeyB')) this.queue.push('drop');
    if (kb.getKeyDown('KeyF')) this.queue.push('fast');
    if (kb.getKeyDown('KeyN')) this.queue.push('ten');
    if (kb.getKeyDown('KeyR')) this.queue.push('clear');
    if (kb.getKeyDown('KeyC')) this.queue.push('camera');
    while (this.queue.length) this.run(this.queue.shift()!);
    // remove anything that fell out of the world
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const o = this.bodies[i].object3D;
      if (o && o.position.y < -2) {
        this.bodies[i].dispose({ disposeResources: false });
        this.bodies.splice(i, 1);
      }
    }
    spike.hud?.set('bodies', `${this.bodies.length} dynamic`);
  }
}
