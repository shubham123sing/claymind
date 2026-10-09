/**
 * Surfaces for the drop test:
 * - a virtual table + floor (browser / emulator / no planes detected)
 * - static box colliders for real horizontal planes from scene understanding.
 * Note: IWSDK physics reads object3D.position in LOCAL space, so colliders are
 * created as root-level entities with world poses copied from the plane.
 */
import {
  BoxGeometry, createSystem, Entity, Mesh, MeshStandardMaterial, PhysicsBody, PhysicsShape,
  PhysicsShapeType, PhysicsState, Quaternion, Vector3, XRPlane,
} from '@iwsdk/core';
import { spike, TABLE } from './spike-state.js';

export class TableSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private virtualTable: Entity | null = null;
  private colliders = new Map<number, Entity>();
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();

  init(): void {
    const tableMesh = new Mesh(
      new BoxGeometry(TABLE.width, TABLE.thickness, TABLE.depth),
      new MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.8, transparent: true, opacity: 0.85 }),
    );
    tableMesh.position.set(TABLE.centerX, TABLE.topY - TABLE.thickness / 2, TABLE.centerZ);
    this.virtualTable = this.world.createTransformEntity(tableMesh);
    this.virtualTable.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Box,
      dimensions: [TABLE.width, TABLE.thickness, TABLE.depth],
      friction: 0.6,
      restitution: 0.2,
    });
    this.virtualTable.addComponent(PhysicsBody, { state: PhysicsState.Static });

    // Invisible floor so nothing falls forever (real floor plane may replace it in AR).
    const floor = new Mesh(new BoxGeometry(6, 0.1, 6), new MeshStandardMaterial({ visible: false }));
    floor.position.set(0, -0.05, 0);
    const floorEntity = this.world.createTransformEntity(floor);
    floorEntity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [6, 0.1, 6], friction: 0.7 });
    floorEntity.addComponent(PhysicsBody, { state: PhysicsState.Static });

    this.queries.planes.subscribe('qualify', (entity) => this.onPlane(entity));
    this.queries.planes.subscribe('disqualify', (entity) => {
      this.colliders.get(entity.index)?.dispose();
      this.colliders.delete(entity.index);
    });
    spike.hud?.set('surface', `virtual table top y=${TABLE.topY.toFixed(2)} m`);
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

    // Polygon is in plane-local XZ. Use its bounding box as a thin static box.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of plane.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const w = maxX - minX, d = maxZ - minZ, t = 0.04;
    const mesh = new Mesh(new BoxGeometry(w, t, d), new MeshStandardMaterial({ visible: false }));
    // local centre offset (bbox centre, half thickness below the surface) -> world
    const local = new Vector3((minX + maxX) / 2, -t / 2, (minZ + maxZ) / 2).applyQuaternion(this.tmpQuat);
    mesh.position.copy(this.tmpPos).add(local);
    mesh.quaternion.copy(this.tmpQuat);
    const collider = this.world.createTransformEntity(mesh);
    collider.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [w, t, d], friction: 0.6, restitution: 0.2 });
    collider.addComponent(PhysicsBody, { state: PhysicsState.Static });
    this.colliders.set(entity.index, collider);

    if (isTable && !spike.realTable) {
      spike.realTable = true;
      spike.tableTopY = y;
      this.virtualTable?.dispose();
      this.virtualTable = null;
      spike.hud?.set('surface', `REAL table plane y=${y.toFixed(2)} m  ${(w * 100).toFixed(0)}x${(d * 100).toFixed(0)} cm`);
    }
    spike.hud?.set('planes', `${this.colliders.size} horizontal plane colliders`);
  }
}
