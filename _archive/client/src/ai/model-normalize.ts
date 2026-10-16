/**
 * Turns a generated GLB scene into one game-ready geometry: all meshes baked
 * into one non-indexed position/normal buffer, centred on its bounding box and
 * uniformly scaled so its bounding-box volume matches the sculpt's (a lumpy
 * 14×17×11 cm sculpt must not become a 17 cm ball: mass would triple).
 */
import { Box3, BufferGeometry, Object3D, Vector3 } from '@iwsdk/core';
import type { BakedMesh } from '../objects/bake.js';

export const MAX_MODEL_TRIANGLES = 80_000;

export function normalizeModel(root: Object3D, targetSizeM: [number, number, number]): (BakedMesh & { size: [number, number, number] }) | null {
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  root.traverse((o) => {
    const mesh = o as unknown as { isMesh?: boolean; geometry?: BufferGeometry; matrixWorld: Object3D['matrixWorld'] };
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    parts.push(g);
  });
  if (!parts.length) return null;
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count * 3;
  if (n / 9 > MAX_MODEL_TRIANGLES) {
    for (const g of parts) g.dispose();
    return null; // too heavy for Quest; keep the local object
  }
  const positions = new Float32Array(n), normals = new Float32Array(n);
  let o = 0;
  for (const g of parts) {
    const p = g.getAttribute('position'), nm = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++, o += 3) {
      positions[o] = p.getX(i); positions[o + 1] = p.getY(i); positions[o + 2] = p.getZ(i);
      normals[o] = nm.getX(i); normals[o + 1] = nm.getY(i); normals[o + 2] = nm.getZ(i);
    }
    g.dispose();
  }
  const box = new Box3();
  const v = new Vector3();
  for (let i = 0; i < n; i += 3) box.expandByPoint(v.set(positions[i], positions[i + 1], positions[i + 2]));
  const c = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
  const s = Math.cbrt((targetSizeM[0] * targetSizeM[1] * targetSizeM[2]) / Math.max(1e-12, size.x * size.y * size.z));
  for (let i = 0; i < n; i += 3) {
    positions[i] = (positions[i] - c.x) * s;
    positions[i + 1] = (positions[i + 1] - c.y) * s;
    positions[i + 2] = (positions[i + 2] - c.z) * s;
  }
  return { positions, normals, size: [size.x * s, size.y * s, size.z * s] };
}
