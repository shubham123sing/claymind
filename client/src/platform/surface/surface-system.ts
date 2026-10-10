/**
 * SurfaceProvider: the work surface everything sits on.
 * - virtual table + floor colliders (browser, emulator, or before planes arrive)
 * - real horizontal planes from scene understanding -> static box colliders;
 *   the first table-height plane becomes the work surface.
 * IWSDK physics reads object3D.position in LOCAL space, so colliders are
 * root-level entities with world poses copied from the plane.
 */
import {
  BoxGeometry, createSystem, Entity, Mesh, MeshStandardMaterial, PhysicsBody, PhysicsShape,
  PhysicsShapeType, PhysicsState, Quaternion, Vector3, VisibilityState, XRPlane,
} from '@iwsdk/core';

export interface WorkSurface {
  /** Height of the top surface (m). */
  topY: number;
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  /** Rotation of the surface around +Y (radians). */
  yaw: number;
  real: boolean;
  /** Increments whenever the surface changes. */
  version: number;
}

export const VIRTUAL_TABLE = { centerX: 0, centerZ: -0.42, width: 0.8, depth: 0.5, thickness: 0.03, topY: 0.72 };

export const surface: WorkSurface = {
  topY: VIRTUAL_TABLE.topY,
  centerX: VIRTUAL_TABLE.centerX,
  centerZ: VIRTUAL_TABLE.centerZ,
  halfW: VIRTUAL_TABLE.width / 2,
  halfD: VIRTUAL_TABLE.depth / 2,
  yaw: 0,
  real: false,
  version: 0,
};

/**
 * Point on the surface closest to `(x, z)` (e.g. the user's head), kept
 * `margin` metres inside the edges. Writes [x, z] into `out`.
 */
export function nearestSurfacePoint(x: number, z: number, margin: number, out: number[]): void {
  // world -> surface-local is the inverse rotation: R(yaw)^T
  const c = Math.cos(surface.yaw), s = Math.sin(surface.yaw);
  const lx = (x - surface.centerX) * c - (z - surface.centerZ) * s;
  const lz = (x - surface.centerX) * s + (z - surface.centerZ) * c;
  const cx = Math.max(-Math.max(0, surface.halfW - margin), Math.min(Math.max(0, surface.halfW - margin), lx));
  const cz = Math.max(-Math.max(0, surface.halfD - margin), Math.min(Math.max(0, surface.halfD - margin), lz));
  const c2 = Math.cos(surface.yaw), s2 = Math.sin(surface.yaw);
  out[0] = surface.centerX + cx * c2 + cz * s2;
  out[1] = surface.centerZ - cx * s2 + cz * c2;
}

interface TableCandidate {
  topY: number;
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  yaw: number;
}

/**
 * Only tables whose edge is within this horizontal distance of the user's head
 * are usable: the clay sits ~0.2 m in from the edge, so this keeps it within
 * ~0.7 m (seated arm's reach). Farther tables fall back to the virtual table.
 */
const MAX_TABLE_DISTANCE = 0.5;
/** A different table must be this much closer before the work surface moves. */
const SWITCH_HYSTERESIS = 0.2;

/** Horizontal distance from (x, z) to a candidate's rectangle (0 when above it). */
export function distanceToRect(c: TableCandidate, x: number, z: number): number {
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const lx = (x - c.centerX) * cs - (z - c.centerZ) * sn;
  const lz = (x - c.centerX) * sn + (z - c.centerZ) * cs;
  return Math.hypot(Math.max(0, Math.abs(lx) - c.halfW), Math.max(0, Math.abs(lz) - c.halfD));
}

export class SurfaceSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private virtualTable: Entity | null = null;
  private candidates = new Map<number, TableCandidate>();
  private current: TableCandidate | null = null;
  private head = new Vector3();
  private lastEval = 0;
  private tableMat = new MeshStandardMaterial({ color: 0x9b7b5e, roughness: 0.85 });
  private colliders = new Map<number, Entity>();
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpEuler = new Vector3();

  private createVirtualTable(): void {
    const t = VIRTUAL_TABLE;
    const tableMesh = new Mesh(new BoxGeometry(t.width, t.thickness, t.depth), this.tableMat);
    tableMesh.position.set(t.centerX, t.topY - t.thickness / 2, t.centerZ);
    tableMesh.receiveShadow = true;
    this.virtualTable = this.world.createTransformEntity(tableMesh);
    this.virtualTable.addComponent(PhysicsShape, {
      // hull, not Box: IWSDK Box colliders round their edges by ~1.4 cm (objects slid off early);
      // friction combines by MIN and restitution by MAX in Havok, so the object's own material decides
      shape: PhysicsShapeType.ConvexHull, friction: 1, restitution: 0,
    });
    this.virtualTable.addComponent(PhysicsBody, { state: PhysicsState.Static });
  }

  init(): void {
    this.createVirtualTable();

    const floor = new Mesh(new BoxGeometry(6, 0.1, 6), new MeshStandardMaterial({ visible: false }));
    floor.position.set(0, -0.05, 0);
    const floorEntity = this.world.createTransformEntity(floor);
    floorEntity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [6, 0.1, 6], friction: 1, restitution: 0 });
    floorEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });

    // In passthrough the virtual table is a translucent hint until a real one is found.
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        const immersive = v !== VisibilityState.NonImmersive;
        this.tableMat.transparent = immersive;
        this.tableMat.opacity = immersive ? 0.35 : 1;
        this.tableMat.needsUpdate = true;
      }),
    );

    this.queries.planes.subscribe('qualify', (entity) => this.onPlane(entity));
    this.queries.planes.subscribe('disqualify', (entity) => {
      this.colliders.get(entity.index)?.dispose();
      this.colliders.delete(entity.index);
      this.candidates.delete(entity.index);
      this.evaluate(true);
    });
  }

  update(): void {
    // the user's head moves after tracking starts; re-check the best table now and then
    const now = performance.now();
    if (this.candidates.size > 0 && now - this.lastEval > 1000) this.evaluate(false);
  }

  /** Pick the table plane nearest the user (within reach), with hysteresis. */
  private evaluate(force: boolean): void {
    this.lastEval = performance.now();
    this.world.camera.getWorldPosition(this.head);
    let best: TableCandidate | null = null;
    let bestD = Infinity;
    for (const c of this.candidates.values()) {
      const d = distanceToRect(c, this.head.x, this.head.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (bestD > MAX_TABLE_DISTANCE) best = null;
    if (best === this.current) return;
    if (!force && best && this.current && this.candidatesHas(this.current)) {
      const curD = distanceToRect(this.current, this.head.x, this.head.z);
      if (curD <= MAX_TABLE_DISTANCE && bestD > curD - SWITCH_HYSTERESIS) return;
    }
    this.current = best;
    if (best) {
      Object.assign(surface, best, { real: true });
      this.virtualTable?.dispose();
      this.virtualTable = null;
    } else {
      const t = VIRTUAL_TABLE;
      Object.assign(surface, {
        topY: t.topY, centerX: t.centerX, centerZ: t.centerZ, halfW: t.width / 2, halfD: t.depth / 2, yaw: 0, real: false,
      });
      if (!this.virtualTable) this.createVirtualTable();
    }
    surface.version++;
  }

  private candidatesHas(c: TableCandidate): boolean {
    for (const v of this.candidates.values()) if (v === c) return true;
    return false;
  }

  private onPlane(entity: Entity): void {
    const plane = entity.getValue(XRPlane, '_plane') as unknown as globalThis.XRPlane | undefined;
    const obj = entity.object3D;
    if (!plane || !obj || plane.orientation !== 'horizontal') return;
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(this.tmpPos);
    obj.getWorldQuaternion(this.tmpQuat);
    const y = this.tmpPos.y;
    const isTable = y > 0.4 && y < 1.2;
    const isFloor = y < 0.2;
    if (!isTable && !isFloor) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of plane.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const w = maxX - minX, d = maxZ - minZ, th = 0.04;
    const mesh = new Mesh(new BoxGeometry(w, th, d), new MeshStandardMaterial({ visible: false }));
    const local = new Vector3((minX + maxX) / 2, -th / 2, (minZ + maxZ) / 2).applyQuaternion(this.tmpQuat);
    mesh.position.copy(this.tmpPos).add(local);
    mesh.quaternion.copy(this.tmpQuat);
    const collider = this.world.createTransformEntity(mesh);
    collider.addComponent(PhysicsShape, { shape: PhysicsShapeType.ConvexHull, friction: 1, restitution: 0 }); // see virtual table
    collider.addComponent(PhysicsBody, { state: PhysicsState.Static });
    this.colliders.set(entity.index, collider);

    if (isTable && w > 0.3 && d > 0.25) {
      // yaw of the plane's local X axis around world Y
      this.tmpEuler.set(1, 0, 0).applyQuaternion(this.tmpQuat);
      this.candidates.set(entity.index, {
        topY: y,
        centerX: mesh.position.x,
        centerZ: mesh.position.z,
        halfW: w / 2,
        halfD: d / 2,
        yaw: Math.atan2(-this.tmpEuler.z, this.tmpEuler.x),
      });
      this.evaluate(false);
    }
  }
}
