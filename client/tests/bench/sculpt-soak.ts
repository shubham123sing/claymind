/**
 * Soak test: 5 minutes of sculpting at 72 Hz through the SculptEngine (same
 * code the worker runs): one stroke per frame, gestures of ~1-2 s, random
 * undo/redo. Reports per-minute cost and checks for errors / slowdown.
 * Run: npx vite-node tests/bench/sculpt-soak.ts
 */
import { SculptEngine, Stroke } from '../../src/sculpt/sculpt-engine';
import type { BrushOp } from '../../src/sculpt/sdf-grid';

const FRAMES = 72 * 60 * 5;
const voxel = 0.25 / 47;
const e = new SculptEngine(48, 0.25, { x: 0, y: -0.125 + voxel + 0.055 - 0.012, z: 0, r: 0.055 });
e.update();
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ops: BrushOp[] = ['drag', 'add', 'carve', 'smooth'];
let action = 0, left = 0, op: BrushOp = 'add';
let px = 0, py = -0.07, pz = 0.05;
const perMinute: number[][] = [[]];
let maxMs = 0, undos = 0, redos = 0;
const t0 = performance.now();
for (let f = 0; f < FRAMES; f++) {
  const s = performance.now();
  if (left <= 0) {
    action++;
    left = 72 + Math.floor(rnd() * 72);
    op = ops[Math.floor(rnd() * ops.length)];
    const a = rnd() * Math.PI * 2;
    px = Math.cos(a) * 0.055; pz = Math.sin(a) * 0.055; py = -0.1 + rnd() * 0.07;
    if (rnd() < 0.15) { e.undo(); undos++; }
    if (rnd() < 0.05) { e.redo(); redos++; }
  }
  left--;
  const dx = (rnd() - 0.5) * 0.004, dy = (rnd() - 0.5) * 0.004, dz = (rnd() - 0.5) * 0.004;
  const st: Stroke = op === 'drag'
    ? { op, x: px, y: py, z: pz, r: 0.02, dx: px * 0.05, dy, dz: pz * 0.05 }
    : { op, x: px, y: py, z: pz, r: op === 'smooth' ? 0.022 : 0.011, dx, dy, dz };
  px += dx; py += dy; pz += dz;
  e.apply(action, [st]);
  const u = e.update();
  if (!(u.volume > 0) || !u.aabb) throw new Error(`clay vanished at frame ${f}`);
  const ms = performance.now() - s;
  maxMs = Math.max(maxMs, ms);
  perMinute[perMinute.length - 1].push(ms);
  if ((f + 1) % (72 * 60) === 0 && f + 1 < FRAMES) perMinute.push([]);
}
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
perMinute.forEach((m, i) => console.log(`minute ${i + 1}: p50 ${pct(m, 0.5).toFixed(2)} ms  p95 ${pct(m, 0.95).toFixed(2)} ms  p99 ${pct(m, 0.99).toFixed(2)} ms`));
const u = e.update();
console.log(`frames ${FRAMES}, actions ${action}, undos ${undos}, redos ${redos}, max ${maxMs.toFixed(1)} ms, wall ${((performance.now() - t0) / 1000).toFixed(1)} s, final volume ${(u.volume * 1e6).toFixed(0)} cm3, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
