/**
 * Signed-distance grid for clay sculpting. Negative = inside clay.
 * Values are clamped to a narrow band so brushes stay local and cheap.
 * Boundary samples are always "outside" so the surface is always closed.
 * Coordinates are grid-local metres; the grid cube is centred on the origin.
 * Pure data + math: runs in a Web Worker and in unit tests.
 */
export const CHUNK_CELLS = 8;

export type BrushOp = 'add' | 'carve' | 'smooth' | 'drag';

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
  /** Grid-local min corner (metres). */
  readonly origin: [number, number, number];
  private scratch: Float32Array | null = null;

  constructor(res = 48, size = 0.25) {
    this.res = res;
    this.size = size;
    this.voxel = size / (res - 1);
    this.band = this.voxel * 3;
    this.origin = [-size / 2, -size / 2, -size / 2];
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

  /** Mark every chunk whose cells (or vertex normals) use samples in [i0..i1]x[j0..j1]x[k0..k1]. */
  markDirtyRange(i0: number, j0: number, k0: number, i1: number, j1: number, k1: number): void {
    // normals use central differences, so a sample also affects cells one further out
    i0--; j0--; k0--; i1++; j1++; k1++;
    const c = CHUNK_CELLS;
    const max = this.chunksPerAxis - 1;
    const ci0 = Math.max(0, Math.floor((i0 - 1) / c)), ci1 = Math.min(max, Math.floor(i1 / c));
    const cj0 = Math.max(0, Math.floor((j0 - 1) / c)), cj1 = Math.min(max, Math.floor(j1 / c));
    const ck0 = Math.max(0, Math.floor((k0 - 1) / c)), ck1 = Math.min(max, Math.floor(k1 / c));
    for (let ck = ck0; ck <= ck1; ck++)
      for (let cj = cj0; cj <= cj1; cj++)
        for (let ci = ci0; ci <= ci1; ci++) this.dirty[this.chunkIndex(ci, cj, ck)] = 1;
  }

  /** Mark chunks wherever `data` differs from `previous` (used after undo/redo rebuilds). */
  markChangedSince(previous: Float32Array): number {
    const r = this.res;
    let changed = 0;
    for (let k = 0; k < r; k++)
      for (let j = 0; j < r; j++) {
        const row = r * (j + r * k);
        for (let i = 0; i < r; i++) {
          if (this.data[row + i] !== previous[row + i]) {
            changed++;
            this.markDirtyRange(i, j, k, i, j, k);
          }
        }
      }
    return changed;
  }

  private isBoundary(i: number, j: number, k: number): boolean {
    const m = this.res - 1;
    return i === 0 || j === 0 || k === 0 || i === m || j === m || k === m;
  }

  /** Replace contents with a sphere (initial clay lump). Grid-local metres. */
  fillSphere(cx: number, cy: number, cz: number, r: number): void {
    const { res, voxel, band, origin } = this;
    for (let k = 0; k < res; k++)
      for (let j = 0; j < res; j++)
        for (let i = 0; i < res; i++) {
          const x = origin[0] + i * voxel - cx;
          const y = origin[1] + j * voxel - cy;
          const z = origin[2] + k * voxel - cz;
          const d = this.isBoundary(i, j, k) ? band : Math.sqrt(x * x + y * y + z * z) - r;
          this.data[this.index(i, j, k)] = Math.max(-band, Math.min(band, d));
        }
    this.markAllDirty();
  }

  /** Trilinear sample of `src` (defaults to current data) at grid-local metres. */
  sample(x: number, y: number, z: number, src: Float32Array = this.data): number {
    const { res, voxel, origin, band } = this;
    const fx = (x - origin[0]) / voxel, fy = (y - origin[1]) / voxel, fz = (z - origin[2]) / voxel;
    if (fx < 0 || fy < 0 || fz < 0 || fx > res - 1 || fy > res - 1 || fz > res - 1) return band;
    const i = Math.min(res - 2, Math.floor(fx)), j = Math.min(res - 2, Math.floor(fy)), k = Math.min(res - 2, Math.floor(fz));
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const sy = res, sz = res * res;
    const b = i + j * sy + k * sz;
    const c00 = src[b] + (src[b + 1] - src[b]) * tx;
    const c10 = src[b + sy] + (src[b + sy + 1] - src[b + sy]) * tx;
    const c01 = src[b + sz] + (src[b + sz + 1] - src[b + sz]) * tx;
    const c11 = src[b + sy + sz] + (src[b + sy + sz + 1] - src[b + sy + sz]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }

  /**
   * Apply a spherical brush. Returns number of samples changed.
   * add/carve: smooth union/subtraction of a sphere, or of a capsule from c to
   * c+d when a delta is given. smooth: Laplacian relax with falloff.
   * drag: moves material from (cx,cy,cz) by (dx,dy,dz) with smooth falloff ("pull").
   */
  brush(op: BrushOp, cx: number, cy: number, cz: number, radius: number, dx = 0, dy = 0, dz = 0): number {
    if (op === 'drag') {
      const len = Math.hypot(dx, dy, dz);
      const steps = Math.max(1, Math.ceil(len / (radius * 0.2)));
      let n = 0;
      for (let s = 0; s < steps; s++) {
        n += this.dragStep(cx + (dx * s) / steps, cy + (dy * s) / steps, cz + (dz * s) / steps, radius, dx / steps, dy / steps, dz / steps);
      }
      return n;
    }
    const { res, voxel, band, origin, data } = this;
    const reach = radius + band;
    // add/carve with a delta sweep a capsule from c to c+d (continuous strokes)
    const segLen2 = op === 'smooth' ? 0 : dx * dx + dy * dy + dz * dz;
    const i0 = Math.max(1, Math.floor((Math.min(cx, cx + dx) - reach - origin[0]) / voxel));
    const j0 = Math.max(1, Math.floor((Math.min(cy, cy + dy) - reach - origin[1]) / voxel));
    const k0 = Math.max(1, Math.floor((Math.min(cz, cz + dz) - reach - origin[2]) / voxel));
    const i1 = Math.min(res - 2, Math.ceil((Math.max(cx, cx + dx) + reach - origin[0]) / voxel));
    const j1 = Math.min(res - 2, Math.ceil((Math.max(cy, cy + dy) + reach - origin[1]) / voxel));
    const k1 = Math.min(res - 2, Math.ceil((Math.max(cz, cz + dz) + reach - origin[2]) / voxel));
    if (i0 > i1 || j0 > j1 || k0 > k1) return 0;
    const blend = voxel * 2;
    const sy = res, sz = res * res;
    let touched = 0;
    let mi0 = res, mj0 = res, mk0 = res, mi1 = -1, mj1 = -1, mk1 = -1;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          let x = origin[0] + i * voxel - cx;
          let y = origin[1] + j * voxel - cy;
          let z = origin[2] + k * voxel - cz;
          if (segLen2 > 0) {
            // distance to segment: project onto the stroke and clamp
            const t = Math.max(0, Math.min(1, (x * dx + y * dy + z * dz) / segLen2));
            x -= dx * t; y -= dy * t; z -= dz * t;
          }
          const dist = Math.sqrt(x * x + y * y + z * z);
          if (dist > reach) continue;
          const idx = i + j * sy + k * sz;
          const v = data[idx];
          const d = dist - radius;
          let nv: number;
          if (op === 'add') nv = smin(v, d, blend);
          else if (op === 'carve') nv = -smin(-v, -d, blend);
          else {
            const avg = (data[idx - 1] + data[idx + 1] + data[idx - sy] + data[idx + sy] + data[idx - sz] + data[idx + sz]) / 6;
            const falloff = Math.max(0, 1 - dist / radius);
            nv = v + (avg - v) * 0.5 * falloff;
          }
          nv = Math.max(-band, Math.min(band, nv));
          if (nv !== v) {
            data[idx] = nv;
            touched++;
            if (i < mi0) mi0 = i; if (i > mi1) mi1 = i;
            if (j < mj0) mj0 = j; if (j > mj1) mj1 = j;
            if (k < mk0) mk0 = k; if (k > mk1) mk1 = k;
          }
        }
    if (touched > 0) this.markDirtyRange(mi0, mj0, mk0, mi1, mj1, mk1);
    return touched;
  }

  private dragStep(cx: number, cy: number, cz: number, radius: number, dx: number, dy: number, dz: number): number {
    const { res, voxel, band, origin, data } = this;
    if (!this.scratch || this.scratch.length !== data.length) this.scratch = new Float32Array(data.length);
    const src = this.scratch;
    const tx = cx + dx, ty = cy + dy, tz = cz + dz;
    // copy only the z-slab the samples can read from (contiguous memory)
    const reachK = (radius + Math.hypot(dx, dy, dz)) / voxel + 2;
    const sk0 = Math.max(0, Math.floor((tz - origin[2]) / voxel - reachK));
    const sk1 = Math.min(res - 1, Math.ceil((tz - origin[2]) / voxel + reachK));
    src.set(data.subarray(sk0 * res * res, (sk1 + 1) * res * res), sk0 * res * res);
    const i0 = Math.max(1, Math.floor((tx - radius - origin[0]) / voxel));
    const j0 = Math.max(1, Math.floor((ty - radius - origin[1]) / voxel));
    const k0 = Math.max(1, Math.floor((tz - radius - origin[2]) / voxel));
    const i1 = Math.min(res - 2, Math.ceil((tx + radius - origin[0]) / voxel));
    const j1 = Math.min(res - 2, Math.ceil((ty + radius - origin[1]) / voxel));
    const k1 = Math.min(res - 2, Math.ceil((tz + radius - origin[2]) / voxel));
    let touched = 0;
    let mi0 = res, mj0 = res, mk0 = res, mi1 = -1, mj1 = -1, mk1 = -1;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = origin[0] + i * voxel, y = origin[1] + j * voxel, z = origin[2] + k * voxel;
          const dist = Math.hypot(x - tx, y - ty, z - tz);
          if (dist >= radius) continue;
          const u = 1 - dist / radius;
          const w = u * u * (3 - 2 * u); // smoothstep falloff
          const idx = this.index(i, j, k);
          const nv = Math.max(-band, Math.min(band, this.sample(x - dx * w, y - dy * w, z - dz * w, src)));
          if (nv !== data[idx]) {
            data[idx] = nv;
            touched++;
            if (i < mi0) mi0 = i; if (i > mi1) mi1 = i;
            if (j < mj0) mj0 = j; if (j > mj1) mj1 = j;
            if (k < mk0) mk0 = k; if (k > mk1) mk1 = k;
          }
        }
    if (touched > 0) this.markDirtyRange(mi0, mj0, mk0, mi1, mj1, mk1);
    return touched;
  }

  /** Copy another grid's shape into this one (different resolution allowed). */
  resampleFrom(other: SdfGrid): void {
    const { res, voxel, origin, band } = this;
    for (let k = 0; k < res; k++)
      for (let j = 0; j < res; j++)
        for (let i = 0; i < res; i++) {
          const v = this.isBoundary(i, j, k)
            ? band
            : other.sample(origin[0] + i * voxel, origin[1] + j * voxel, origin[2] + k * voxel);
          this.data[this.index(i, j, k)] = Math.max(-band, Math.min(band, v));
        }
    this.markAllDirty();
  }
}

/** Polynomial smooth minimum (Inigo Quilez). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
