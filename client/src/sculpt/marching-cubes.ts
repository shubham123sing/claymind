/**
 * Chunked marching cubes over an SdfGrid (iso = 0). Non-indexed output with
 * normals from the SDF gradient. Uses the classic Bourke tables re-exported by
 * three's MarchingCubes addon; this module only reads the tables, no Three
 * objects are created, so it is safe in a worker and in node tests.
 */
import { edgeTable as edgeTableRaw, triTable as triTableRaw } from 'three/examples/jsm/objects/MarchingCubes.js';
import { CHUNK_CELLS, SdfGrid } from './sdf-grid.js';

// @types/three mis-declares these; at runtime both are flat Int32Arrays.
const edgeTable = edgeTableRaw as unknown as Int32Array;
const triTable = triTableRaw as unknown as Int32Array;

// Bourke corner offsets (i, j, k)
const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const EDGE_CORNERS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const WINDING = [0, 2, 1];
const MAX_FLOATS = CHUNK_CELLS ** 3 * 15 * 3;

export interface ChunkMesh {
  chunk: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Piece label per vertex (the inside sample of the cut edge). */
  labels: Uint8Array;
}

export class ChunkMesher {
  private pos = new Float32Array(MAX_FLOATS);
  private nrm = new Float32Array(MAX_FLOATS);
  private lab = new Uint8Array(MAX_FLOATS / 3);
  private el = new Uint8Array(12);
  private cv = new Float32Array(8);
  private cg = new Float32Array(24);
  private ep = new Float32Array(36);
  private en = new Float32Array(36);

  constructor(private grid: SdfGrid) {}

  private gradient(i: number, j: number, k: number, out: Float32Array, o: number): void {
    const g = this.grid, r = g.res;
    const ip = Math.min(i + 1, r - 1), im = Math.max(i - 1, 0);
    const jp = Math.min(j + 1, r - 1), jm = Math.max(j - 1, 0);
    const kp = Math.min(k + 1, r - 1), km = Math.max(k - 1, 0);
    out[o] = g.get(ip, j, k) - g.get(im, j, k);
    out[o + 1] = g.get(i, jp, k) - g.get(i, jm, k);
    out[o + 2] = g.get(i, j, kp) - g.get(i, j, km);
  }

  /** Polygonize one chunk. Returns copies sized to the actual output. */
  meshChunk(ci: number, cj: number, ck: number): ChunkMesh {
    const g = this.grid;
    const cells = g.res - 1;
    const i0 = ci * CHUNK_CELLS, i1 = Math.min(i0 + CHUNK_CELLS, cells);
    const j0 = cj * CHUNK_CELLS, j1 = Math.min(j0 + CHUNK_CELLS, cells);
    const k0 = ck * CHUNK_CELLS, k1 = Math.min(k0 + CHUNK_CELLS, cells);
    const { pos, nrm, lab, cv, cg, ep, en, el } = this;
    const v = g.voxel, o = g.origin;
    let n = 0;
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          let cube = 0;
          for (let c = 0; c < 8; c++) {
            const val = g.get(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2]);
            cv[c] = val;
            if (val < 0) cube |= 1 << c;
          }
          const edges = edgeTable[cube];
          if (edges === 0) continue;
          for (let c = 0; c < 8; c++) this.gradient(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2], cg, c * 3);
          for (let e = 0; e < 12; e++) {
            if (!(edges & (1 << e))) continue;
            const a = EDGE_CORNERS[e][0], b = EDGE_CORNERS[e][1];
            const va = cv[a], vb = cv[b];
            const t = va === vb ? 0.5 : va / (va - vb);
            const inside = va < 0 ? a : b;
            el[e] = g.labels[g.index(i + CORNER[inside][0], j + CORNER[inside][1], k + CORNER[inside][2])];
            ep[e * 3] = o[0] + (i + CORNER[a][0] + t * (CORNER[b][0] - CORNER[a][0])) * v;
            ep[e * 3 + 1] = o[1] + (j + CORNER[a][1] + t * (CORNER[b][1] - CORNER[a][1])) * v;
            ep[e * 3 + 2] = o[2] + (k + CORNER[a][2] + t * (CORNER[b][2] - CORNER[a][2])) * v;
            let nx = cg[a * 3] + t * (cg[b * 3] - cg[a * 3]);
            let ny = cg[a * 3 + 1] + t * (cg[b * 3 + 1] - cg[a * 3 + 1]);
            let nz = cg[a * 3 + 2] + t * (cg[b * 3 + 2] - cg[a * 3 + 2]);
            const len = Math.hypot(nx, ny, nz) || 1;
            en[e * 3] = nx / len; en[e * 3 + 1] = ny / len; en[e * 3 + 2] = nz / len;
          }
          const base = cube * 16;
          for (let t = 0; triTable[base + t] !== -1; t += 3) {
            // Bourke winding is clockwise for "inside < iso"; emit 0,2,1 for CCW outward faces.
            for (let s = 0; s < 3; s++) {
              const e = triTable[base + t + WINDING[s]];
              pos[n] = ep[e * 3]; pos[n + 1] = ep[e * 3 + 1]; pos[n + 2] = ep[e * 3 + 2];
              nrm[n] = en[e * 3]; nrm[n + 1] = en[e * 3 + 1]; nrm[n + 2] = en[e * 3 + 2];
              lab[n / 3] = el[e];
              n += 3;
            }
          }
        }
    return { chunk: g.chunkIndex(ci, cj, ck), positions: pos.slice(0, n), normals: nrm.slice(0, n), labels: lab.slice(0, n / 3) };
  }

  /** Mesh all dirty chunks and clear their flags. */
  meshDirty(): ChunkMesh[] {
    const g = this.grid, c = g.chunksPerAxis;
    const out: ChunkMesh[] = [];
    for (let ck = 0; ck < c; ck++)
      for (let cj = 0; cj < c; cj++)
        for (let ci = 0; ci < c; ci++) {
          const idx = g.chunkIndex(ci, cj, ck);
          if (!g.dirty[idx]) continue;
          g.dirty[idx] = 0;
          out.push(this.meshChunk(ci, cj, ck));
        }
    return out;
  }
}

/** Signed volume (m^3) of a closed, CCW-wound triangle soup. */
export function meshVolume(positions: Float32Array): number {
  let v = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
