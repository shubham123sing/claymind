/**
 * Signed-distance grid for clay sculpting. Negative = inside clay.
 * Values are clamped to a narrow band so brushes stay local and cheap.
 * Boundary samples are always "outside" so the surface is always closed.
 * Coordinates are grid-local metres; the grid cube is centred on the origin.
 * Each sample also carries a piece label (an object is made of pieces, each
 * with its own material) and paint (RGBA; alpha 0 = unpainted, the piece colour
 * shows). Both are meaningful where the sample is inside, and move with the clay.
 * Pure data + math: runs in a Web Worker and in unit tests.
 */
export const CHUNK_CELLS = 8;
/** Pieces per creation (labels 0..MAX_PIECES-1). */
export const MAX_PIECES = 4;

export type BrushOp = 'add' | 'carve' | 'smooth' | 'drag' | 'paint' | 'erase';

export class SdfGrid {
  /** Samples per axis. Cells per axis = res - 1. */
  readonly res: number;
  /** Edge length of the grid cube in metres. */
  readonly size: number;
  readonly voxel: number;
  readonly band: number;
  readonly data: Float32Array;
  /** Piece label per sample (see MAX_PIECES). */
  readonly labels: Uint8Array;
  /** Paint per sample, RGBA (alpha 0 = unpainted). */
  readonly paint: Uint8Array;
  readonly chunksPerAxis: number;
  readonly dirty: Uint8Array;
  /** Grid-local min corner (metres). */
  readonly origin: [number, number, number];
  private scratch: Float32Array | null = null;
  private labelScratch: Uint8Array | null = null;
  private paintScratch: Uint8Array | null = null;

  constructor(res = 48, size = 0.25) {
    this.res = res;
    this.size = size;
    this.voxel = size / (res - 1);
    this.band = this.voxel * 3;
    this.origin = [-size / 2, -size / 2, -size / 2];
    this.data = new Float32Array(res * res * res).fill(this.band);
    this.labels = new Uint8Array(res * res * res);
    this.paint = new Uint8Array(res * res * res * 4);
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

  /** Mark chunks wherever `data` or labels differ from the previous state (used after undo/redo rebuilds). */
  markChangedSince(previous: Float32Array, previousLabels?: Uint8Array, previousPaint?: Uint8Array): number {
    const r = this.res;
    let changed = 0;
    for (let k = 0; k < r; k++)
      for (let j = 0; j < r; j++) {
        const row = r * (j + r * k);
        for (let i = 0; i < r; i++) {
          const s = row + i;
          if (this.data[s] !== previous[s] || (previousLabels && this.labels[s] !== previousLabels[s]) ||
            (previousPaint && (this.paint[s * 4 + 3] !== previousPaint[s * 4 + 3] || this.paint[s * 4] !== previousPaint[s * 4] || this.paint[s * 4 + 1] !== previousPaint[s * 4 + 1] || this.paint[s * 4 + 2] !== previousPaint[s * 4 + 2]))) {
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
    this.labels.fill(0);
    this.paint.fill(0);
    this.markAllDirty();
  }

  /** Index of the sample nearest to (x, y, z) (grid-local metres). */
  nearestIndex(x: number, y: number, z: number): number {
    const { res, voxel, origin } = this;
    const i = Math.max(0, Math.min(res - 1, Math.round((x - origin[0]) / voxel)));
    const j = Math.max(0, Math.min(res - 1, Math.round((y - origin[1]) / voxel)));
    const k = Math.max(0, Math.min(res - 1, Math.round((z - origin[2]) / voxel)));
    return this.index(i, j, k);
  }

  /** Label of the sample nearest to (x, y, z) in `src` labels (grid-local metres). */
  labelAt(x: number, y: number, z: number, src: Uint8Array = this.labels): number {
    const { res, voxel, origin } = this;
    const i = Math.max(0, Math.min(res - 1, Math.round((x - origin[0]) / voxel)));
    const j = Math.max(0, Math.min(res - 1, Math.round((y - origin[1]) / voxel)));
    const k = Math.max(0, Math.min(res - 1, Math.round((z - origin[2]) / voxel)));
    return src[this.index(i, j, k)];
  }

  /** Label of the inside sample closest to (x, y, z) within `reach` m, or 0 if none. */
  nearestInsideLabel(x: number, y: number, z: number, reach: number): number {
    const { res, voxel, origin, data, labels } = this;
    const i0 = Math.max(0, Math.floor((x - reach - origin[0]) / voxel)), i1 = Math.min(res - 1, Math.ceil((x + reach - origin[0]) / voxel));
    const j0 = Math.max(0, Math.floor((y - reach - origin[1]) / voxel)), j1 = Math.min(res - 1, Math.ceil((y + reach - origin[1]) / voxel));
    const k0 = Math.max(0, Math.floor((z - reach - origin[2]) / voxel)), k1 = Math.min(res - 1, Math.ceil((z + reach - origin[2]) / voxel));
    let best = Infinity, label = 0;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const idx = this.index(i, j, k);
          if (data[idx] >= 0) continue;
          const d = (origin[0] + i * voxel - x) ** 2 + (origin[1] + j * voxel - y) ** 2 + (origin[2] + k * voxel - z) ** 2;
          if (d < best) (best = d), (label = labels[idx]);
        }
    return label;
  }

  /** Paint (RGBA) of the inside sample closest to (x, y, z) within `reach` m; alpha 0 if none. */
  nearestInsidePaint(x: number, y: number, z: number, reach: number, out: Uint8Array | number[], o = 0): void {
    const { res, voxel, origin, data, paint } = this;
    const i0 = Math.max(0, Math.floor((x - reach - origin[0]) / voxel)), i1 = Math.min(res - 1, Math.ceil((x + reach - origin[0]) / voxel));
    const j0 = Math.max(0, Math.floor((y - reach - origin[1]) / voxel)), j1 = Math.min(res - 1, Math.ceil((y + reach - origin[1]) / voxel));
    const k0 = Math.max(0, Math.floor((z - reach - origin[2]) / voxel)), k1 = Math.min(res - 1, Math.ceil((z + reach - origin[2]) / voxel));
    let best = Infinity, at = -1;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const idx = this.index(i, j, k);
          if (data[idx] >= 0) continue;
          const d = (origin[0] + i * voxel - x) ** 2 + (origin[1] + j * voxel - y) ** 2 + (origin[2] + k * voxel - z) ** 2;
          if (d < best) (best = d), (at = idx);
        }
    for (let c = 0; c < 4; c++) out[o + c] = at < 0 ? 0 : paint[at * 4 + c];
  }

  /**
   * Paint (or erase) the clay surface inside a sphere / capsule: samples just
   * inside the surface take the colour. Shape is untouched. Returns samples changed.
   */
  paintBrush(cx: number, cy: number, cz: number, radius: number, rgb: number | null, dx = 0, dy = 0, dz = 0): number {
    const { res, voxel, origin, data, paint } = this;
    const r8 = rgb === null ? 0 : (rgb >> 16) & 255, g8 = rgb === null ? 0 : (rgb >> 8) & 255, b8 = rgb === null ? 0 : rgb & 255, a8 = rgb === null ? 0 : 255;
    const seg2 = dx * dx + dy * dy + dz * dz;
    const i0 = Math.max(1, Math.floor((Math.min(cx, cx + dx) - radius - origin[0]) / voxel)), i1 = Math.min(res - 2, Math.ceil((Math.max(cx, cx + dx) + radius - origin[0]) / voxel));
    const j0 = Math.max(1, Math.floor((Math.min(cy, cy + dy) - radius - origin[1]) / voxel)), j1 = Math.min(res - 2, Math.ceil((Math.max(cy, cy + dy) + radius - origin[1]) / voxel));
    const k0 = Math.max(1, Math.floor((Math.min(cz, cz + dz) - radius - origin[2]) / voxel)), k1 = Math.min(res - 2, Math.ceil((Math.max(cz, cz + dz) + radius - origin[2]) / voxel));
    let touched = 0;
    let mi0 = res, mj0 = res, mk0 = res, mi1 = -1, mj1 = -1, mk1 = -1;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          let x = origin[0] + i * voxel - cx, y = origin[1] + j * voxel - cy, z = origin[2] + k * voxel - cz;
          if (seg2 > 0) {
            const t = Math.max(0, Math.min(1, (x * dx + y * dy + z * dz) / seg2));
            x -= dx * t; y -= dy * t; z -= dz * t;
          }
          if (x * x + y * y + z * z > radius * radius) continue;
          const idx = this.index(i, j, k);
          // only the skin matters: vertex colours come from the inside sample of each surface edge
          if (data[idx] >= 0 || data[idx] < -2 * voxel) continue;
          const p = idx * 4;
          if (paint[p] === r8 && paint[p + 1] === g8 && paint[p + 2] === b8 && paint[p + 3] === a8) continue;
          paint[p] = r8; paint[p + 1] = g8; paint[p + 2] = b8; paint[p + 3] = a8;
          touched++;
          if (i < mi0) mi0 = i; if (i > mi1) mi1 = i;
          if (j < mj0) mj0 = j; if (j > mj1) mj1 = j;
          if (k < mk0) mk0 = k; if (k > mk1) mk1 = k;
        }
    if (touched > 0) this.markDirtyRange(mi0, mj0, mk0, mi1, mj1, mk1);
    return touched;
  }

  /** Which piece labels have clay (bit i set = piece i exists). */
  piecesMask(): number {
    let mask = 0;
    const { data, labels } = this;
    for (let i = 0; i < data.length; i++) if (data[i] < 0) mask |= 1 << labels[i];
    return mask;
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
   * Pieces: add extends the piece it touches; with `piece` it lays down clay of
   * that piece (a new piece's first lump). Newly filled samples elsewhere take
   * a neighbour's label; drag carries labels along with the clay.
   */
  brush(op: BrushOp, cx: number, cy: number, cz: number, radius: number, dx = 0, dy = 0, dz = 0, piece?: number): number {
    if (op === 'drag') {
      const len = Math.hypot(dx, dy, dz);
      const steps = Math.max(1, Math.ceil(len / (radius * 0.2)));
      let n = 0;
      for (let s = 0; s < steps; s++) {
        n += this.dragStep(cx + (dx * s) / steps, cy + (dy * s) / steps, cz + (dz * s) / steps, radius, dx / steps, dy / steps, dz / steps);
      }
      return n;
    }
    const { res, voxel, band, origin, data, labels } = this;
    const reach = radius + band;
    // the piece this add stroke belongs to: given, or the piece touched at the brush centre
    const target = op !== 'add' ? 0 : piece ?? this.nearestInsideLabel(cx, cy, cz, radius + voxel * 2);
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
          // smooth subtraction max(v, -d) (was max(v, d): only shaved a shell outside the brush)
          else if (op === 'carve') nv = -smin(-v, d, blend);
          else {
            const avg = (data[idx - 1] + data[idx + 1] + data[idx - sy] + data[idx + sy] + data[idx - sz] + data[idx + sz]) / 6;
            const falloff = Math.max(0, 1 - dist / radius);
            nv = v + (avg - v) * 0.5 * falloff;
          }
          nv = Math.max(-band, Math.min(band, nv));
          let relabelled = false;
          if (op === 'add' && nv < 0 && (v >= 0 || (piece !== undefined && dist <= radius)) && labels[idx] !== target) {
            labels[idx] = target;
            relabelled = true;
          } else if (op === 'smooth' && nv < 0 && v >= 0) {
            labels[idx] = this.insideNeighbourLabel(idx);
          }
          // new clay comes unpainted; clay smoothed into place takes its neighbour's paint
          if (nv < 0 && v >= 0) {
            if (op === 'smooth') this.copyNeighbourPaint(idx);
            else this.paint[idx * 4 + 3] = 0;
          }
          if (nv !== v || relabelled) {
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

  private copyNeighbourPaint(idx: number): void {
    const { data, paint, res } = this;
    for (const o of [1, -1, res, -res, res * res, -res * res]) {
      if (data[idx + o] < 0) {
        paint.copyWithin(idx * 4, (idx + o) * 4, (idx + o) * 4 + 4);
        return;
      }
    }
  }

  private insideNeighbourLabel(idx: number): number {
    const { data, labels, res } = this;
    for (const o of [1, -1, res, -res, res * res, -res * res]) if (data[idx + o] < 0) return labels[idx + o];
    return labels[idx];
  }

  private dragStep(cx: number, cy: number, cz: number, radius: number, dx: number, dy: number, dz: number): number {
    const { res, voxel, band, origin, data, labels } = this;
    if (!this.scratch || this.scratch.length !== data.length) this.scratch = new Float32Array(data.length);
    if (!this.labelScratch || this.labelScratch.length !== data.length) this.labelScratch = new Uint8Array(data.length);
    if (!this.paintScratch || this.paintScratch.length !== data.length * 4) this.paintScratch = new Uint8Array(data.length * 4);
    const src = this.scratch, srcLabels = this.labelScratch, srcPaint = this.paintScratch;
    const tx = cx + dx, ty = cy + dy, tz = cz + dz;
    // copy only the z-slab the samples can read from (contiguous memory)
    const reachK = (radius + Math.hypot(dx, dy, dz)) / voxel + 2;
    const sk0 = Math.max(0, Math.floor((tz - origin[2]) / voxel - reachK));
    const sk1 = Math.min(res - 1, Math.ceil((tz - origin[2]) / voxel + reachK));
    src.set(data.subarray(sk0 * res * res, (sk1 + 1) * res * res), sk0 * res * res);
    srcLabels.set(labels.subarray(sk0 * res * res, (sk1 + 1) * res * res), sk0 * res * res);
    srcPaint.set(this.paint.subarray(sk0 * res * res * 4, (sk1 + 1) * res * res * 4), sk0 * res * res * 4);
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
          const sx = x - dx * w, sy = y - dy * w, sz = z - dz * w;
          const nv = Math.max(-band, Math.min(band, this.sample(sx, sy, sz, src)));
          const nl = nv < 0 ? this.labelAt(sx, sy, sz, srcLabels) : labels[idx];
          // paint moves with the clay it is on
          let repainted = false;
          if (nv < 0) {
            const from = this.nearestIndex(sx, sy, sz) * 4, to = idx * 4, pt = this.paint;
            if (pt[to] !== srcPaint[from] || pt[to + 1] !== srcPaint[from + 1] || pt[to + 2] !== srcPaint[from + 2] || pt[to + 3] !== srcPaint[from + 3]) {
              pt[to] = srcPaint[from]; pt[to + 1] = srcPaint[from + 1]; pt[to + 2] = srcPaint[from + 2]; pt[to + 3] = srcPaint[from + 3];
              repainted = true;
            }
          }
          if (nv !== data[idx] || nl !== labels[idx] || repainted) {
            labels[idx] = nl;
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
          const x = origin[0] + i * voxel, y = origin[1] + j * voxel, z = origin[2] + k * voxel, idx = this.index(i, j, k);
          this.labels[idx] = other.labelAt(x, y, z);
          this.paint.set(other.paint.subarray(other.nearestIndex(x, y, z) * 4, other.nearestIndex(x, y, z) * 4 + 4), idx * 4);
        }
    this.markAllDirty();
  }
}

/** Polynomial smooth minimum (Inigo Quilez). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
