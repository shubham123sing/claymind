/**
 * Shape descriptor: scale- and yaw-invariant features of a solid, computed
 * from an SdfGrid (solid = value < 0). The same function describes sculpts
 * and templates, so matching compares like with like. Pure (worker + tests).
 */
import { Sdf } from './csg.js';
import { SdfGrid } from '../sculpt/sdf-grid.js';

export interface ShapeDescriptor {
  /** height / major horizontal width */
  aspect: number;
  /** minor / major horizontal width (1 = round or square footprint) */
  elong: number;
  /** solid volume / bounding-box volume (in the principal frame) */
  fill: number;
  /** 1 - mean height of the surface over the inner footprint (1 = cup/bowl opening) */
  openTop: number;
  /** through-holes (first Betti number), clamped to 0..3 */
  holes: number;
  /** horizontal radius at 5 heights, bottom -> top, normalised by the max */
  profile: number[];
  /** Frame (not features): principal yaw (rad), bbox centre in grid-local metres, extents [major, height, minor] (m). */
  angle: number;
  center: [number, number, number];
  extents: [number, number, number];
  volume: number;
}

export function describe(g: SdfGrid): ShapeDescriptor | null {
  const { res, voxel, origin, data } = g;
  const solid = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < res && j < res && k < res && data[i + res * (j + res * k)] < 0;

  // centroid + XZ covariance
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++)
        if (data[i + res * (j + res * k)] < 0) {
          n++;
          sx += i; sy += j; sz += k;
        }
  if (n < 8) return null;
  const ci = sx / n, ck = sz / n;
  // footprint columns (unique i,k) and vertical extent
  const colSeen = new Uint8Array(res * res);
  const fu: number[] = [], fv: number[] = [];
  let jMin = res, jMax = -1;
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++)
        if (data[i + res * (j + res * k)] < 0) {
          if (j < jMin) jMin = j;
          if (j > jMax) jMax = j;
          if (!colSeen[i + res * k]) {
            colSeen[i + res * k] = 1;
            fu.push(i - ci);
            fv.push(k - ck);
          }
        }
  // yaw of the minimum-area footprint rectangle (robust for square footprints,
  // where principal axes are undefined); 2-degree steps over 90 degrees
  let angle = 0, bestArea = Infinity;
  let uMin = 0, uMax = 0, vMin = 0, vMax = 0;
  for (let step = 0; step < 45; step++) {
    const a = (step * Math.PI) / 90, c = Math.cos(a), sn = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let q = 0; q < fu.length; q++) {
      const u = fu[q] * c + fv[q] * sn, v = -fu[q] * sn + fv[q] * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0 + 1) * (v1 - v0 + 1);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      angle = a;
      uMin = u0; uMax = u1; vMin = v0; vMax = v1;
    }
  }
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let major = uMax - uMin + 1, minor = vMax - vMin + 1;
  const height = jMax - jMin + 1;
  // centre of the principal-frame box, back in grid index space
  const uc = (uMin + uMax) / 2, vc = (vMin + vMax) / 2;
  const cI = ci + uc * ca - vc * sa, cK = ck + uc * sa + vc * ca, cJ = (jMin + jMax) / 2;
  let swapped = false;
  if (minor > major) {
    [major, minor] = [minor, major];
    swapped = true;
  }

  // radial profile around the vertical axis through the box centre
  const profile = [0, 0, 0, 0, 0];
  for (let k = 0; k < res; k++)
    for (let j = jMin; j <= jMax; j++)
      for (let i = 0; i < res; i++)
        if (data[i + res * (j + res * k)] < 0) {
          const s = Math.min(4, Math.floor(((j - jMin) / height) * 5));
          const r = Math.hypot(i - cI, k - cK) + 0.5;
          if (r > profile[s]) profile[s] = r;
        }
  // very flat shapes cover fewer than 5 voxel rows: fill empty slices from neighbours
  for (let s = 1; s < 5; s++) if (profile[s] === 0) profile[s] = profile[s - 1];
  for (let s = 3; s >= 0; s--) if (profile[s] === 0) profile[s] = profile[s + 1];
  const pMax = Math.max(...profile) || 1;
  for (let s = 0; s < 5; s++) profile[s] /= pMax;

  // open top: surface height over the inner footprint
  const rIn = Math.max(1, 0.3 * (minor / 2));
  let cols = 0, topSum = 0;
  for (let k = 0; k < res; k++)
    for (let i = 0; i < res; i++) {
      if (Math.hypot(i - cI, k - cK) > rIn) continue;
      cols++;
      for (let j = jMax; j >= jMin; j--)
        if (data[i + res * (j + res * k)] < 0) {
          topSum += (j - jMin + 1) / height;
          break;
        }
    }
  const openTop = cols > 0 ? 1 - topSum / cols : 0;

  return {
    aspect: height / major,
    elong: minor / major,
    fill: n / (major * minor * height),
    openTop,
    holes: Math.min(3, Math.max(0, throughHoles(res, solid))),
    profile,
    angle: swapped ? angle + Math.PI / 2 : angle,
    center: [origin[0] + cI * voxel, origin[1] + cJ * voxel, origin[2] + cK * voxel],
    extents: [major * voxel, height * voxel, minor * voxel],
    volume: n * voxel ** 3,
  };
}

/**
 * First Betti number of the union of solid voxel cubes:
 * b1 = b0 + b2 - chi, with chi = V - E + F - C of the cubical complex.
 */
function throughHoles(res: number, s: (i: number, j: number, k: number) => boolean): number {
  let C = 0, F = 0, E = 0, V = 0;
  for (let k = 0; k <= res; k++)
    for (let j = 0; j <= res; j++)
      for (let i = 0; i <= res; i++) {
        if (i < res && j < res && k < res && s(i, j, k)) C++;
        // faces normal to x/y/z at lattice point
        if (j < res && k < res && (s(i - 1, j, k) || s(i, j, k))) F++;
        if (i < res && k < res && (s(i, j - 1, k) || s(i, j, k))) F++;
        if (i < res && j < res && (s(i, j, k - 1) || s(i, j, k))) F++;
        // edges along x/y/z
        if (i < res && (s(i, j - 1, k - 1) || s(i, j, k - 1) || s(i, j - 1, k) || s(i, j, k))) E++;
        if (j < res && (s(i - 1, j, k - 1) || s(i, j, k - 1) || s(i - 1, j, k) || s(i, j, k))) E++;
        if (k < res && (s(i - 1, j - 1, k) || s(i, j - 1, k) || s(i - 1, j, k) || s(i, j, k))) E++;
        // vertex
        if (
          s(i - 1, j - 1, k - 1) || s(i, j - 1, k - 1) || s(i - 1, j, k - 1) || s(i, j, k - 1) ||
          s(i - 1, j - 1, k) || s(i, j - 1, k) || s(i - 1, j, k) || s(i, j, k)
        )
          V++;
      }
  const chi = V - E + F - C;
  const b0 = components(res, s);
  const b2 = cavities(res, s);
  return b0 + b2 - chi;
}

/** Solid components with 26-connectivity (closed cubes touching at corners connect). */
function components(res: number, s: (i: number, j: number, k: number) => boolean): number {
  const seen = new Uint8Array(res * res * res);
  const stack: number[] = [];
  let count = 0;
  for (let idx = 0; idx < seen.length; idx++) {
    const i = idx % res, j = Math.floor(idx / res) % res, k = Math.floor(idx / (res * res));
    if (seen[idx] || !s(i, j, k)) continue;
    count++;
    seen[idx] = 1;
    stack.push(idx);
    while (stack.length) {
      const c = stack.pop()!;
      const ci = c % res, cj = Math.floor(c / res) % res, ck = Math.floor(c / (res * res));
      for (let dk = -1; dk <= 1; dk++)
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ni = ci + di, nj = cj + dj, nk = ck + dk;
            if (!s(ni, nj, nk)) continue;
            const nIdx = ni + res * (nj + res * nk);
            if (!seen[nIdx]) {
              seen[nIdx] = 1;
              stack.push(nIdx);
            }
          }
    }
  }
  return count;
}

const NEIGHBOURS_6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Enclosed empty regions (6-connected empty components not reachable from outside). */
function cavities(res: number, s: (i: number, j: number, k: number) => boolean): number {
  const p = res + 2; // pad so the outside is one connected region
  const empty = (i: number, j: number, k: number) => !s(i - 1, j - 1, k - 1);
  const seen = new Uint8Array(p * p * p);
  const stack: number[] = [];
  const flood = (start: number) => {
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      const ci = c % p, cj = Math.floor(c / p) % p, ck = Math.floor(c / (p * p));
      for (const [di, dj, dk] of NEIGHBOURS_6) {
        const ni = ci + di, nj = cj + dj, nk = ck + dk;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= p || nj >= p || nk >= p) continue;
        const nIdx = ni + p * (nj + p * nk);
        if (!seen[nIdx] && empty(ni, nj, nk)) {
          seen[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }
  };
  flood(0);
  let count = 0;
  for (let idx = 0; idx < seen.length; idx++) {
    const i = idx % p, j = Math.floor(idx / p) % p, k = Math.floor(idx / (p * p));
    if (!seen[idx] && empty(i, j, k)) {
      count++;
      flood(idx);
    }
  }
  return count;
}

/** Find the solid bounding box of an Sdf by coarse sampling of a cube (centre, edge). */
export function sdfBounds(sdf: Sdf, center: [number, number, number] = [0, 0.15, 0], edge = 0.45, res = 64) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const step = edge / (res - 1);
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const x = center[0] - edge / 2 + i * step, y = center[1] - edge / 2 + j * step, z = center[2] - edge / 2 + k * step;
        if (sdf(x, y, z) < 0) {
          min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
          max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
        }
      }
  return { min, max };
}

/**
 * Rasterise an Sdf into a new SdfGrid: the grid's local origin maps to
 * `center`, cube edge = `size`. Values clamp to the grid band like sculpts.
 * `xf` optionally maps grid-local points before evaluation (for scaling/rotation).
 */
export function rasterize(
  sdf: Sdf, res: number, size: number, center: [number, number, number],
  xf?: (x: number, y: number, z: number, out: number[]) => number,
): SdfGrid {
  const g = new SdfGrid(res, size);
  const { voxel, origin, band } = g;
  const p = [0, 0, 0];
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const boundary = i === 0 || j === 0 || k === 0 || i === res - 1 || j === res - 1 || k === res - 1;
        let d: number;
        if (boundary) d = band;
        else {
          const x = origin[0] + i * voxel, y = origin[1] + j * voxel, z = origin[2] + k * voxel;
          if (xf) {
            const scale = xf(x, y, z, p);
            d = sdf(p[0] + center[0], p[1] + center[1], p[2] + center[2]) * scale;
          } else d = sdf(x + center[0], y + center[1], z + center[2]);
        }
        g.data[i + res * (j + res * k)] = Math.max(-band, Math.min(band, d));
      }
  g.markAllDirty();
  return g;
}
