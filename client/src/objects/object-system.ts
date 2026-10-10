/**
 * Creations in the world: spawn (materialize -> fly to hand / hover), hold
 * (palm carry, pinch, mouse), throw, impact sounds, breaking into pre-baked
 * fracture shards, info labels and blob shadows.
 * Plan v3: a creation is made of parts (clay pieces), each with its own
 * material. One physics body per object: a convex hull carrying the mass and
 * centre of mass from computePhysicalProperties; friction / bounce come from
 * the part touching the surface. A hard hit breaks the part that took it.
 */
import {
  BufferAttribute, BufferGeometry, createSystem, Entity, Mesh, MeshStandardMaterial, PerspectiveCamera, PhysicsBody,
  PhysicsManipulation, PhysicsShape, PhysicsShapeType, PhysicsState, PhysicsSystem, Quaternion, Raycaster, Vector2, Vector3,
} from '@iwsdk/core';
import { ImpactAudio } from '../audio/impact-audio.js';
import { audioContext } from '../audio/audio-context.js';
import { bus, Handedness } from '../core/event-bus.js';
import { Shards } from '../fx/shards.js';
import { feltSpeed, matchup, SURFACE_MATERIAL } from '../materials/matchups.js';
import { getMaterial, Material, MATERIALS } from '../materials/materials.js';
import { bodyParameters, computePhysicalProperties, PartInput, PhysicalProperties } from '../physics/physical-properties.js';
import { input } from '../platform/input/input-system.js';
import { distanceToRect, nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import type { BakedMesh, BakedObject, BakedPiece } from './bake.js';
import { Creation, syncMainMaterial } from './creation.js';
import { PhysObject } from './object-components.js';
import { blobTexture, hullVolume, InfoLabel, makeShadow, pbrMaterial } from './object-view.js';

type Mode = 'materialize' | 'fly' | 'hover' | 'carry' | 'pinch' | 'pointer' | 'free';

/** What a body is built from: one entry per part. */
interface PartSpec {
  /** Piece label from the sculpt. */
  label: number;
  mat: Material;
  /** Closed mesh in object-local metres. */
  mesh: BakedMesh;
  /** Pre-fractured shards of this part (object-local centres). */
  shards: BakedPiece[];
}

interface LivePart extends PartSpec {
  /** Render material of this part (geometry group i). */
  material: MeshStandardMaterial;
}

interface Live {
  entity: Entity;
  mesh: Mesh;
  parts: LivePart[];
  /** Mass, centre of mass, support: the numbers used for the body and the label. */
  props: PhysicalProperties;
  /** Part that touches the surface (sets friction / bounce). */
  contact: number;
  /** Part the player last touched (target of Material). */
  focusPart: number;
  glow: number;
  massKg: number;
  creation: Creation | null;
  mode: Mode;
  side: Handedness | null;
  t0: number;
  expires: number;
  anchor: Vector3;
  offset: Vector3;
  halfH: number;
  radius: number;
  shadow: Entity;
  label: InfoLabel | null;
  labelEntity: Entity | null;
  lastInteract: number;
  /** recent held-target positions for throw velocity */
  hist: { x: number; y: number; z: number; t: number }[];
  /** Materials chosen but not yet applied to the physics body, by part index. */
  pending: Map<number, string>;
  pendingAt: number;
  pendingBy: 'user' | 'ai';
  pendingConfidence: number;
  /** Since when the body has been resting out of reach (0 = not). */
  outOfReachSince: number;
}

/** Rebuilding bodies in quick succession confuses the physics worker (entity indices get reused). */
const MATERIAL_REBUILD_DELAY = 400;

const MAX_CREATIONS = 4;
const MAX_PIECES = 24;
const MAX_THROW = 6;
const PIECE_LIFETIME = 7000;
const GRAB_MARGIN = 0.035;
const DEBUG = new URLSearchParams(location.search).has('debug');

export class ObjectSystem extends createSystem({}) {
  private live: Live[] = [];
  private byEntity = new Map<number, Live>();
  private focus: Live | null = null;
  private physics: PhysicsSystem | undefined;
  private audio = new ImpactAudio(audioContext);
  private shards = new Shards();
  private blob = blobTexture();
  private ray = new Raycaster();
  private ndc = new Vector2();
  private pointerHeld: Live | null = null;
  private pointerDepth = 0.4;
  /** Extra height added with the mouse wheel while holding (m). */
  private pointerLift = 0;
  /** A point on the upright drag plane (the grab point). */
  private pointerPlane = new Vector3();
  private pointerUp = false;
  private v = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private lostSince: Record<Handedness, number> = { left: 0, right: 0 };

  init(): void {
    this.physics = this.world.getSystem(PhysicsSystem);
    this.world.createTransformEntity(this.shards.mesh);
    this.cleanupFuncs.push(
      bus.on('creation:baked', (e) => this.spawnCreation(e.creation, e.baked, e.position, e.quaternion)),
      bus.on('physics:impact', (e) => this.onImpact(e)),
      bus.on('object:cycle-material', () => this.cycleMaterial()),
      bus.on('creation:set-material', (e) => {
        const rec = this.byCreation(e.creationId);
        const c = rec?.creation;
        if (!rec || !c) return;
        // the AI never overrides a part the player chose
        const targets = e.part !== undefined ? [e.part] : c.parts.map((_, i) => i).filter((i) => e.by === 'user' || c.parts[i].by !== 'user');
        for (const i of targets) {
          if (!rec.parts[i]) continue;
          if ((rec.pending.get(i) ?? rec.parts[i].mat.id) !== e.materialId) this.requestMaterial(rec, e.materialId, e.by, e.confidence, i);
          else {
            c.parts[i].materialConfidence = e.confidence;
            c.parts[i].by = e.by;
            syncMainMaterial(c);
          }
        }
      }),
      bus.on('creation:ai-status', (e) => {
        const rec = this.byCreation(e.creationId);
        if (rec?.creation) {
          rec.creation.aiStatus = e.text;
          rec.lastInteract = performance.now();
        }
      }),
      bus.on('creation:model', (e) => {
        // a generated model has no pieces: only single-part objects take it
        const rec = this.byCreation(e.creationId);
        if (rec && rec.parts.length === 1) this.rebuild(rec, { parts: [{ ...this.specOf(rec.parts[0]), mesh: e.mesh }], flash: 0.8 });
      }),
    );
    const onDown = (e: PointerEvent) => this.onPointerDown(e);
    const onMove = (e: PointerEvent) => this.setNdc(e);
    const onUp = () => (this.pointerUp = true);
    // browser: mouse wheel lifts / lowers a held object (the view can't reach high drops otherwise)
    const onWheel = (e: WheelEvent) => {
      if (!this.pointerHeld) return;
      this.pointerLift = Math.max(0, Math.min(0.8, this.pointerLift - Math.sign(e.deltaY) * 0.04));
      e.preventDefault();
    };
    addEventListener('wheel', onWheel, { passive: false });
    this.cleanupFuncs.push(() => removeEventListener('wheel', onWheel));
    addEventListener('pointerdown', onDown, { capture: true });
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    this.cleanupFuncs.push(() => {
      removeEventListener('pointerdown', onDown, { capture: true });
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
    });
  }

  /** Last object the user interacted with (target of material changes). */
  get focused(): Creation | null {
    return this.focus?.creation ?? null;
  }

  // ---------------- spawning ----------------

  private spawnCreation(creation: Creation, baked: BakedObject, position: number[], quaternion: number[]): void {
    const parts: PartSpec[] = baked.parts.map((p, i) => ({
      label: p.label, mat: getMaterial(creation.parts[i]?.materialId ?? creation.materialId), mesh: p.mesh, shards: p.shards,
    }));
    const rec = this.spawnBody(parts, position, quaternion, { creation, mode: 'materialize' });
    this.syncCreation(rec);
    this.focus = rec;
    if (DEBUG) {
      const parts = rec.props.parts.map((pp, i) => `${rec.parts[i].mat.id} ${(pp.mass * 1000).toFixed(0)} g`).join(' + ');
      console.info(`[object] spawned ${creation.name}: ${parts} = ${(rec.massKg * 1000).toFixed(0)} g, COM ${rec.props.com.map((v) => (v * 100).toFixed(1)).join(', ')} cm, contact ${rec.parts[rec.contact].mat.id}`);
    }
    this.enforceLimits();
  }

  /** Copy the computed numbers and current part materials into the creation. */
  private syncCreation(rec: Live): void {
    const c = rec.creation;
    if (!c) return;
    rec.props.parts.forEach((pp, i) => {
      const cp = c.parts[i];
      if (!cp) return;
      cp.materialId = rec.parts[i].mat.id;
      cp.massKg = pp.mass;
      cp.volumeCm3 = pp.volume * 1e6;
    });
    c.massKg = rec.props.mass;
    c.volumeCm3 = rec.props.volume * 1e6;
    syncMainMaterial(c);
  }

  private specOf(p: PartSpec): PartSpec {
    return { label: p.label, mat: p.mat, mesh: p.mesh, shards: p.shards };
  }

  private spawnBody(
    specs: PartSpec[], position: number[], quaternion: number[],
    o: { creation?: Creation | null; mode: Mode; piece?: boolean; velocity?: [number, number, number] },
  ): Live {
    const geo = mergeParts(specs);
    const parts: LivePart[] = specs.map((sp) => ({ ...sp, material: pbrMaterial(sp.mat).clone() }));
    const mesh = new Mesh(geo, parts.map((p) => p.material));
    mesh.position.fromArray(position);
    mesh.quaternion.fromArray(quaternion);
    const entity = this.world.createTransformEntity(mesh);
    // the one source of physical numbers (plan v3): body and label both use it
    const q = quaternion as [number, number, number, number];
    const inputs: PartInput[] = specs.map((sp, i) => ({ id: i, materialId: sp.mat.id, positions: sp.mesh.positions }));
    const props = computePhysicalProperties(inputs, q);
    const bp = bodyParameters(inputs, props, hullVolume(geo.getAttribute('position').array as Float32Array), SURFACE_MATERIAL.table,
      (a, b) => matchup(a, b).friction, q);
    const held = o.mode !== 'free';
    entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.ConvexHull, density: bp.density, friction: bp.friction, restitution: bp.restitution });
    entity.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic, gravityFactor: held ? 0 : 1, angularDamping: 0.08, linearDamping: 0.02, centerOfMass: bp.centerOfMass,
    });
    entity.addComponent(PhysObject, {
      materialId: specs[bp.contactPart].mat.id, massKg: props.mass, piece: o.piece ? 1 : 0, held: held ? 1 : 0, ignoreImpactsUntil: performance.now() + 250,
    });
    if (o.velocity) entity.addComponent(PhysicsManipulation, { linearVelocity: o.velocity });

    const bb = geo.boundingBox!;
    const halfH = (bb.max.y - bb.min.y) / 2;
    const radius = geo.boundingSphere!.radius;
    const shadow = this.world.createTransformEntity(makeShadow(this.blob));
    let label: InfoLabel | null = null, labelEntity: Entity | null = null;
    if (o.creation) {
      label = new InfoLabel();
      labelEntity = this.world.createTransformEntity(label.sprite);
    }
    const rec: Live = {
      entity, mesh, parts, props, contact: bp.contactPart, focusPart: 0, glow: 0, massKg: props.mass, creation: o.creation ?? null, mode: o.mode, side: null,
      t0: performance.now(), expires: o.piece ? performance.now() + PIECE_LIFETIME : Infinity,
      anchor: new Vector3().fromArray(position), offset: new Vector3(), halfH, radius, shadow, label, labelEntity,
      lastInteract: performance.now(), hist: [], pending: new Map(), pendingAt: 0, pendingBy: 'user', pendingConfidence: 1, outOfReachSince: 0,
    };
    if (o.mode === 'materialize') {
      mesh.scale.setScalar(0.3);
      this.glow(rec, 0.6);
    }
    this.live.push(rec);
    this.byEntity.set(entity.index, rec);
    return rec;
  }

  private glow(rec: Live, v: number): void {
    rec.glow = v;
    for (const p of rec.parts) p.material.emissiveIntensity = v;
  }

  private dispose(rec: Live): void {
    if (rec.side) input.claims[rec.side] = null;
    if (this.pointerHeld === rec) this.pointerHeld = null;
    if (this.focus === rec) this.focus = null;
    this.byEntity.delete(rec.entity.index);
    rec.entity.dispose({ disposeResources: false });
    rec.mesh.geometry.dispose();
    for (const p of rec.parts) p.material.dispose();
    rec.shadow.dispose({ disposeResources: false });
    rec.labelEntity?.dispose({ disposeResources: false });
    rec.label?.dispose();
    this.live.splice(this.live.indexOf(rec), 1);
  }

  private enforceLimits(): void {
    const creations = this.live.filter((r) => r.creation && !r.creation.id.includes('#exp'));
    while (creations.length > MAX_CREATIONS) {
      const old = creations.find((r) => r.mode === 'free') ?? creations[0];
      creations.splice(creations.indexOf(old), 1);
      this.dispose(old);
    }
    const pieces = this.live.filter((r) => !r.creation);
    while (pieces.length > MAX_PIECES) this.dispose(pieces.shift()!);
  }

  // ---------------- holding ----------------

  private teleport(rec: Live, p: Vector3): void {
    const body = rec.entity.getValue(PhysicsBody, '_engineBody') as number;
    rec.mesh.quaternion.toArray(this.qa);
    if (body && this.physics) this.physics.setBodyTransform(rec.entity, { position: [p.x, p.y, p.z], quaternion: this.qa as [number, number, number, number] });
    else rec.mesh.position.copy(p);
    rec.hist.push({ x: p.x, y: p.y, z: p.z, t: performance.now() });
    if (rec.hist.length > 6) rec.hist.shift();
  }
  private qa: number[] = [0, 0, 0, 1];

  private hold(rec: Live, mode: Mode, side: Handedness | null): void {
    if (rec.side && rec.side !== side) input.claims[rec.side] = null;
    rec.mode = mode;
    rec.side = side;
    rec.hist.length = 0;
    rec.lastInteract = performance.now();
    if (side) input.claims[side] = 'object';
    rec.entity.setValue(PhysicsBody, 'gravityFactor', 0);
    rec.entity.setValue(PhysObject, 'held', 1);
    this.focus = rec.creation ? rec : this.focus;
    if (rec.creation) bus.emit('object:focus', { creationId: rec.creation.id });
  }

  private release(rec: Live): void {
    if (rec.side) input.claims[rec.side] = null;
    rec.side = null;
    rec.mode = 'free';
    rec.lastInteract = performance.now();
    rec.entity.setValue(PhysicsBody, 'gravityFactor', 1);
    rec.entity.setValue(PhysObject, 'held', 0);
    rec.entity.setValue(PhysObject, 'ignoreImpactsUntil', performance.now() + 120);
    // throw velocity from the last ~80 ms of held motion
    const h = rec.hist;
    this.v.set(0, 0, 0);
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1];
      const dt = Math.max(0.016, (b.t - a.t) / 1000);
      this.v.set((b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt);
      if (this.v.length() > MAX_THROW) this.v.setLength(MAX_THROW);
    }
    // Always set a velocity: a held body was teleported with zero velocity, so
    // Havok has put it to sleep and re-enabling gravity alone does not wake it.
    if (this.v.lengthSq() < 1e-4) this.v.set(0, -0.01, 0);
    if (!rec.entity.hasComponent(PhysicsManipulation))
      rec.entity.addComponent(PhysicsManipulation, { linearVelocity: [this.v.x, this.v.y, this.v.z] });
    rec.hist.length = 0;
  }

  private nearest(p: number[]): Live | null {
    let best: Live | null = null, bestD = Infinity;
    for (const r of this.live) {
      if (r.side || r === this.pointerHeld) continue;
      const d = Math.hypot(p[0] - r.mesh.position.x, p[1] - r.mesh.position.y, p[2] - r.mesh.position.z) - r.radius;
      if (d < GRAB_MARGIN && d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  private setNdc(e: PointerEvent): void {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onPointerDown(e: PointerEvent): void {
    if (input.xr || e.button !== 0 || e.target !== this.world.renderer.domElement) return;
    this.setNdc(e);
    this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
    const hits = this.ray.intersectObjects(this.live.map((r) => r.mesh), false);
    if (!hits.length) return;
    const rec = this.live.find((r) => r.mesh === hits[0].object)!;
    rec.focusPart = Math.min(rec.parts.length - 1, hits[0].face?.materialIndex ?? 0);
    this.pointerDepth = hits[0].distance;
    this.pointerPlane.copy(hits[0].point);
    this.pointerLift = 0;
    rec.offset.copy(rec.mesh.position).sub(hits[0].point);
    this.pointerHeld = rec;
    this.pointerUp = false;
    this.hold(rec, 'pointer', null);
    // the clay must not start a stroke under the object
    e.stopImmediatePropagation();
  }

  // ---------------- impacts & breaking ----------------

  private onImpact(e: { entityIndex: number; materialId: string; piece: boolean; deltaV: number; dir?: [number, number, number]; x: number; y: number; z: number }): void {
    const rec = this.byEntity.get(e.entityIndex);
    if (!rec) return;
    const other = this.otherMaterial(rec, e.x, e.y, e.z);
    // against another object: the part nearest to it; against a surface: the part reaching furthest down the hit
    const hit = other.rec ? this.nearestPart(rec, other.rec.mesh.position.toArray()) : e.dir ? this.hitPart(rec, e.dir) : rec.contact;
    const part = rec.parts[hit];
    const mu = matchup(part.mat.id, other.materialId);
    // what the part "feels": the speed change scaled by the material pair (glass on steel hurts more)
    const felt = feltSpeed(part.mat.id, other.materialId, e.deltaV);
    const brk = !e.piece && !!part.mat.fragility && felt > part.mat.fragility.breakSpeed && part.shards.length > 1;
    if (DEBUG) console.info(`[impact] ${part.mat.id}${rec.parts.length > 1 ? ` (part ${hit + 1}/${rec.parts.length})` : ''}${e.piece ? ' shard' : ''} vs ${other.materialId}${other.object ? ' object' : ''}: dv ${e.deltaV.toFixed(2)} x${mu.damage} = ${felt.toFixed(2)} m/s (breaks at ${part.mat.fragility?.breakSpeed ?? '-'})`);
    this.audio.impact(part.mat, e.deltaV, e.x, e.y, e.z, { brk });
    if (other.object && mu.otherSound > 0) this.audio.impact(getMaterial(other.materialId), e.deltaV * mu.otherSound, e.x, e.y, e.z, { brk: false });
    // the object we hit takes the same impulse: J / its mass is the speed change it would
    // get if free (a glass ball pinned on the table by a falling hammer cannot move, but is crushed)
    if (other.rec && other.part >= 0 && !e.piece) this.crush(other.rec, other.part, rec.massKg * e.deltaV, part.mat.id);
    if (brk) this.breakPart(rec, hit);
    else if (!e.piece && part.mat.hardness >= 0.7 && e.deltaV > 1.8) this.shards.burst(e.x, e.y - rec.halfH * 0.8, e.z, part.mat.visual.color, 3, 0.6, 0.003);
  }

  /** Damage from being hit by another object with `impulse` (N·s), see feltSpeed. */
  private crush(rec: Live, index: number, impulse: number, byMaterial: string): void {
    const part = rec.parts[index];
    if (!part?.mat.fragility || part.shards.length < 2 || rec.entity.getValue(PhysObject, 'piece') === 1) return;
    const felt = feltSpeed(part.mat.id, byMaterial, 0, { impulse, selfMassKg: rec.massKg });
    if (DEBUG) console.info(`[impact] ${part.mat.id} hit by ${byMaterial}: ${impulse.toFixed(3)} N·s on ${(rec.massKg * 1000).toFixed(0)} g -> felt ${felt.toFixed(2)} m/s (breaks at ${part.mat.fragility.breakSpeed})`);
    if (felt > part.mat.fragility.breakSpeed) this.breakPart(rec, index);
  }

  /** The part that reaches furthest against the velocity change: where the contact was. */
  private hitPart(rec: Live, dir: [number, number, number]): number {
    if (rec.parts.length === 1) return 0;
    // contact normal in object space (dir points away from the contact)
    const n = this.v.set(-dir[0], -dir[1], -dir[2]).applyQuaternion(this.qInv.copy(rec.mesh.quaternion).invert());
    let best = 0, bestD = -Infinity;
    rec.parts.forEach((part, i) => {
      const p = part.mesh.positions;
      for (let k = 0; k < p.length; k += 12) {
        const d = p[k] * n.x + p[k + 1] * n.y + p[k + 2] * n.z;
        if (d > bestD) (bestD = d), (best = i);
      }
    });
    return best;
  }
  private qInv = new Quaternion();

  /** What the object hit: another object nearby (its nearest part), else the table or the floor. */
  private otherMaterial(rec: Live, x: number, y: number, z: number): { materialId: string; object: boolean; rec?: Live; part: number } {
    let best: Live | null = null, bestD = Infinity;
    for (const r of this.live) {
      if (r === rec) continue;
      const d = r.mesh.position.distanceTo(rec.mesh.position) - r.radius - rec.radius;
      if (d < 0.02 && d < bestD) (bestD = d), (best = r);
    }
    if (best) {
      let pi = 0, pd = Infinity;
      best.props.parts.forEach((pp, i) => {
        const w = this.v2.fromArray(pp.com).applyQuaternion(best!.mesh.quaternion).add(best!.mesh.position);
        const d = w.distanceToSquared(this.v3.set(x, y, z));
        if (d < pd) (pd = d), (pi = i);
      });
      return { materialId: best.parts[pi].mat.id, object: true, rec: best, part: pi };
    }
    const onTable = distanceToRect(surface, x, z) === 0 && y - rec.halfH < surface.topY + 0.05;
    return { materialId: onTable ? SURFACE_MATERIAL.table : SURFACE_MATERIAL.floor, object: false, part: -1 };
  }

  /** Shatter one part into its shards; the rest of the object carries on without it. */
  private breakPart(rec: Live, index: number): void {
    const part = rec.parts[index];
    const p = rec.mesh.position, q = rec.mesh.quaternion;
    const vel = rec.entity.getVectorView(PhysicsBody, '_linearVelocity');
    const v: [number, number, number] = [vel[0], vel[1], vel[2]];
    const centre = this.v3.fromArray(rec.props.parts[index].com).applyQuaternion(q).add(p);
    for (const piece of part.shards) {
      this.v.fromArray(piece.center).applyQuaternion(q);
      const out = this.v2.copy(this.v).normalize();
      const world = this.v.add(p);
      this.spawnBody([{ label: part.label, mat: part.mat, mesh: piece, shards: [] }], [world.x, world.y, world.z], q.toArray(), {
        mode: 'free',
        piece: true,
        velocity: [v[0] * 0.3 + out.x * 0.7, Math.abs(v[1]) * 0.25 + 0.6 + out.y * 0.3, v[2] * 0.3 + out.z * 0.7],
      });
    }
    this.shards.burst(centre.x, centre.y, centre.z, part.mat.visual.color, rec.parts.length > 1 ? 20 : 36, 1.4);
    if (rec.creation) bus.emit('object:broke', { creationId: rec.creation.id, materialId: part.mat.id, x: centre.x, y: centre.y, z: centre.z });
    if (rec.parts.length === 1) this.dispose(rec);
    else {
      rec.creation?.parts.splice(index, 1);
      const rest = rec.parts.filter((_, i) => i !== index).map((x) => this.specOf(x));
      this.rebuild(rec, { parts: rest, free: true, velocity: v, flash: 0 });
    }
    this.enforceLimits();
  }

  /**
   * Experiments: drop a copy of a creation (same parts, materials, shards)
   * from a world position. Returns the clone's creation id, or null.
   * The clone never enters the brain or the metrics.
   */
  spawnExperimentClone(creationId: string, position: [number, number, number], note: string): string | null {
    const src = this.byCreation(creationId);
    if (!src?.creation) return null;
    const c: Creation = { ...src.creation, id: `${creationId}#exp${Date.now().toString(36)}`, aiStatus: note, parts: src.creation.parts.map((x) => ({ ...x })) };
    const rec = this.spawnBody(src.parts.map((x) => this.specOf(x)), position, src.mesh.quaternion.toArray(), { creation: c, mode: 'free' });
    rec.entity.setValue(PhysObject, 'ignoreImpactsUntil', performance.now() + 150);
    rec.expires = performance.now() + 12000; // never left lying around
    return c.id;
  }

  removeCreation(id: string): void {
    const rec = this.byCreation(id);
    if (rec) this.dispose(rec);
  }

  /** Live creation snapshot for the agent (null if gone). */
  creationById(id: string): Creation | null {
    return this.byCreation(id)?.creation ?? null;
  }

  /** Mass properties of a live creation (null if gone). */
  propertiesOf(id: string): PhysicalProperties | null {
    return this.byCreation(id)?.props ?? null;
  }

  /** Is anything (object or piece) within `clear` m of (x, z) on the table plane? */
  occupied(x: number, z: number, clear: number, except?: string): boolean {
    return this.live.some((l) => l.creation?.id !== except && Math.hypot(l.mesh.position.x - x, l.mesh.position.z - z) < l.radius + clear);
  }

  private byCreation(id: string): Live | undefined {
    return this.live.find((r) => r.creation?.id === id);
  }

  /** The Material button: next material for the part the player last touched. */
  private cycleMaterial(): void {
    const rec = this.focus;
    if (!rec || !rec.creation) return;
    const i = rec.focusPart;
    const current = rec.pending.get(i) ?? rec.parts[i].mat.id;
    const k = MATERIALS.findIndex((m) => m.id === current);
    this.requestMaterial(rec, MATERIALS[(k + 1) % MATERIALS.length].id, 'user', 1, i);
  }

  /** Show the new material at once; rebuild the body after a short pause. */
  requestMaterial(rec: Live, materialId: string, by: 'user' | 'ai' = 'user', confidence = 1, part = rec.focusPart): void {
    const m = getMaterial(materialId);
    const lp = rec.parts[part];
    if (!lp) return;
    rec.pending.set(part, m.id);
    rec.pendingBy = by;
    rec.pendingConfidence = confidence;
    rec.pendingAt = performance.now() + MATERIAL_REBUILD_DELAY;
    const mat = lp.material;
    mat.color.set(m.visual.color);
    mat.roughness = m.visual.roughness;
    mat.metalness = m.visual.metalness;
    mat.transparent = m.visual.opacity < 1;
    mat.opacity = m.visual.opacity;
    mat.emissiveIntensity = 0.35;
    mat.needsUpdate = true;
    rec.lastInteract = performance.now();
    if (rec.creation && rec.label) {
      // preview the new numbers before the body is rebuilt
      const mats = rec.parts.map((x, i) => getMaterial(rec.pending.get(i) ?? x.mat.id));
      const props = computePhysicalProperties(rec.parts.map((x, i) => ({ id: i, materialId: mats[i].id, positions: x.mesh.positions })));
      rec.label.set(...labelText(rec.creation, mats, props.mass), m.visual.color);
    }
  }

  /** Apply chosen materials: rebuild the body (shape properties are not reactive in IWSDK). */
  private applyPending(rec: Live): void {
    const c = rec.creation!;
    const changed = [...rec.pending.entries()];
    rec.pending.clear();
    for (const [i, id] of changed) {
      rec.parts[i].mat = getMaterial(id);
      const cp = c.parts[i];
      if (cp) {
        cp.materialId = id;
        cp.materialConfidence = rec.pendingConfidence;
        cp.by = rec.pendingBy;
      }
    }
    const n = this.rebuild(rec, {});
    for (const [i, id] of changed) {
      bus.emit('object:material-set', { creationId: c.id, materialId: c.materialId, by: rec.pendingBy, confidence: rec.pendingConfidence, part: i, partMaterialId: id });
    }
    void n;
  }

  /** Rebuild a creation's body (new materials or parts), keeping how it is held. */
  private rebuild(rec: Live, o: { parts?: PartSpec[]; flash?: number; free?: boolean; velocity?: [number, number, number] }): Live {
    const c = rec.creation!;
    const specs = o.parts ?? rec.parts.map((x) => this.specOf(x));
    const mode: Mode = o.free ? 'free' : rec.mode === 'free' || rec.mode === 'materialize' ? 'hover' : rec.mode;
    const side = o.free ? null : rec.side;
    const pos = rec.mesh.position.toArray(), quat = rec.mesh.quaternion.toArray();
    const anchor = rec.mode === 'free' ? rec.mesh.position.clone() : rec.anchor.clone();
    const offset = rec.offset.clone();
    const wasPointer = !o.free && this.pointerHeld === rec;
    const focusPart = Math.min(rec.focusPart, specs.length - 1);
    // Create the new body BEFORE disposing the old one: disposing first frees the
    // entity index, the new entity reuses it in the same frame, and the physics
    // worker / impact tracking then confuse the two bodies (seen as a body that
    // sleeps mid-air, sinks through the table and reports no impacts).
    const n = this.spawnBody(specs, pos, quat, { creation: c, mode, velocity: o.velocity });
    this.dispose(rec);
    n.anchor.copy(anchor);
    n.offset.copy(offset);
    n.focusPart = focusPart;
    if (o.free) n.entity.setValue(PhysObject, 'ignoreImpactsUntil', performance.now() + 120);
    if (side) this.hold(n, mode, side);
    if (wasPointer) this.pointerHeld = n;
    this.glow(n, o.flash ?? 0.35); // small flash to show the change
    this.syncCreation(n);
    if (this.focus === rec || !this.focus) this.focus = n;
    return n;
  }

  // ---------------- frame ----------------

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const xr = input.xr;
    // XR grabs: pinch near an object takes it (and claims the hand from sculpting)
    if (xr) {
      for (const side of ['left', 'right'] as const) {
        const h = input.hands[side];
        if (!h.tracked) continue;
        if (h.pinchStarted && !input.claims[side]) {
          const rec = this.nearest(h.pinchPoint);
          if (rec) {
            rec.focusPart = this.nearestPart(rec, h.pinchPoint);
            rec.offset.set(rec.mesh.position.x - h.pinchPoint[0], rec.mesh.position.y - h.pinchPoint[1], rec.mesh.position.z - h.pinchPoint[2]);
            this.hold(rec, 'pinch', side);
          }
        }
      }
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const rec = this.live[i];
      if (!this.live.includes(rec)) continue;
      if (rec.pending.size && now > rec.pendingAt) {
        this.applyPending(rec);
        continue;
      }
      this.step(rec, dt, now, xr);
    }

    this.shards.update(dt, (x, z) => (distanceToRect(surface, x, z) === 0 ? surface.topY : 0));
    if (!this.pointerHeld) this.pointerUp = false;
  }

  private step(rec: Live, dt: number, now: number, xr: boolean): void {
    const age = now - rec.t0;
    const dom = input.hands.right;
    switch (rec.mode) {
      case 'materialize': {
        const t = Math.min(1, age / 380);
        rec.mesh.scale.setScalar(0.3 + 0.7 * easeOutBack(t));
        this.glow(rec, 0.6 * (1 - t));
        this.teleport(rec, rec.anchor);
        if (t >= 1) {
          rec.mesh.scale.setScalar(1);
          if (xr && dom.tracked) {
            rec.mode = 'fly';
            rec.t0 = now;
            rec.side = 'right';
            input.claims.right = 'object';
          } else {
            // browser: float beside the clay (to the viewer's right) so the fresh lump stays visible
            rec.mode = 'hover';
            this.world.camera.getWorldDirection(this.v2);
            this.v.set(-this.v2.z, 0, this.v2.x).normalize(); // right of the view direction
            rec.anchor.addScaledVector(this.v, 0.17);
            rec.anchor.y = Math.max(rec.anchor.y, surface.topY + rec.halfH) + 0.05;
          }
        }
        break;
      }
      case 'fly': {
        const h = input.hands[rec.side!];
        if (!h.tracked) {
          rec.anchor.copy(rec.mesh.position);
          input.claims[rec.side!] = null;
          rec.side = null;
          rec.mode = 'hover';
          break;
        }
        const t = Math.min(1, age / 520);
        this.carryTarget(rec, h, this.v);
        this.v2.copy(rec.anchor).lerp(this.v, easeInOut(t));
        this.v2.y += Math.sin(t * Math.PI) * 0.06;
        this.teleport(rec, this.v2);
        if (t >= 1) this.hold(rec, 'carry', rec.side);
        break;
      }
      case 'hover': {
        this.v.copy(rec.anchor);
        this.v.y += Math.sin(age / 500) * 0.006;
        // glide toward the hover spot instead of jumping
        this.v2.copy(rec.mesh.position).lerp(this.v, 1 - Math.exp(-dt * 8));
        this.teleport(rec, this.v2);
        break;
      }
      case 'carry': {
        const h = input.hands[rec.side!];
        if (!h.tracked) {
          this.lostSince[rec.side!] ||= now;
          if (now - this.lostSince[rec.side!] > 400) this.release(rec);
          break;
        }
        this.lostSince[rec.side!] = 0;
        // turning the hand over drops it (a toss keeps the hand's velocity)
        if (h.palmNormal[1] < -0.15) {
          this.release(rec);
          break;
        }
        this.carryTarget(rec, h, this.v);
        this.teleport(rec, this.v);
        break;
      }
      case 'pinch': {
        const h = input.hands[rec.side!];
        if (h.pinchEnded || !h.pinching) {
          this.release(rec);
          break;
        }
        this.v.set(h.pinchPoint[0], h.pinchPoint[1], h.pinchPoint[2]).add(rec.offset);
        this.teleport(rec, this.v);
        break;
      }
      case 'pointer': {
        this.ray.setFromCamera(this.ndc, this.world.camera as PerspectiveCamera);
        // drag on an upright plane through the grab point, facing the viewer:
        // moving the mouse up lifts the object (a camera-aligned plane would push it away)
        const n = this.v2.set(this.ray.ray.direction.x, 0, this.ray.ray.direction.z);
        if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
        n.normalize();
        const denom = this.ray.ray.direction.dot(n);
        const tHit = Math.abs(denom) > 1e-4 ? this.v3.copy(this.pointerPlane).sub(this.ray.ray.origin).dot(n) / denom : this.pointerDepth;
        this.v.copy(this.ray.ray.direction).multiplyScalar(Math.max(0.1, Math.min(1.5, tHit))).add(this.ray.ray.origin).add(rec.offset);
        this.v.y = Math.min(this.v.y + this.pointerLift, 1.6);
        // never below the surface
        const floor = distanceToRect(surface, this.v.x, this.v.z) === 0 ? surface.topY : 0;
        this.v.y = Math.max(this.v.y, floor + rec.halfH + 0.005);
        this.teleport(rec, this.v);
        if (this.pointerUp) {
          this.pointerHeld = null;
          this.release(rec);
        }
        break;
      }
      case 'free':
        if (now > rec.expires) {
          const s = 1 - (now - rec.expires) / 500;
          if (s <= 0) {
            this.dispose(rec);
            return;
          }
          rec.mesh.scale.setScalar(s);
        }
        if (rec.mesh.position.y < -2) {
          this.dispose(rec);
          return;
        }
        if (rec.creation) this.recallIfOutOfReach(rec, now);
        break;
    }
    if (rec.glow > 0 && rec.mode !== 'materialize') this.glow(rec, Math.max(0, rec.glow - dt * 1.2));
    this.updateDecor(rec, now);
  }

  /**
   * Seated play: a creation that comes to rest out of reach (floor, far side)
   * floats back to the table after a moment instead of being lost.
   */
  private recallIfOutOfReach(rec: Live, now: number): void {
    const v = rec.entity.getVectorView(PhysicsBody, '_linearVelocity');
    const resting = Math.hypot(v[0], v[1], v[2]) < 0.05;
    this.world.camera.getWorldPosition(this.v);
    const p = rec.mesh.position;
    const far = p.y < surface.topY - 0.15 || Math.hypot(p.x - this.v.x, p.z - this.v.z) > 0.9;
    if (!resting || !far) {
      rec.outOfReachSince = 0;
      return;
    }
    rec.outOfReachSince ||= now;
    if (now - rec.outOfReachSince < 1500) return;
    rec.outOfReachSince = 0;
    // back to the table, beside where the clay sits
    nearestSurfacePoint(this.v.x, this.v.z, 0.2, this.xz);
    this.world.camera.getWorldDirection(this.v2);
    this.v3.set(-this.v2.z, 0, this.v2.x).normalize();
    rec.anchor.set(this.xz[0] + this.v3.x * 0.17, surface.topY + rec.halfH + 0.05, this.xz[1] + this.v3.z * 0.17);
    this.glow(rec, 0.4);
    this.hold(rec, 'hover', null);
  }
  private xz = [0, 0];

  /** Index of the part whose centre of mass is nearest to a world point. */
  private nearestPart(rec: Live, p: number[]): number {
    let best = 0, bestD = Infinity;
    rec.props.parts.forEach((pp, i) => {
      const w = this.v2.fromArray(pp.com).applyQuaternion(rec.mesh.quaternion).add(rec.mesh.position);
      const d = (w.x - p[0]) ** 2 + (w.y - p[1]) ** 2 + (w.z - p[2]) ** 2;
      if (d < bestD) (bestD = d), (best = i);
    });
    return best;
  }

  /** Object resting on the palm (above it when the palm faces up). */
  private carryTarget(rec: Live, h: typeof input.hands.left, out: Vector3): void {
    const lift = rec.halfH + 0.02;
    out.set(h.palmCenter[0] + h.palmNormal[0] * lift, h.palmCenter[1] + h.palmNormal[1] * lift, h.palmCenter[2] + h.palmNormal[2] * lift);
  }

  private updateDecor(rec: Live, now: number): void {
    const p = rec.mesh.position;
    const floor = distanceToRect(surface, p.x, p.z) === 0 ? surface.topY : 0;
    const height = Math.max(0, p.y - rec.halfH - floor);
    const sh = rec.shadow.object3D!;
    sh.position.set(p.x, floor + 0.002, p.z);
    const s = rec.radius * 2.4 * (1 + height * 2) * rec.mesh.scale.x;
    sh.scale.set(s, s, 1);
    ((sh as Mesh).material as MeshStandardMaterial).opacity = 0.5 / (1 + height * 6);
    if (rec.label && rec.labelEntity && rec.creation) {
      const show = rec.mode !== 'free' || now - rec.lastInteract < 6000 || this.focus === rec;
      const o = rec.labelEntity.object3D!;
      o.visible = show;
      if (show) {
        o.position.set(p.x, p.y + rec.halfH + 0.05, p.z);
        if (!rec.pending.size) rec.label.set(...labelText(rec.creation, rec.parts.map((x) => x.mat), rec.massKg), mainColor(rec));
      }
    }
  }
}

function labelText(c: Creation, mats: Material[], massKg: number): [string, string] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const names = [...new Set(mats.map((m) => m.name))];
  const conf = c.parts.length <= 1 && c.materialConfidence < 1 ? ` ${pct(c.materialConfidence)}` : '';
  const title = `${c.name} · ${names.join(' + ')}${conf}`;
  const size = c.sizeCm.map((v) => v.toFixed(0)).join('×');
  const grams = massKg >= 1 ? `${massKg.toFixed(2)} kg` : `${Math.round(massKg * 1000)} g`;
  if (c.aiStatus) return [title, c.aiStatus];
  const how = c.source === 'ai' ? 'AI model' : c.source === 'template' ? `matched ${pct(c.matchScore)}` : c.bestGuess ? `a bit like a ${c.bestGuess.name.toLowerCase()}?` : 'your sculpt';
  return [title, `${grams} · ${size} cm · ${how}`];
}

/** Colour of the heaviest part (the label accent). */
function mainColor(rec: Live): string {
  let best = 0;
  rec.props.parts.forEach((pp, i) => {
    if (pp.mass > rec.props.parts[best].mass) best = i;
  });
  return rec.parts[best].mat.visual.color;
}

/** One geometry for all parts; group i is drawn with part i's material. */
function mergeParts(parts: PartSpec[]): BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.mesh.positions.length;
  const positions = new Float32Array(n), normals = new Float32Array(n);
  const g = new BufferGeometry();
  let o = 0;
  parts.forEach((p, i) => {
    positions.set(p.mesh.positions, o);
    normals.set(p.mesh.normals, o);
    g.addGroup(o / 3, p.mesh.positions.length / 3, i);
    o += p.mesh.positions.length;
  });
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const easeOutBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
