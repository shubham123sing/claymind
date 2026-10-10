/**
 * Bakes a creation: from an SDF in object-local metres (origin at the bbox
 * centre) produce the mesh, its volume and size, and its parts (plan v3: the
 * clay pieces, each a closed mesh that gets its own material) with
 * pre-fractured shards per part (part ∩ Voronoi cell) for breaking. Also builds
 * the object SDF for the two sources: the sculpt itself, or a template fitted
 * to the sculpt's footprint, size and orientation. Pure (worker + tests).
 */
import { PartCollider, partCollider } from './collider.js';
import { compile, Sdf } from './csg.js';
import { describe, rasterize, sdfBounds, ShapeDescriptor } from './descriptor.js';
import { ChunkMesher, meshVolume } from '../sculpt/marching-cubes.js';
import { SdfGrid } from '../sculpt/sdf-grid.js';
import type { TemplateDef } from './templates.js';

export interface BakedMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Paint per vertex, RGBA (alpha 0 = unpainted: the piece colour shows). */
  paint?: Uint8Array;
}

/** Paint of the sculpt at an object-local point, written as RGBA into `out` at `o`. */
export type PaintFn = (x: number, y: number, z: number, out: Uint8Array, o: number) => void;

export interface BakedPiece extends BakedMesh {
  /** Piece centre in object-local metres; piece vertices are relative to it. */
  center: [number, number, number];
}

/** One clay piece of the creation: a closed mesh (object-local) + its breakage shards. */
export interface BakedPart {
  /** Piece label from the sculpt (0..MAX_PIECES-1). */
  label: number;
  mesh: BakedMesh;
  /** m^3 */
  volume: number;
  shards: BakedPiece[];
  /** Physics shape: a hull, or boxes for hollow pieces (cups) so things fit inside. */
  collider: PartCollider;
}

export interface BakedObject {
  /** The whole surface (for shape analysis, snapshots and export). */
  mesh: BakedMesh;
  /** m^3 */
  volume: number;
  /** AABB size in object-local axes (m) */
  size: [number, number, number];
  /** At least one; several when the sculpt was made of pieces. */
  parts: BakedPart[];
}

function meshGrid(g: SdfGrid): BakedMesh {
  g.markAllDirty();
  const chunks = new ChunkMesher(g).meshDirty();
  let n = 0;
  for (const c of chunks) n += c.positions.length;
  const positions = new Float32Array(n), normals = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    positions.set(c.positions, o);
    normals.set(c.normals, o);
    o += c.positions.length;
  }
  return { positions, normals };
}

/** Deterministic PRNG so the same creation always fractures the same way. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param sdf     object SDF, object-local metres
 * @param extent  approximate object size (m), sets the grid cube
 */
export function bakeFromSdf(
  sdf: Sdf, extent: number,
  opts: { res?: number; pieces?: number; pieceRes?: number; seed?: number; label?: (x: number, y: number, z: number) => number; paint?: PaintFn } = {},
): BakedObject {
  const res = opts.res ?? 56;
  const edge = extent * 1.25 + 0.01;
  const g = rasterize(sdf, res, edge, [0, 0, 0]);
  const mesh = meshGrid(g);
  const volume = meshVolume(mesh.positions);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], mesh.positions[i + a]);
      max[a] = Math.max(max[a], mesh.positions[i + a]);
    }
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const shards = opts.pieces ?? 6, pieceRes = opts.pieceRes ?? 32, seed = opts.seed ?? 1;
  const labels = opts.label ? labelGrid(g, opts.label) : null;
  const present = labels ? presentLabels(g, labels) : [0];
  const painted = (m: BakedMesh, at: [number, number, number] = [0, 0, 0]): BakedMesh => (opts.paint ? { ...m, paint: paintOf(m.positions, opts.paint, at) } : m);
  if (present.length <= 1) {
    const sh = fracture(g, shards, pieceRes, seed).map((p) => ({ ...p, ...painted(p, p.center) }));
    return { mesh, volume, size, parts: [{ label: present[0] ?? 0, mesh: painted(mesh), volume, shards: sh, collider: partCollider(g, mesh.positions, volume) }] };
  }
  const parts: BakedPart[] = [];
  for (const label of present) {
    // the part: inside samples of other pieces count as outside, so each part is a closed mesh
    const pg = new SdfGrid(g.res, g.size);
    const out = g.voxel * 0.5;
    for (let i = 0; i < g.data.length; i++) pg.data[i] = g.data[i] < 0 && labels![i] !== label ? out : g.data[i];
    const m = meshGrid(pg);
    if (m.positions.length < 9 * 4) continue;
    const v = Math.abs(meshVolume(m.positions));
    const n = Math.max(2, Math.min(6, Math.round((shards * v) / volume) + 1));
    const sh = fracture(pg, n, pieceRes - 8, seed + label).map((p) => ({ ...p, ...painted(p, p.center) }));
    parts.push({ label, mesh: painted(m), volume: v, shards: sh, collider: partCollider(pg, m.positions, v) });
  }
  return { mesh, volume, size, parts };
}

/** Paint per vertex (positions relative to `at`). */
function paintOf(positions: Float32Array, fn: PaintFn, at: [number, number, number]): Uint8Array {
  const out = new Uint8Array((positions.length / 3) * 4);
  for (let v = 0; v < positions.length / 3; v++) fn(positions[v * 3] + at[0], positions[v * 3 + 1] + at[1], positions[v * 3 + 2] + at[2], out, v * 4);
  return out;
}

/** Piece label per sample (inside samples only; outside keep 0). */
function labelGrid(g: SdfGrid, label: (x: number, y: number, z: number) => number): Uint8Array {
  const out = new Uint8Array(g.data.length);
  const { res, voxel, origin } = g;
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const idx = g.index(i, j, k);
        if (g.data[idx] < 0) out[idx] = label(origin[0] + i * voxel, origin[1] + j * voxel, origin[2] + k * voxel);
      }
  return out;
}

function presentLabels(g: SdfGrid, labels: Uint8Array): number[] {
  const count = new Map<number, number>();
  for (let i = 0; i < g.data.length; i++) if (g.data[i] < 0) count.set(labels[i], (count.get(labels[i]) ?? 0) + 1);
  // ignore specks (< 1% of the solid) left by smoothing at piece borders
  const total = [...count.values()].reduce((a, b) => a + b, 0);
  return [...count.entries()].filter(([, n]) => n >= total * 0.01).map(([l]) => l).sort((a, b) => a - b);
}

/** Voronoi fracture: piece i = object ∩ cell(seed i). Seeds are spread over solid samples. */
export function fracture(g: SdfGrid, count: number, res: number, seed: number): BakedPiece[] {
  if (count < 2) return [];
  const rnd = mulberry(seed);
  const solid: number[] = [];
  for (let k = 1; k < g.res - 1; k++)
    for (let j = 1; j < g.res - 1; j++)
      for (let i = 1; i < g.res - 1; i++) if (g.data[i + g.res * (j + g.res * k)] < 0) solid.push(i, j, k);
  if (solid.length === 0) return [];
  // farthest-point sampling gives evenly sized pieces
  const seeds: number[][] = [];
  const pick = (q: number) => [g.origin[0] + solid[q * 3] * g.voxel, g.origin[1] + solid[q * 3 + 1] * g.voxel, g.origin[2] + solid[q * 3 + 2] * g.voxel];
  seeds.push(pick(Math.floor(rnd() * (solid.length / 3))));
  while (seeds.length < count) {
    let best = -1, bestD = -1;
    for (let t = 0; t < 64; t++) {
      const q = Math.floor(rnd() * (solid.length / 3));
      const p = pick(q);
      let d = Infinity;
      for (const s of seeds) d = Math.min(d, Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]));
      if (d > bestD) {
        bestD = d;
        best = q;
      }
    }
    seeds.push(pick(best));
  }
  const pieces: BakedPiece[] = [];
  for (let s = 0; s < seeds.length; s++) {
    const si = seeds[s];
    const cell: Sdf = (x, y, z) => {
      // signed distance to the Voronoi cell of seed s (negative inside)
      let d = -Infinity;
      for (let o = 0; o < seeds.length; o++) {
        if (o === s) continue;
        const sj = seeds[o];
        const nx = sj[0] - si[0], ny = sj[1] - si[1], nz = sj[2] - si[2];
        const len = Math.hypot(nx, ny, nz);
        const mx = (si[0] + sj[0]) / 2, my = (si[1] + sj[1]) / 2, mz = (si[2] + sj[2]) / 2;
        d = Math.max(d, ((x - mx) * nx + (y - my) * ny + (z - mz) * nz) / len);
      }
      return d;
    };
    const pg = rasterize((x, y, z) => Math.max(g.sample(x, y, z), cell(x, y, z)), res, g.size, [0, 0, 0]);
    const m = meshGrid(pg);
    if (m.positions.length < 9 * 4) continue;
    let cx = 0, cy = 0, cz = 0;
    const nv = m.positions.length / 3;
    for (let i = 0; i < m.positions.length; i += 3) {
      cx += m.positions[i]; cy += m.positions[i + 1]; cz += m.positions[i + 2];
    }
    cx /= nv; cy /= nv; cz /= nv;
    for (let i = 0; i < m.positions.length; i += 3) {
      m.positions[i] -= cx; m.positions[i + 1] -= cy; m.positions[i + 2] -= cz;
    }
    pieces.push({ ...m, center: [cx, cy, cz] });
  }
  return pieces;
}

/** SDF of the sculpt itself in object-local metres (world scale), centred at `center` (grid-local). */
export function sculptSdf(grid: SdfGrid, center: [number, number, number], scale: number): Sdf {
  return (x, y, z) => grid.sample(center[0] + x / scale, center[1] + y / scale, center[2] + z / scale) * scale;
}

/** Paint of the sculpt at an object-local point (nearest inside sample). */
export function sculptPaint(grid: SdfGrid, center: [number, number, number], scale: number): PaintFn {
  return (x, y, z, out, o) => grid.nearestInsidePaint(center[0] + x / scale, center[1] + y / scale, center[2] + z / scale, grid.voxel * 2, out, o);
}

/** Piece label of the sculpt at an object-local point (nearest inside sample). */
export function sculptLabel(grid: SdfGrid, center: [number, number, number], scale: number): (x: number, y: number, z: number) => number {
  return (x, y, z) => grid.nearestInsideLabel(center[0] + x / scale, center[1] + y / scale, center[2] + z / scale, grid.voxel * 1.5);
}

/** Template descriptor + frame, computed the same way as for sculpts (res 40). */
export function describeTemplate(t: TemplateDef): { descriptor: ShapeDescriptor; sdf: Sdf } {
  const sdf = compile(t.sdf);
  const b = sdfBounds(sdf);
  const c: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const edge = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 1.3;
  const d = describe(rasterize(sdf, 40, edge, c))!;
  // describe() reports the centre in grid-local coords; shift into template coords
  d.center = [d.center[0] + c[0], d.center[1] + c[1], d.center[2] + c[2]];
  return { descriptor: d, sdf };
}

/**
 * Fit a template to a sculpt: align principal axes, scale per axis (blended
 * 50/50 with uniform scale so real objects keep their proportions), and pick
 * the axis flips that overlap the sculpt best (e.g. which side the handle is on).
 * Returns an SDF in object-local metres (world scale) centred on the sculpt bbox.
 */
export function fitTemplate(
  tmpl: { descriptor: ShapeDescriptor; sdf: Sdf },
  sculpt: ShapeDescriptor,
  sculptShape: Sdf,
  scale: number,
): Sdf {
  const t = tmpl.descriptor;
  const se = sculpt.extents.map((e) => e * scale);
  const raw = [se[0] / t.extents[0], se[1] / t.extents[1], se[2] / t.extents[2]];
  const uni = Math.cbrt(raw[0] * raw[1] * raw[2]);
  const [su, sy, sv] = raw.map((r) => Math.sqrt(r * uni));
  const minS = Math.min(su, sy, sv);
  const cs = Math.cos(sculpt.angle), ss = Math.sin(sculpt.angle);
  const ct = Math.cos(t.angle), st = Math.sin(t.angle);
  const make = (fu: number, fv: number): Sdf => (x, y, z) => {
    const u = ((x * cs + z * ss) / su) * fu, v = ((-x * ss + z * cs) / sv) * fv;
    const tx = u * ct - v * st + t.center[0], tz = u * st + v * ct + t.center[2];
    return tmpl.sdf(tx, y / sy + t.center[1], tz) * minS;
  };
  // choose flips by overlap with the sculpt (coarse 20³ samples)
  let best = make(1, 1), bestScore = -Infinity;
  const half = Math.max(...se) * 0.6;
  for (const [fu, fv] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const f = make(fu, fv);
    let score = 0;
    for (let k = 0; k < 20; k++)
      for (let j = 0; j < 20; j++)
        for (let i = 0; i < 20; i++) {
          const x = -half + (i / 19) * 2 * half, y = -half + (j / 19) * 2 * half, z = -half + (k / 19) * 2 * half;
          const a = f(x, y, z) < 0, b = sculptShape(x, y, z) < 0;
          if (a && b) score++;
          else if (a !== b) score -= 0.5;
        }
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}
