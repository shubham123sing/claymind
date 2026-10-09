/**
 * Signed-distance grid for clay sculpting. Negative = inside clay.
 * Values are clamped to a narrow band so brushes stay local and cheap.
 * Pure data + math: runs in a Web Worker and in unit tests.
 */
export const CHUNK_CELLS = 8;

export type BrushOp = 'add' | 'carve' | 'smooth';

export class SdfGrid {
  /** Samples per axis. Cells per axis = res - 1. */
  readonly res: number;
  /** Edge length of the grid cube in metres. */
  readonly size: number;
  readonly voxel: number;
  readonly band: number;
  readonly data: Float32Array;
  readonly chunksPerAxis: number;
  readonly dirty: Uint8Array;
  /** World-space min corner of the grid (metres). */
  readonly origin: [number, number, number];

  constructor(res = 48, size = 0.25, origin: [number, number, number] = [-0.125, -0.125, -0.125]) {
    this.res = res;
    this.size = size;
    this.voxel = size / (res - 1);
    this.band = this.voxel * 4;
    this.origin = origin;
    this.data = new Float32Array(res * res * res).fill(this.band);
    this.chunksPerAxis = Math.ceil((res - 1) / CHUNK_CELLS);
    this.dirty = new Uint8Array(this.chunksPerAxis ** 3);
  }

  index(i: number, j: number, k: number): number {
    return i + this.res * (j + this.res * k);
  }

  get(i: number, j: number, k: number): number {
    return this.data[this.index(i, j, k)];
  }

  chunkIndex(ci: number, cj: number, ck: number): number {
    return ci + this.chunksPerAxis * (cj + this.chunksPerAxis * ck);
  }

  markAllDirty(): void {
    this.dirty.fill(1);
  }

  /** Mark every chunk that contains sample range [i0..i1] etc. as dirty. */
  private markDirtyRange(i0: number, j0: number, k0: number, i1: number, j1: number, k1: number): void {
    const c = CHUNK_CELLS;
    const max = this.chunksPerAxis - 1;
    const ci0 = Math.max(0, Math.floor((i0 - 1) / c)), ci1 = Math.min(max, Math.floor(i1 / c));
    const cj0 = Math.max(0, Math.floor((j0 - 1) / c)), cj1 = Math.min(max, Math.floor(j1 / c));
    const ck0 = Math.max(0, Math.floor((k0 - 1) / c)), ck1 = Math.min(max, Math.floor(k1 / c));
    for (let ck = ck0; ck <= ck1; ck++)
      for (let cj = cj0; cj <= cj1; cj++)
        for (let ci = ci0; ci <= ci1; ci++) this.dirty[this.chunkIndex(ci, cj, ck)] = 1;
  }

  /** Replace contents with a sphere (initial clay lump). Centre in world metres. */
  fillSphere(cx: number, cy: number, cz: number, r: number): void {
    const { res, voxel, band, origin } = this;
    for (let k = 0; k < res; k++)
      for (let j = 0; j < res; j++)
        for (let i = 0; i < res; i++) {
          const x = origin[0] + i * voxel - cx;
          const y = origin[1] + j * voxel - cy;
          const z = origin[2] + k * voxel - cz;
          const d = Math.sqrt(x * x + y * y + z * z) - r;
          this.data[this.index(i, j, k)] = Math.max(-band, Math.min(band, d));
        }
    this.markAllDirty();
  }

  /**
   * Apply a spherical brush. Returns number of samples touched.
   * add/carve use a smooth union/subtraction (k = blend width).
   */
  brush(op: BrushOp, cx: number, cy: number, cz: number, radius: number, strength = 1): number {
    const { res, voxel, band, origin, data } = this;
    const reach = radius + band;
    const i0 = Math.max(1, Math.floor((cx - reach - origin[0]) / voxel));
    const j0 = Math.max(1, Math.floor((cy - reach - origin[1]) / voxel));
    const k0 = Math.max(1, Math.floor((cz - reach - origin[2]) / voxel));
    const i1 = Math.min(res - 2, Math.ceil((cx + reach - origin[0]) / voxel));
    const j1 = Math.min(res - 2, Math.ceil((cy + reach - origin[1]) / voxel));
    const k1 = Math.min(res - 2, Math.ceil((cz + reach - origin[2]) / voxel));
    if (i0 > i1 || j0 > j1 || k0 > k1) return 0;
    const blend = voxel * 2;
    const sx = 1, sy = res, sz = res * res;
    let touched = 0;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = origin[0] + i * voxel - cx;
          const y = origin[1] + j * voxel - cy;
          const z = origin[2] + k * voxel - cz;
          const dist = Math.sqrt(x * x + y * y + z * z);
          if (dist > reach) continue;
          const idx = i * sx + j * sy + k * sz;
          const v = data[idx];
          const d = dist - radius;
          let nv = v;
          if (op === 'add') {
            nv = smin(v, d, blend);
          } else if (op === 'carve') {
            nv = -smin(-v, -d, blend);
          } else {
            const avg =
              (data[idx - sx] + data[idx + sx] + data[idx - sy] + data[idx + sy] + data[idx - sz] + data[idx + sz]) / 6;
            const falloff = Math.max(0, 1 - dist / radius);
            nv = v + (avg - v) * strength * falloff;
          }
          nv = Math.max(-band, Math.min(band, nv));
          if (nv !== v) {
            data[idx] = nv;
            touched++;
          }
        }
    if (touched > 0) this.markDirtyRange(i0, j0, k0, i1, j1, k1);
    return touched;
  }
}

/** Polynomial smooth minimum (Inigo Quilez). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
