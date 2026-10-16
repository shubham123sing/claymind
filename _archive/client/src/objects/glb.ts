/**
 * Minimal binary glTF 2.0 writer for a single indexed mesh with one PBR
 * material (positions + normals + indices). Used to bake the offline sample
 * models shipped with the game, and to save AI results in a compact form.
 * Pure TypeScript (no Three / DOM).
 */
export interface GlbMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
  roughness: number;
  metalness: number;
  name?: string;
}

/** Merge identical vertices of a non-indexed triangle soup (marching-cubes output). */
export function weld(positions: Float32Array, normals: Float32Array, precision = 1e-5): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const map = new Map<string, number>();
  const pos: number[] = [], nrm: number[] = [];
  const indices = new Uint32Array(positions.length / 3);
  const q = 1 / precision;
  for (let v = 0; v < positions.length / 3; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = pos.length / 3;
      map.set(key, idx);
      pos.push(x, y, z);
      nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
    } else {
      // average normals of merged vertices
      nrm[idx * 3] += normals[v * 3];
      nrm[idx * 3 + 1] += normals[v * 3 + 1];
      nrm[idx * 3 + 2] += normals[v * 3 + 2];
    }
    indices[v] = idx;
  }
  const n = new Float32Array(nrm);
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return { positions: new Float32Array(pos), normals: n, indices };
}

const pad4 = (n: number) => (n + 3) & ~3;

export function writeGlb(m: GlbMesh): ArrayBuffer {
  const vCount = m.positions.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], m.positions[i + a]);
      max[a] = Math.max(max[a], m.positions[i + a]);
    }
  const posBytes = m.positions.byteLength, nrmBytes = m.normals.byteLength, idxBytes = m.indices.byteLength;
  const binLength = pad4(posBytes) + pad4(nrmBytes) + pad4(idxBytes);
  const json = {
    asset: { version: '2.0', generator: 'ClayMind' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: m.name ?? 'object' }],
    meshes: [{ name: m.name ?? 'object', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metalness, roughnessFactor: m.roughness }, doubleSided: false }],
    buffers: [{ byteLength: binLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: pad4(posBytes), byteLength: nrmBytes, target: 34962 },
      { buffer: 0, byteOffset: pad4(posBytes) + pad4(nrmBytes), byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vCount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5125, count: m.indices.length, type: 'SCALAR' },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  u8.set(jsonBytes, 20);
  for (let i = 20 + jsonBytes.length; i < 20 + jsonLength; i++) u8[i] = 0x20; // pad with spaces
  const binStart = 20 + jsonLength;
  dv.setUint32(binStart, binLength, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // 'BIN'
  let o = binStart + 8;
  u8.set(new Uint8Array(m.positions.buffer, m.positions.byteOffset, posBytes), o);
  o += pad4(posBytes);
  u8.set(new Uint8Array(m.normals.buffer, m.normals.byteOffset, nrmBytes), o);
  o += pad4(nrmBytes);
  u8.set(new Uint8Array(m.indices.buffer, m.indices.byteOffset, idxBytes), o);
  return out;
}
