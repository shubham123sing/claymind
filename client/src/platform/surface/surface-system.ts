/**
 * SurfaceProvider: the work surface everything sits on.
 * - virtual table + floor colliders (browser, emulator, or before planes arrive)
 * - the room (Update 3, Step B): every plane the XR environment reports becomes a
 *   static collider: walls (vertical planes), the floor, the ceiling and furniture tops;
 *   until a wall plane arrives, invisible walls 2 m around the table keep things in.
 *   Surfaces use real friction (table wood, floor and walls stone); their bounce is 0
 *   because Havok combines bounce by the larger value, so the object's material decides.
 * - real horizontal planes from scene understanding -> static box colliders;
 *   the first table-height plane becomes the work surface.
 * IWSDK physics reads object3D.position in LOCAL space, so colliders are
 * root-level entities with world poses copied from the plane.
 */
import { SURFACE_MATERIAL } from '../../materials/matchups.js';
import { getMaterial } from '../../materials/materials.js';
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
/**
 * Table colliders reach this far below the top (m). A thrown ball moves up to
 * ~8 cm per physics step and there is no continuous collision detection, so a
 * thin top could be skipped; nothing ever rests under a table.
 */
const TABLE_COLLIDER_DEPTH = 0.25;
/** Floor, wall and ceiling slabs: thick for the same reason (no fast object passes them). */
const FLOOR_DEPTH = 0.5;
const WALL_DEPTH = 0.3;
/** Without room planes: invisible walls this far around the table, this tall. */
const FALLBACK_ROOM = { half: 2, height: 2.6 };

type SurfaceKind = 'table' | 'floor' | 'wall';
/** Collider friction / restitution for a kind of surface (see the header). */
function surfacePhysics(kind: SurfaceKind): { friction: number; restitution: number } {
  return { friction: getMaterial(kind === 'table' ? SURFACE_MATERIAL.table : SURFACE_MATERIAL.floor).friction, restitution: 0 };
}

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
  private tmpNormal = new Vector3();
  private tmpHead = new Vector3();

  private createVirtualTable(): void {
    const t = VIRTUAL_TABLE;
    const tableMesh = new Mesh(new BoxGeometry(t.width, t.thickness, t.depth), this.tableMat);
    tableMesh.position.set(t.centerX, t.topY - t.thickness / 2, t.centerZ);
    tableMesh.receiveShadow = true;
    this.virtualTable = this.world.createTransformEntity(tableMesh);
    // the collider is a separate, deeper slab (see TABLE_COLLIDER_DEPTH) under the same top
    const slab = new Mesh(new BoxGeometry(t.width, TABLE_COLLIDER_DEPTH, t.depth), new MeshStandardMaterial({ visible: false }));
    slab.position.set(t.centerX, t.topY - TABLE_COLLIDER_DEPTH / 2, t.centerZ);
    this.virtualTableCollider = this.world.createTransformEntity(slab);
    this.virtualTableCollider.addComponent(PhysicsShape, {
      // hull, not Box: IWSDK Box colliders round their edges by ~1.4 cm (objects slid off early);
      // friction combines by MIN and restitution by MAX in Havok, so the object's own material decides
      shape: PhysicsShapeType.ConvexHull, ...surfacePhysics('table'),
    });
    this.virtualTableCollider.addComponent(PhysicsBody, { state: PhysicsState.Static });
  }
  private virtualTableCollider: Entity | null = null;
  private fallbackWalls: Entity[] = [];

  /** An invisible static box collider (centre and size in metres, world axes). */
  private staticBox(size: [number, number, number], at: [number, number, number], kind: SurfaceKind): Entity {
    const m = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial({ visible: false }));
    m.position.set(...at);
    const e = this.world.createTransformEntity(m);
    e.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: size, ...surfacePhysics(kind) });
    e.addComponent(PhysicsBody, { state: PhysicsState.Static });
    return e;
  }

  /** Four invisible walls and a ceiling around the virtual table (gone once the room's own walls arrive). */
  private createFallbackWalls(): void {
    const t = VIRTUAL_TABLE, h = FALLBACK_ROOM.half, H = FALLBACK_ROOM.height, d = WALL_DEPTH;
    this.fallbackWalls = [
      this.staticBox([2 * h + 2 * d, H, d], [t.centerX, H / 2, t.centerZ - h - d / 2], 'wall'),
      this.staticBox([2 * h + 2 * d, H, d], [t.centerX, H / 2, t.centerZ + h + d / 2], 'wall'),
      this.staticBox([d, H, 2 * h], [t.centerX - h - d / 2, H / 2, t.centerZ], 'wall'),
      this.staticBox([d, H, 2 * h], [t.centerX + h + d / 2, H / 2, t.centerZ], 'wall'),
      this.staticBox([2 * h + 2 * d, d, 2 * h + 2 * d], [t.centerX, H + d / 2, t.centerZ], 'wall'), // ceiling
    ];
  }

  /** The room has real walls now: they replace the fallback ones. */
  private dropFallbackWalls(): void {
    for (const e of this.fallbackWalls) e.dispose();
    this.fallbackWalls = [];
  }

  init(): void {
    this.createVirtualTable();

    this.staticBox([12, FLOOR_DEPTH, 12], [0, -FLOOR_DEPTH / 2, 0], 'floor');
    this.createFallbackWalls();

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
      this.virtualTableCollider?.dispose();
      this.virtualTableCollider = null;
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
    if (!plane || !obj) return;
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(this.tmpPos);
    obj.getWorldQuaternion(this.tmpQuat);
    const y = this.tmpPos.y;
    const wall = plane.orientation !== 'horizontal';
    const isTable = !wall && y > 0.4 && y < 1.2;
    const isFloor = !wall && y < 0.2;
    if (wall) this.dropFallbackWalls();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of plane.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    // the slab sits behind the plane, out of the room: on the side away from the player's head (a plane's own
    // +Y is not always the room side: an emulated floor's points down, which put a 50 cm slab on top of the floor)
    const w = maxX - minX, d = maxZ - minZ, th = isTable ? TABLE_COLLIDER_DEPTH : wall ? WALL_DEPTH : isFloor ? FLOOR_DEPTH : 0.2;
    const mesh = new Mesh(new BoxGeometry(w, th, d), new MeshStandardMaterial({ visible: false }));
    const normal = this.tmpNormal.set(0, 1, 0).applyQuaternion(this.tmpQuat);
    const head = this.world.camera.getWorldPosition(this.tmpHead);
    const roomSide = normal.dot(head.sub(this.tmpPos)) >= 0 ? 1 : -1;
    const local = new Vector3((minX + maxX) / 2, (-th / 2) * roomSide, (minZ + maxZ) / 2).applyQuaternion(this.tmpQuat);
    mesh.position.copy(this.tmpPos).add(local);
    mesh.quaternion.copy(this.tmpQuat);
    const collider = this.world.createTransformEntity(mesh);
    collider.addComponent(PhysicsShape, { shape: PhysicsShapeType.ConvexHull, ...surfacePhysics(isTable ? 'table' : wall ? 'wall' : 'floor') }); // see virtual table
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
