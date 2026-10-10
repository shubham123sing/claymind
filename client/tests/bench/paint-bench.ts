/**
 * Plan v4, spike 6a-f: cost of painting stored in the sculpt data.
 * Option A: an RGB value per grid sample, copied to a per-vertex colour when a
 *   chunk is re-meshed (like the piece labels today).
 * Option B: a per-piece 64^3 RGBA 3D texture sampled in the shader (CPU cost =
 *   writing the brush region + re-uploading the texture).
 * Desktop numbers; Quest is roughly 3-4x slower (see PERF.md).
 * Run: npx vite-node tests/bench/paint-bench.ts
 */
import { SculptEngine } from '../../src/sculpt/sculpt-engine';

function time(fn: () => void, n = 20): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t0) / n;
}

for (const res of [48, 64]) {
  const e = new SculptEngine(res, 0.25, { x: 0, y: -0.03, z: 0, r: 0.055 });
  const g = e.grid;
  const rgb = new Uint8Array(g.data.length * 3).fill(200);
  let verts = 0;
  const remesh = time(() => {
    verts = 0;
    for (const c of e.remeshAll().chunks) verts += c.positions.length / 3;
  });
  // option A: nearest-sample colour per vertex for the whole surface (worst case: every chunk dirty)
  const chunks = e.remeshAll().chunks;
  const colourAll = time(() => {
    for (const c of chunks) {
      const out = new Uint8Array(c.positions.length);
      for (let v = 0; v < c.positions.length; v += 3) {
        const i = Math.round((c.positions[v] - g.origin[0]) / g.voxel), j = Math.round((c.positions[v + 1] - g.origin[1]) / g.voxel), k = Math.round((c.positions[v + 2] - g.origin[2]) / g.voxel);
        const s = (i + res * (j + res * k)) * 3;
        out[v] = rgb[s]; out[v + 1] = rgb[s + 1]; out[v + 2] = rgb[s + 2];
      }
    }
  });
  // a typical paint dab: 1 cm brush touches ~2-8 chunks; re-mesh + recolour those
  const dab = time(() => {
    g.markDirtyRange(20, 30, 20, 24, 34, 24);
    const cs = e.update().chunks;
    for (const c of cs) {
      const out = new Uint8Array(c.positions.length);
      for (let v = 0; v < c.positions.length; v += 3) out[v] = rgb[v % rgb.length];
    }
  }, 100);
  // option B: 64^3 RGBA texture: write a 1 cm brush sphere, then the whole texture is uploaded (~1 MB)
  const T = 64, tex = new Uint8Array(T * T * T * 4);
  const writeDab = time(() => {
    const r = Math.ceil((0.01 / 0.25) * T);
    for (let k = 30 - r; k <= 30 + r; k++) for (let j = 30 - r; j <= 30 + r; j++) for (let i = 30 - r; i <= 30 + r; i++) {
      if ((i - 30) ** 2 + (j - 30) ** 2 + (k - 30) ** 2 > r * r) continue;
      const s = (i + T * (j + T * k)) * 4;
      tex[s] = 255; tex[s + 1] = 64; tex[s + 2] = 32; tex[s + 3] = 255;
    }
  }, 200);
  console.info(`res ${res}: surface ${verts} vertices · full re-mesh ${remesh.toFixed(2)} ms · option A colour all vertices ${colourAll.toFixed(2)} ms, one dab (re-mesh dirty chunks + colour) ${dab.toFixed(2)} ms · option B write dab ${writeDab.toFixed(3)} ms + upload ${(tex.byteLength / 1e6).toFixed(1)} MB texture`);
}
