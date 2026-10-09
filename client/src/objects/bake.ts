/**
 * Bakes a creation: from an SDF in object-local metres (origin at the bbox
 * centre) produce the render/physics mesh, its volume and size, plus N
 * pre-fractured pieces (object ∩ Voronoi cell) for breaking. Also builds the
 * object SDF for the two sources: the sculpt itself, or a template fitted to
 * the sculpt's footprint, size and orientation. Pure (worker + tests).
 */
import { compile, Sdf } from './csg.js';
import { describe, rasterize, sdfBounds, ShapeDescriptor } from './descriptor.js';
import { ChunkMesher, meshVolume } from '../sculpt/marching-cubes.js';
import { SdfGrid } from '../sculpt/sdf-grid.js';
import type { TemplateDef } from './templates.js';

export interface BakedMesh {
  positions: Float32Array;
  normals: Float32Array;
}

export interface BakedPiece extends BakedMesh {
  /** Piece centre in object-local metres; piece vertices are relative to it. */
  center: [number, number, number];
}

export interface BakedObject {
  mesh: BakedMesh;
  /** m^3 */
  volume: number;
  /** AABB size in object-local axes (m) */
  size: [number, number, number];
  pieces: BakedPiece[];
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
export function bakeFromSdf(sdf: Sdf, extent: number, opts: { res?: number; pieces?: number; pieceRes?: number; seed?: number } = {}): BakedObject {
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
  return { mesh, volume, size, pieces: fracture(g, opts.pieces ?? 6, opts.pieceRes ?? 32, opts.seed ?? 1) };
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
