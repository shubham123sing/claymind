/**
 * Creations in the world: spawn (materialize -> fly to hand / hover), hold
 * (palm carry, pinch, mouse), throw, impact sounds, breaking into pre-baked
 * fracture pieces, info labels and blob shadows. Physics bodies use convex
 * hulls with mass = material density × true mesh volume.
 */
import {
  BufferGeometry, createSystem, Entity, Mesh, MeshStandardMaterial, PerspectiveCamera, PhysicsBody,
  PhysicsManipulation, PhysicsShape, PhysicsShapeType, PhysicsState, PhysicsSystem, Raycaster, Vector2, Vector3,
} from '@iwsdk/core';
import { ImpactAudio } from '../audio/impact-audio.js';
import { audioContext } from '../audio/audio-context.js';
import { bus, Handedness } from '../core/event-bus.js';
import { Shards } from '../fx/shards.js';
import { getMaterial, Material, MATERIALS } from '../materials/materials.js';
import { input } from '../platform/input/input-system.js';
import { distanceToRect, nearestSurfacePoint, surface } from '../platform/surface/surface-system.js';
import { meshVolume } from '../sculpt/marching-cubes.js';
import type { BakedPiece } from './bake.js';
import type { Creation } from './creation.js';
import { PhysObject } from './object-components.js';
import { blobTexture, geometryFrom, hullVolume, InfoLabel, makeShadow, pbrMaterial } from './object-view.js';

type Mode = 'materialize' | 'fly' | 'hover' | 'carry' | 'pinch' | 'pointer' | 'free';

interface Live {
  entity: Entity;
  mesh: Mesh;
  material: MeshStandardMaterial;
  mat: Material;
  massKg: number;
  creation: Creation | null;
  pieces: BakedPiece[];
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
  /** Material chosen by the user but not yet applied to the physics body. */
  pendingMaterial: string | null;
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
      bus.on('creation:baked', (e) => this.spawnCreation(e.creation, e.baked.mesh, e.baked.pieces, e.position, e.quaternion)),
      bus.on('physics:impact', (e) => this.onImpact(e)),
      bus.on('object:cycle-material', () => this.cycleMaterial()),
      bus.on('creation:set-material', (e) => {
        const rec = this.byCreation(e.creationId);
        if (rec && (rec.pendingMaterial ?? rec.mat.id) !== e.materialId) this.requestMaterial(rec, e.materialId, e.by, e.confidence);
        else if (rec?.creation) rec.creation.materialConfidence = e.confidence;
      }),
      bus.on('creation:ai-status', (e) => {
        const rec = this.byCreation(e.creationId);
        if (rec?.creation) {
          rec.creation.aiStatus = e.text;
          rec.lastInteract = performance.now();
        }
      }),
      bus.on('creation:model', (e) => {
        const rec = this.byCreation(e.creationId);
        if (rec) this.rebuild(rec, rec.pendingMaterial ?? rec.mat.id, { geometry: geometryFrom(e.mesh), flash: 0.8 });
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

  private spawnCreation(
    creation: Creation, mesh: { positions: Float32Array; normals: Float32Array }, pieces: BakedPiece[],
    position: number[], quaternion: number[],
  ): void {
    const geo = geometryFrom(mesh);
    const rec = this.spawnBody(geo, getMaterial(creation.materialId), position, quaternion, { creation, pieces, mode: 'materialize' });
    creation.massKg = rec.massKg;
    this.focus = rec;
    if (DEBUG) console.info(`[object] spawned ${creation.name} ${creation.materialId} ${(rec.massKg * 1000).toFixed(0)} g, ${pieces.length} fracture pieces`);
    this.enforceLimits();
  }

  private spawnBody(
    geo: BufferGeometry, mat: Material, position: number[], quaternion: number[],
    o: { creation?: Creation | null; pieces?: BakedPiece[]; mode: Mode; piece?: boolean; velocity?: [number, number, number] },
  ): Live {
    const material = pbrMaterial(mat).clone();
    const mesh = new Mesh(geo, material);
    mesh.position.fromArray(position);
    mesh.quaternion.fromArray(quaternion);
    const entity = this.world.createTransformEntity(mesh);
    const pos = geo.getAttribute('position').array as Float32Array;
    const vol = Math.abs(meshVolume(pos));
    const hull = Math.max(hullVolume(pos), vol);
    const massKg = mat.density * vol;
    const held = o.mode !== 'free';
    entity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.ConvexHull,
      density: (mat.density * vol) / hull, // Havok uses hull volume; keep mass = density × true volume
      friction: mat.friction,
      restitution: mat.restitution,
    });
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, gravityFactor: held ? 0 : 1, angularDamping: 0.08, linearDamping: 0.02 });
    entity.addComponent(PhysObject, { materialId: mat.id, massKg, piece: o.piece ? 1 : 0, held: held ? 1 : 0, ignoreImpactsUntil: performance.now() + 250 });
    if (o.velocity) entity.addComponent(PhysicsManipulation, { linearVelocity: o.velocity });

    geo.computeBoundingBox();
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
      entity, mesh, material, mat, massKg, creation: o.creation ?? null, pieces: o.pieces ?? [], mode: o.mode, side: null,
      t0: performance.now(), expires: o.piece ? performance.now() + PIECE_LIFETIME : Infinity,
      anchor: new Vector3().fromArray(position), offset: new Vector3(), halfH, radius, shadow, label, labelEntity,
      lastInteract: performance.now(), hist: [], pendingMaterial: null, pendingAt: 0, pendingBy: 'user', pendingConfidence: 1, outOfReachSince: 0,
    };
    if (o.mode === 'materialize') {
      mesh.scale.setScalar(0.3);
      material.emissiveIntensity = 0.6;
    }
    this.live.push(rec);
    this.byEntity.set(entity.index, rec);
    return rec;
  }

  private dispose(rec: Live): void {
    if (rec.side) input.claims[rec.side] = null;
    if (this.pointerHeld === rec) this.pointerHeld = null;
    if (this.focus === rec) this.focus = null;
    this.byEntity.delete(rec.entity.index);
    rec.entity.dispose({ disposeResources: false });
    rec.mesh.geometry.dispose();
    rec.material.dispose();
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

  private onImpact(e: { entityIndex: number; materialId: string; piece: boolean; deltaV: number; x: number; y: number; z: number }): void {
    const rec = this.byEntity.get(e.entityIndex);
    if (!rec) return;
    if (DEBUG) console.info(`[impact] ${rec.mat.id}${e.piece ? ' piece' : ''} dv=${e.deltaV.toFixed(2)} m/s (break at ${rec.mat.fragility?.breakSpeed ?? '-'}, pieces ${rec.pieces.length})`);
    const brk = !e.piece && rec.mat.fragility && e.deltaV > rec.mat.fragility.breakSpeed && rec.pieces.length > 1;
    this.audio.impact(rec.mat, e.deltaV, e.x, e.y, e.z, { brk: !!brk });
    if (brk) this.shatter(rec);
    else if (!e.piece && rec.mat.hardness >= 0.7 && e.deltaV > 1.8) this.shards.burst(e.x, e.y - rec.halfH * 0.8, e.z, rec.mat.visual.color, 3, 0.6, 0.003);
  }

  private shatter(rec: Live): void {
    const p = rec.mesh.position, q = rec.mesh.quaternion;
    const vel = rec.entity.getVectorView(PhysicsBody, '_linearVelocity');
    for (const piece of rec.pieces) {
      this.v.fromArray(piece.center).applyQuaternion(q);
      const out = this.v2.copy(this.v).normalize();
      const world = this.v.add(p);
      const geo = geometryFrom(piece);
      this.spawnBody(geo, rec.mat, [world.x, world.y, world.z], q.toArray(), {
        mode: 'free',
        piece: true,
        velocity: [vel[0] * 0.3 + out.x * 0.7, Math.abs(vel[1]) * 0.25 + 0.6 + out.y * 0.3, vel[2] * 0.3 + out.z * 0.7],
      });
    }
    this.shards.burst(p.x, p.y - rec.halfH * 0.5, p.z, rec.mat.visual.color, 36, 1.4);
    if (rec.creation) bus.emit('object:broke', { creationId: rec.creation.id, materialId: rec.mat.id, x: p.x, y: p.y, z: p.z });
    this.dispose(rec);
    this.enforceLimits();
  }

  /**
   * Experiments: drop a copy of a creation (same mesh, material, fracture pieces)
   * from a world position. Returns the clone's creation id, or null.
   * The clone never enters the brain or the metrics.
   */
  spawnExperimentClone(creationId: string, position: [number, number, number], note: string): string | null {
    const src = this.byCreation(creationId);
    if (!src?.creation) return null;
    const c = { ...src.creation, id: `${creationId}#exp${Date.now().toString(36)}`, aiStatus: note };
    const rec = this.spawnBody(src.mesh.geometry.clone(), src.mat, position, src.mesh.quaternion.toArray(), { creation: c, pieces: src.pieces, mode: 'free' });
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

  /** Is anything (object or piece) within `clear` m of (x, z) on the table plane? */
  occupied(x: number, z: number, clear: number, except?: string): boolean {
    return this.live.some((l) => l.creation?.id !== except && Math.hypot(l.mesh.position.x - x, l.mesh.position.z - z) < l.radius + clear);
  }

  private byCreation(id: string): Live | undefined {
    return this.live.find((r) => r.creation?.id === id);
  }

  private cycleMaterial(): void {
    const rec = this.focus;
    if (!rec || !rec.creation) return;
    const current = rec.pendingMaterial ?? rec.mat.id;
    const i = MATERIALS.findIndex((m) => m.id === current);
    this.requestMaterial(rec, MATERIALS[(i + 1) % MATERIALS.length].id);
  }

  /** Show the new material at once; rebuild the body after a short pause. */
  requestMaterial(rec: Live, materialId: string, by: 'user' | 'ai' = 'user', confidence = 1): void {
    const m = getMaterial(materialId);
    rec.pendingMaterial = materialId;
    rec.pendingBy = by;
    rec.pendingConfidence = confidence;
    rec.pendingAt = performance.now() + MATERIAL_REBUILD_DELAY;
    rec.material.color.set(m.visual.color);
    rec.material.roughness = m.visual.roughness;
    rec.material.metalness = m.visual.metalness;
    rec.material.transparent = m.visual.opacity < 1;
    rec.material.opacity = m.visual.opacity;
    rec.material.emissiveIntensity = 0.35;
    rec.material.needsUpdate = true;
    rec.lastInteract = performance.now();
    if (rec.creation && rec.label) {
      const preview = { ...rec.creation, materialId, materialConfidence: confidence, massKg: m.density * Math.abs(meshVolume(rec.mesh.geometry.getAttribute('position').array as Float32Array)) };
      rec.label.set(...labelText(preview, m), m.visual.color);
    }
  }

  /** Swap material: rebuild the body (shape properties are not reactive in IWSDK). */
  setMaterial(rec: Live, materialId: string, by: 'user' | 'ai' = 'user', confidence = 1): void {
    const c = rec.creation!;
    c.materialId = materialId;
    c.materialConfidence = confidence;
    this.rebuild(rec, materialId, {});
    bus.emit('object:material-set', { creationId: c.id, materialId, by, confidence });
  }

  /** Rebuild a creation's body with a new material and/or geometry, keeping how it is held. */
  private rebuild(rec: Live, materialId: string, o: { geometry?: BufferGeometry; flash?: number }): void {
    const c = rec.creation!;
    const geo = o.geometry ?? rec.mesh.geometry.clone();
    const mode = rec.mode === 'free' ? 'hover' : rec.mode === 'materialize' ? 'hover' : rec.mode;
    const side = rec.side;
    const pos = rec.mesh.position.toArray(), quat = rec.mesh.quaternion.toArray();
    const anchor = rec.mode === 'free' ? rec.mesh.position.clone() : rec.anchor.clone();
    const offset = rec.offset.clone();
    const wasPointer = this.pointerHeld === rec;
    const pieces = rec.pieces;
    // Create the new body BEFORE disposing the old one: disposing first frees the
    // entity index, the new entity reuses it in the same frame, and the physics
    // worker / impact tracking then confuse the two bodies (seen as a body that
    // sleeps mid-air, sinks through the table and reports no impacts).
    const n = this.spawnBody(geo, getMaterial(materialId), pos, quat, { creation: c, pieces, mode });
    this.dispose(rec);
    n.anchor.copy(anchor);
    n.offset.copy(offset);
    if (side) this.hold(n, mode, side);
    if (wasPointer) this.pointerHeld = n;
    n.material.emissiveIntensity = o.flash ?? 0.35; // small flash to show the change
    c.massKg = n.massKg;
    if (this.focus === rec || !this.focus) this.focus = n;
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
            rec.offset.set(rec.mesh.position.x - h.pinchPoint[0], rec.mesh.position.y - h.pinchPoint[1], rec.mesh.position.z - h.pinchPoint[2]);
            this.hold(rec, 'pinch', side);
          }
        }
      }
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const rec = this.live[i];
      if (!this.live.includes(rec)) continue;
      if (rec.pendingMaterial && now > rec.pendingAt) {
        this.setMaterial(rec, rec.pendingMaterial, rec.pendingBy, rec.pendingConfidence);
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
        rec.material.emissiveIntensity = 0.6 * (1 - t);
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
    if (rec.material.emissiveIntensity > 0 && rec.mode !== 'materialize') rec.material.emissiveIntensity = Math.max(0, rec.material.emissiveIntensity - dt * 1.2);
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
    rec.material.emissiveIntensity = 0.4;
    this.hold(rec, 'hover', null);
  }
  private xz = [0, 0];

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
        if (!rec.pendingMaterial) rec.label.set(...labelText(rec.creation, rec.mat), rec.mat.visual.color);
      }
    }
  }
}

function labelText(c: Creation, m: Material): [string, string] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const title = `${c.name} · ${m.name}${c.materialConfidence < 1 ? ` ${pct(c.materialConfidence)}` : ''}`;
  const size = c.sizeCm.map((v) => v.toFixed(0)).join('×');
  const grams = c.massKg >= 1 ? `${c.massKg.toFixed(2)} kg` : `${Math.round(c.massKg * 1000)} g`;
  if (c.aiStatus) return [title, c.aiStatus];
  const how = c.source === 'ai' ? 'AI model' : c.source === 'template' ? `matched ${pct(c.matchScore)}` : c.bestGuess ? `a bit like a ${c.bestGuess.name.toLowerCase()}?` : 'your sculpt';
  return [title, `${grams} · ${size} cm · ${how}`];
}

const easeOutBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
