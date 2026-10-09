/**
 * Headless SDF benchmark: same code path as the sculpt worker.
 * Run: npx vite-node tests/bench/sdf-bench.ts [res]
 */
import { ChunkMesher } from '../../src/sculpt/marching-cubes';
import { BrushOp, SdfGrid } from '../../src/sculpt/sdf-grid';

const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
for (const res of process.argv[2] ? [Number(process.argv[2])] : [48, 64]) {
  const g = new SdfGrid(res, 0.25);
  const m = new ChunkMesher(g);
  let t0 = performance.now();
  g.fillSphere(0, 0, 0, 0.06);
  let tris = 0;
  for (const c of m.meshDirty()) tris += c.positions.length / 9;
  const initMs = performance.now() - t0;
  const brush: number[] = [], mesh: number[] = [], chunks: number[] = [];
  const ops: BrushOp[] = ['add', 'drag', 'carve', 'smooth'];
  let t = 0;
  for (let i = 0; i < 400; i++) {
    t += 0.05;
    t0 = performance.now();
    const op = ops[Math.floor(t / 3) % 4];
    const x = Math.cos(t) * 0.065, y = Math.sin(t * 0.7) * 0.04, z = Math.sin(t) * 0.065;
    // drag: pull outward ~4 mm per frame with a 2 cm brush, like a pinch-pull
    if (op === 'drag') g.brush(op, x, y, z, 0.02, Math.cos(t) * 0.004, 0, Math.sin(t) * 0.004);
    else g.brush(op, x, y, z, 0.014);
    brush.push(performance.now() - t0);
    t0 = performance.now();
    chunks.push(m.meshDirty().length);
    mesh.push(performance.now() - t0);
  }
  g.markAllDirty();
  tris = 0;
  for (const c of m.meshDirty()) tris += c.positions.length / 9;
  const total = brush.map((b, i) => b + mesh[i]);
  console.log(
    `res ${res}: voxel ${(250 / (res - 1)).toFixed(1)}mm init ${initMs.toFixed(1)}ms tris ${tris} | per stroke: ` +
      `brush p50 ${pct(brush, 0.5).toFixed(2)} p95 ${pct(brush, 0.95).toFixed(2)} | mesh p50 ${pct(mesh, 0.5).toFixed(2)} ` +
      `p95 ${pct(mesh, 0.95).toFixed(2)} (${pct(chunks, 0.5)} chunks) | total p95 ${pct(total, 0.95).toFixed(2)} ms`,
  );
}
