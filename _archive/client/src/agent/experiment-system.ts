/**
 * Physics experiments the agent runs to test its beliefs, visibly on the table
 * beside the clay, with the real physics engine (IWSDK / Havok):
 *   drop-compare: a heavy and a light ball dropped together; compare fall times
 *   drop-break:   a copy of the creation dropped from 50 cm; did it break?
 *   bounce:       a ball of a material dropped from 30 cm; how high did it bounce?
 * Results are measurements, not opinions; the agent decides what they mean.
 */
import {
  CanvasTexture, createSystem, Entity, Mesh, MeshStandardMaterial, PhysicsBody, PhysicsManipulation, PhysicsShape, PhysicsShapeType, PhysicsState,
  SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
} from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { getMaterial } from '../materials/materials.js';
import { ObjectSystem } from '../objects/object-system.js';
import { nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';

export type ExperimentKind = 'drop-compare' | 'drop-break' | 'bounce';

/**
 * deltaMs > 0: the heavy ball landed first by that much; < 0: the light one did.
 * Measured frame-rate independently: when the first ball touches down, the other
 * ball's remaining height is converted to time at its impact speed.
 */
export interface DropCompareResult { kind: 'drop-compare'; heavyKg: number; lightKg: number; heavyMs: number; lightMs: number; deltaMs: number; heightCm: number }
export interface DropBreakResult { kind: 'drop-break'; broke: boolean; impactSpeed: number; heightCm: number; materialId: string }
export interface BounceResult { kind: 'bounce'; reboundCm: number; heightCm: number; materialId: string }
export type ExperimentResult = DropCompareResult | DropBreakResult | BounceResult;

interface Ball {
  entity: Entity;
  label: Entity;
  r: number;
  startAt: number;
  landAt: number;
  maxAfterLand: number;
  landed: boolean;
  lastY: number;
}

interface Running {
  kind: ExperimentKind;
  /** Balls are created with gravity off and released together once every body exists in the engine. */
  armed: boolean;
  /** drop-compare: signed gap when the first ball landed (heavy first > 0), metres. */
  gap?: number;
  t0: number;
  balls: Ball[];
  timeoutMs: number;
  cloneId?: string;
  broke?: boolean;
  impactSpeed?: number;
  materialId?: string;
  resolve: (r: ExperimentResult) => void;
  reject: (e: Error) => void;
}

const DROP_HEIGHT = 0.4;
const BREAK_HEIGHT = 0.5;
const BOUNCE_HEIGHT = 0.3;
/** Candidate spots along the viewer's right axis (m), best first. */
const ZONE_OFFSETS = [0.25, 0.38, -0.25, -0.38, 0.5];
const sphereGeo = new SphereGeometry(1, 24, 16);

export class ExperimentSystem extends createSystem({}) {
  private running: Running | null = null;
  private xz = [0, 0];
  private v = new Vector3();

  get busy(): boolean {
    return this.running !== null;
  }

  init(): void {
    this.cleanupFuncs.push(
      bus.on('object:broke', (e) => {
        if (this.running?.cloneId === e.creationId) this.running.broke = true;
      }),
      bus.on('physics:impact', (e) => {
        const r = this.running;
        if (r?.kind === 'drop-break' && !e.piece && r.impactSpeed === undefined) r.impactSpeed = e.deltaV;
      }),
    );
  }

  /**
   * Where experiments happen: on the table beside the clay, preferring the
   * viewer's right, on a spot clear of objects (a ball bouncing off the user's
   * creation would ruin the measurement). `halfWidth` is the setup's half span.
   */
  private zone(out: Vector3, halfWidth: number): Vector3 {
    this.world.camera.getWorldPosition(this.v);
    nearestSurfacePoint(this.v.x, this.v.z, 0.18, this.xz);
    const dx = this.xz[0] - this.v.x, dz = this.xz[1] - this.v.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = -dz / len, rz = dx / len; // right of the view direction
    const objects = this.world.getSystem(ObjectSystem);
    for (const side of ZONE_OFFSETS) {
      out.set(this.xz[0] + rx * side, surface.topY, this.xz[1] + rz * side);
      const clear = (s: number) => !objects?.occupied(out.x + rx * s, out.z + rz * s, 0.05);
      if (clear(0) && clear(halfWidth) && clear(-halfWidth)) return out;
    }
    return out.set(this.xz[0] + rx * ZONE_OFFSETS[0], surface.topY, this.xz[1] + rz * ZONE_OFFSETS[0]);
  }

  run(kind: 'drop-compare'): Promise<DropCompareResult>;
  run(kind: 'drop-break', creationId: string): Promise<DropBreakResult>;
  run(kind: 'bounce', materialId: string): Promise<BounceResult>;
  run(kind: ExperimentKind, arg?: string): Promise<ExperimentResult> {
    if (this.running) return Promise.reject(new Error('an experiment is already running'));
    return new Promise((resolve, reject) => {
      const base = this.zone(new Vector3(), kind === 'drop-compare' ? 0.06 : 0.04);
      const r: Running = { kind, armed: false, t0: performance.now(), balls: [], timeoutMs: 6000, resolve, reject };
      if (kind === 'drop-compare') {
        const right = new Vector3(-(base.z - this.v.z), 0, base.x - this.v.x).normalize().multiplyScalar(0.06);
        r.balls.push(this.ball(base.clone().add(right), DROP_HEIGHT, 0.028, 'steel', 'heavy'));
        r.balls.push(this.ball(base.clone().sub(right), DROP_HEIGHT, 0.028, 'foam', 'light'));
      } else if (kind === 'bounce') {
        r.materialId = arg!;
        r.balls.push(this.ball(base, BOUNCE_HEIGHT, 0.03, arg!, getMaterial(arg!).name));
      } else {
        const objects = this.world.getSystem(ObjectSystem);
        const src = objects?.creationById(arg!);
        const id = src && objects!.spawnExperimentClone(arg!, [base.x, surface.topY + BREAK_HEIGHT + 0.06, base.z], `Experiment: dropped from ${BREAK_HEIGHT * 100} cm`);
        if (!id) {
          reject(new Error('nothing to drop'));
          return;
        }
        r.cloneId = id;
        r.materialId = src!.materialId;
        r.timeoutMs = 3500;
      }
      this.running = r;
    });
  }

  private ball(at: Vector3, height: number, radius: number, materialId: string, caption: string): Ball {
    const m = getMaterial(materialId);
    const mesh = new Mesh(sphereGeo, new MeshStandardMaterial({ color: m.visual.color, roughness: m.visual.roughness, metalness: m.visual.metalness }));
    mesh.scale.setScalar(radius);
    mesh.position.set(at.x, surface.topY + height + radius, at.z);
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Sphere, dimensions: [radius, 0, 0], density: m.density, restitution: m.restitution, friction: m.friction });
    // gravity off until every ball of the experiment exists in the engine (simultaneous release)
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, linearDamping: 0, angularDamping: 0.2, gravityFactor: 0 });
    const kg = m.density * (4 / 3) * Math.PI * radius ** 3;
    const label = this.world.createTransformEntity(makeLabel(`${caption} · ${kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 1000)} g`}`));
    return { entity, label, r: radius, startAt: 0, landAt: 0, maxAfterLand: 0, landed: false, lastY: mesh.position.y };
  }

  update(): void {
    const r = this.running;
    if (!r) return;
    const now = performance.now();
    if (!r.armed) {
      // bodies can be created on different frames; release them in the same one
      if (r.balls.some((b) => !(b.entity.getValue(PhysicsBody, '_engineBody') as number))) {
        if (now - r.t0 > 3000) r.armed = true; // give up waiting; measure anyway
        return;
      }
      for (const b of r.balls) {
        b.entity.setValue(PhysicsBody, 'gravityFactor', 1);
        b.entity.addComponent(PhysicsManipulation, { linearVelocity: [0, -0.01, 0] }); // wake
      }
      r.armed = true;
      r.t0 = now;
    }
    for (const b of r.balls) {
      const o = b.entity.object3D!;
      const vy = b.entity.getVectorView(PhysicsBody, '_linearVelocity')[1];
      b.label.object3D!.position.set(o.position.x, o.position.y + b.r + 0.03, o.position.z);
      if (!b.startAt && vy < -0.05) b.startAt = now;
      const contact = surface.topY + b.r + 0.004;
      if (b.startAt && !b.landed && (o.position.y <= contact || (vy >= 0 && o.position.y < b.lastY && o.position.y < contact + 0.03))) {
        b.landed = true;
        b.landAt = now;
      }
      if (b.landed) b.maxAfterLand = Math.max(b.maxAfterLand, o.position.y - (surface.topY + b.r));
      b.lastY = o.position.y;
    }
    const age = now - r.t0;
    if (r.kind === 'drop-compare' && r.gap === undefined && r.balls.some((b) => b.landed)) {
      // both positions are interpolated for the same instant: compare heights now
      const [h, l] = r.balls;
      const above = (b: Ball) => Math.max(0, b.entity.object3D!.position.y - (surface.topY + b.r));
      r.gap = h.landed && l.landed ? 0 : h.landed ? above(l) : -above(h);
    }
    if (r.kind === 'drop-compare' && r.balls.every((b) => b.landed) && age > 1200) this.finish();
    else if (r.kind === 'bounce' && r.balls[0].landed && now - r.balls[0].landAt > 900) this.finish();
    else if (r.kind === 'drop-break' && (r.broke || age > r.timeoutMs)) this.finish();
    else if (age > r.timeoutMs + 2000) {
      this.cleanup(r);
      this.running = null;
      r.reject(new Error('experiment timed out'));
    }
  }

  private finish(): void {
    const r = this.running!;
    this.running = null;
    let result: ExperimentResult;
    if (r.kind === 'drop-compare') {
      const [h, l] = r.balls;
      const kg = (b: Ball, mat: string) => getMaterial(mat).density * (4 / 3) * Math.PI * b.r ** 3;
      // fall time from physics (no drag): t = sqrt(2h/g); the measured gap is what can differ
      const g = 9.81, fallMs = Math.sqrt((2 * DROP_HEIGHT) / g) * 1000, impact = Math.sqrt(2 * g * DROP_HEIGHT);
      const deltaMs = ((r.gap ?? 0) / impact) * 1000;
      const heavyMs = deltaMs > 0 ? fallMs : fallMs - deltaMs, lightMs = deltaMs > 0 ? fallMs + deltaMs : fallMs;
      result = { kind: 'drop-compare', heavyKg: kg(h, 'steel'), lightKg: kg(l, 'foam'), heavyMs, lightMs, deltaMs, heightCm: DROP_HEIGHT * 100 };
    } else if (r.kind === 'bounce') {
      result = { kind: 'bounce', reboundCm: r.balls[0].maxAfterLand * 100, heightCm: BOUNCE_HEIGHT * 100, materialId: r.materialId! };
    } else {
      result = { kind: 'drop-break', broke: !!r.broke, impactSpeed: r.impactSpeed ?? 0, heightCm: BREAK_HEIGHT * 100, materialId: r.materialId! };
    }
    // leave the evidence on the table a moment, then tidy up
    setTimeout(() => this.cleanup(r), 2500);
    r.resolve(result);
  }

  private cleanup(r: Running): void {
    for (const b of r.balls) {
      (b.entity.object3D as Mesh).material && ((b.entity.object3D as Mesh).material as MeshStandardMaterial).dispose();
      b.entity.dispose({ disposeResources: false });
      b.label.dispose();
    }
    if (r.cloneId) this.world.getSystem(ObjectSystem)?.removeCreation(r.cloneId);
  }
}

function makeLabel(text: string): Sprite {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(16,18,22,0.8)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 376, 64, 32);
  ctx.fill();
  ctx.fillStyle = '#f4f1ec';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 192, 38, 360);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(0.09, 0.017, 1);
  s.renderOrder = 30;
  return s;
}
