/**
 * Collider for one piece (plan v4, section 5): a convex hull for solid-ish
 * pieces, or a compound of at most MAX_BOXES boxes merged from the piece's
 * voxels for hollow pieces (cups, bowls), so things can go inside. Pure (worker + tests).
 */
import { convexHull2d } from '../physics/physical-properties.js';
import type { SdfGrid } from '../sculpt/sdf-grid.js';

export const MAX_BOXES = 40;
/** Below this, volume / (hull-ish volume) means "hollow": use boxes. */
const HOLLOW_FILL = 0.75;
const MAX_HULL_POINTS = 256;

export type PartCollider =
  | { kind: 'hull'; points: Float32Array; volume: number }
  /** boxes: centre xyz + full size xyz per box (object-local) */
  | { kind: 'boxes'; boxes: Float32Array; volume: number };

/**
 * @param g          the piece's grid (inside < 0), object-local metres
 * @param positions  the piece's closed mesh
 * @param volume     the piece's true volume (m³)
 */
export function partCollider(g: SdfGrid, positions: Float32Array, volume: number): PartCollider {
  const fill = volume / Math.max(volume, envelopeVolume(g));
  if (fill < HOLLOW_FILL) {
    const boxes = voxelBoxes(g);
    if (boxes) return { kind: 'boxes', boxes, volume: boxesVolume(boxes) };
  }
  const n = positions.length / 3;
  const stride = Math.max(1, Math.floor(n / MAX_HULL_POINTS));
  const pts: number[] = [];
  for (let i = 0; i < n; i += stride) pts.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  return { kind: 'hull', points: new Float32Array(pts), volume: envelopeVolume(g) };
}

/**
 * A cheap stand-in for the convex hull volume: stack the 2D convex hulls of the
 * solid samples slice by slice along each axis and take the smallest of the
 * three stacks (each stack over-estimates a round piece seen side-on; a cup's
 * hole fills in from every direction, so it still reads as hollow).
 */
export function envelopeVolume(g: SdfGrid): number {
  const { res, voxel, data } = g;
  let best = Infinity;
  for (const axis of [0, 1, 2]) {
    let v = 0;
    for (let s = 0; s < res; s++) {
      const pts: [number, number][] = [];
      for (let a = 0; a < res; a++)
        for (let b = 0; b < res; b++) {
          const ijk = axis === 0 ? [s, a, b] : axis === 1 ? [a, s, b] : [a, b, s];
          if (data[g.index(ijk[0], ijk[1], ijk[2])] < 0) pts.push([a, b]);
        }
      if (pts.length === 0) continue;
      // each sample stands for a voxel: grow the hull by half a cell
      const grown: [number, number][] = [];
      for (const [a, b] of pts) grown.push([a - 0.5, b - 0.5], [a + 0.5, b - 0.5], [a - 0.5, b + 0.5], [a + 0.5, b + 0.5]);
      const h = convexHull2d(grown);
      let area = 0;
      for (let i = 0; i < h.length; i++) {
        const p = h[i], q = h[(i + 1) % h.length];
        area += p[0] * q[1] - q[0] * p[1];
      }
      v += (Math.abs(area) / 2) * voxel ** 3;
    }
    best = Math.min(best, v);
  }
  return Number.isFinite(best) ? best : 0;
}

/** Greedy merge of solid cells into boxes, coarsening until at most MAX_BOXES. Null if none fit. */
export function voxelBoxes(g: SdfGrid): Float32Array | null {
  for (const cells of [24, 18, 14, 11, 8]) {
    const solid = occupancy(g, cells);
    const boxes = greedy(solid.occ, cells);
    if (boxes.length / 6 <= MAX_BOXES && boxes.length > 0) {
      const out = new Float32Array(boxes.length);
      for (let i = 0; i < boxes.length; i += 6) {
        out[i] = solid.origin[0] + (boxes[i] + boxes[i + 3] / 2) * solid.cell;
        out[i + 1] = solid.origin[1] + (boxes[i + 1] + boxes[i + 4] / 2) * solid.cell;
        out[i + 2] = solid.origin[2] + (boxes[i + 2] + boxes[i + 5] / 2) * solid.cell;
        out[i + 3] = boxes[i + 3] * solid.cell;
        out[i + 4] = boxes[i + 4] * solid.cell;
        out[i + 5] = boxes[i + 5] * solid.cell;
      }
      return out;
    }
  }
  return null;
}

/** Cells over the solid's bounding box; a cell is solid when >= 35% of its samples are inside (keeps thin walls). */
function occupancy(g: SdfGrid, cells: number): { occ: Uint8Array; cell: number; origin: [number, number, number] } {
  const { res, voxel, origin, data } = g;
  let i0 = res, j0 = res, k0 = res, i1 = -1, j1 = -1, k1 = -1;
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++)
        if (data[g.index(i, j, k)] < 0) {
          if (i < i0) i0 = i; if (i > i1) i1 = i;
          if (j < j0) j0 = j; if (j > j1) j1 = j;
          if (k < k0) k0 = k; if (k > k1) k1 = k;
        }
  const span = Math.max(i1 - i0, j1 - j0, k1 - k0) + 1;
  const per = span / cells; // samples per cell
  const cell = per * voxel;
  const o: [number, number, number] = [origin[0] + (i0 - 0.5) * voxel, origin[1] + (j0 - 0.5) * voxel, origin[2] + (k0 - 0.5) * voxel];
  const count = new Float32Array(cells ** 3), inside = new Float32Array(cells ** 3);
  for (let k = k0; k <= k1; k++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = Math.min(cells - 1, Math.floor((i - i0) / per)) + cells * (Math.min(cells - 1, Math.floor((j - j0) / per)) + cells * Math.min(cells - 1, Math.floor((k - k0) / per)));
        count[c]++;
        if (data[g.index(i, j, k)] < 0) inside[c]++;
      }
  const occ = new Uint8Array(cells ** 3);
  for (let c = 0; c < occ.length; c++) occ[c] = count[c] > 0 && inside[c] / count[c] >= 0.35 ? 1 : 0;
  return { occ, cell, origin: o };
}

/** Grow boxes along x, then y, then z over unvisited solid cells. Returns [i, j, k, sx, sy, sz]... in cells. */
function greedy(occ: Uint8Array, n: number): number[] {
  const used = new Uint8Array(occ.length);
  const at = (i: number, j: number, k: number) => i + n * (j + n * k);
  const free = (i: number, j: number, k: number) => occ[at(i, j, k)] === 1 && used[at(i, j, k)] === 0;
  const out: number[] = [];
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        if (!free(i, j, k)) continue;
        let sx = 1;
        while (i + sx < n && free(i + sx, j, k)) sx++;
        let sy = 1;
        grow: while (j + sy < n) {
          for (let a = 0; a < sx; a++) if (!free(i + a, j + sy, k)) break grow;
          sy++;
        }
        let sz = 1;
        growZ: while (k + sz < n) {
          for (let b = 0; b < sy; b++) for (let a = 0; a < sx; a++) if (!free(i + a, j + b, k + sz)) break growZ;
          sz++;
        }
        for (let c = 0; c < sz; c++) for (let b = 0; b < sy; b++) for (let a = 0; a < sx; a++) used[at(i + a, j + b, k + c)] = 1;
        out.push(i, j, k, sx, sy, sz);
      }
  return out;
}

function boxesVolume(b: Float32Array): number {
  let v = 0;
  for (let i = 0; i < b.length; i += 6) v += b[i + 3] * b[i + 4] * b[i + 5];
  return v;
}
