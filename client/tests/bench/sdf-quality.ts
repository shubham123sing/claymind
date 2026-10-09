/** Diagnostic: surface quality after typical strokes. npx vite-node tests/bench/sdf-quality.ts */
import { ChunkMesher } from '../../src/sculpt/marching-cubes';
import { SdfGrid } from '../../src/sculpt/sdf-grid';

function stats(g: SdfGrid, label: string) {
  g.markAllDirty();
  const chunks = new ChunkMesher(g).meshDirty();
  let tris = 0, bad = 0, sliver = 0;
  for (const c of chunks) {
    const p = c.positions, n = c.normals;
    for (let i = 0; i < p.length; i += 9) {
      tris++;
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const l = Math.hypot(fx, fy, fz);
      if (l < 1e-10) { sliver++; continue; }
      fx /= l; fy /= l; fz /= l;
      const nx = (n[i] + n[i + 3] + n[i + 6]) / 3, ny = (n[i + 1] + n[i + 4] + n[i + 7]) / 3, nz = (n[i + 2] + n[i + 5] + n[i + 8]) / 3;
      const nl = Math.hypot(nx, ny, nz) || 1;
      if ((fx * nx + fy * ny + fz * nz) / nl < 0.5) bad++;
    }
  }
  console.log(`${label.padEnd(28)} tris ${tris}  normals off by >60deg: ${(100 * bad / tris).toFixed(2)}%  degenerate ${sliver}`);
}

const fresh = () => { const g = new SdfGrid(48, 0.25); g.fillSphere(0, -0.06, 0, 0.055); return g; };
let g = fresh(); stats(g, 'sphere');
g = fresh(); for (let i = 0; i < 16; i++) g.brush('add', 0.03, -0.03 - i * 0.004, 0.045, 0.011, 0, -0.004, 0); stats(g, 'add capsule ridge');
g = fresh(); for (let i = 0; i < 16; i++) g.brush('carve', -0.03, -0.03 - i * 0.004, 0.05, 0.012, 0, -0.004, 0); stats(g, 'carve groove');
g = fresh(); for (let i = 0; i < 16; i++) g.brush('smooth', 0, -0.03 - i * 0.004, 0.055, 0.022); stats(g, 'smooth');
g = fresh(); for (let i = 0; i < 10; i++) g.brush('drag', 0.05 + i * 0.003, -0.06, 0, 0.02, 0.003, 0, 0); stats(g, 'drag pull');

// replay of a recorded in-app Add drag (app lump placement)
{
  const voxel = 0.25 / 47, r = 0.055;
  const g = new SdfGrid(48, 0.25);
  g.fillSphere(0, -0.125 + voxel + r - 0.012, 0, r);
  const rec: number[][] = [[0.0238,-0.0274,0.0041,0.011,0,0,0],[0.0238,-0.0274,0.0041,0.011,-0.0003,-0.0013,0.0088],[0.0235,-0.0287,0.0129,0.011,-0.0002,-0.0022,0.0066],[0.0232,-0.0309,0.0195,0.011,-0.0002,-0.0027,0.0055],[0.023,-0.0336,0.025,0.011,-0.0001,-0.003,0.0047],[0.0229,-0.0366,0.0297,0.011,-0.0001,-0.0033,0.0041],[0.0228,-0.0398,0.0338,0.011,-0.0001,-0.0036,0.0034],[0.0227,-0.0434,0.0372,0.011,-0.0001,-0.0037,0.0031],[0.0227,-0.0471,0.0403,0.011,0,-0.0039,0.0026],[0.0226,-0.051,0.0429,0.011,0,-0.0041,0.0023],[0.0226,-0.0552,0.0452,0.011,0,-0.0044,0.0018],[0.0227,-0.0596,0.047,0.011,0,-0.0046,0.0014],[0.0227,-0.0642,0.0484,0.011,0.0001,-0.0049,0.001]];
  for (const s of rec) g.brush('add', s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
  stats(g, 'recorded in-app add');
  // where is the lump surface vs the strokes?
  console.log('lump centre y', (-0.125 + voxel + r - 0.012).toFixed(4), 'lump top y', (-0.125 + voxel + 2 * r - 0.012).toFixed(4));
}

// incremental (dirty-only) meshing vs full re-mesh: any stale chunks?
{
  const g = new SdfGrid(48, 0.25);
  g.fillSphere(0, -0.06, 0, 0.055);
  const m = new ChunkMesher(g);
  const live = new Map<number, Float32Array>();
  const liveN = new Map<number, Float32Array>();
  const take = () => { for (const c of m.meshDirty()) { live.set(c.chunk, c.positions); liveN.set(c.chunk, c.normals); } };
  take();
  for (let i = 0; i < 20; i++) { g.brush('add', 0.03, -0.03 - i * 0.004, 0.045, 0.011, 0, -0.004, 0); take(); }
  for (let i = 0; i < 20; i++) { g.brush('carve', -0.03, -0.03 - i * 0.004, 0.05, 0.012, 0, -0.004, 0); take(); }
  for (let i = 0; i < 20; i++) { g.brush('smooth', 0, -0.03 - i * 0.004, 0.055, 0.022); take(); }
  for (let i = 0; i < 10; i++) { g.brush('drag', 0.05 + i * 0.003, -0.06, 0, 0.02, 0.003, 0, 0); take(); }
  g.markAllDirty();
  let stale = 0, staleN = 0, maxDev = 0;
  for (const c of m.meshDirty()) {
    const old = live.get(c.chunk) ?? new Float32Array(0);
    if (old.length !== c.positions.length || old.some((v, i) => v !== c.positions[i])) { stale++; continue; }
    const on = liveN.get(c.chunk)!;
    let dev = 0;
    for (let i = 0; i < on.length; i++) dev = Math.max(dev, Math.abs(on[i] - c.normals[i]));
    if (dev > 1e-6) { staleN++; maxDev = Math.max(maxDev, dev); }
  }
  console.log('stale chunks after incremental meshing:', stale, ' stale normals:', staleN, ' max normal deviation', maxDev.toFixed(3));
}
