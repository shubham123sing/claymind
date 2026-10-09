/// <reference lib="webworker" />
/**
 * Sculpt worker: owns the SDF grid, applies brush strokes, re-meshes only
 * dirty chunks and transfers the new chunk geometry back to the main thread.
 */
import { ChunkMesher } from './marching-cubes.js';
import { BrushOp, SdfGrid } from './sdf-grid.js';

export type SculptRequest =
  | { type: 'init'; res: number; size: number; radius: number }
  | { type: 'strokes'; id: number; strokes: { op: BrushOp; x: number; y: number; z: number; r: number }[] };

export type SculptResponse = {
  type: 'meshes';
  id: number;
  brushMs: number;
  meshMs: number;
  chunks: { chunk: number; positions: Float32Array; normals: Float32Array }[];
};

let grid: SdfGrid | null = null;
let mesher: ChunkMesher | null = null;

function reply(id: number, brushMs: number): void {
  const t0 = performance.now();
  const chunks = mesher!.meshDirty();
  const meshMs = performance.now() - t0;
  const transfer: ArrayBuffer[] = [];
  for (const c of chunks) transfer.push(c.positions.buffer as ArrayBuffer, c.normals.buffer as ArrayBuffer);
  const msg: SculptResponse = { type: 'meshes', id, brushMs, meshMs, chunks };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<SculptRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    const half = m.size / 2;
    grid = new SdfGrid(m.res, m.size, [-half, -half, -half]);
    mesher = new ChunkMesher(grid);
    const t0 = performance.now();
    grid.fillSphere(0, 0, 0, m.radius);
    reply(0, performance.now() - t0);
  } else if (m.type === 'strokes' && grid) {
    const t0 = performance.now();
    for (const s of m.strokes) grid.brush(s.op, s.x, s.y, s.z, s.r);
    reply(m.id, performance.now() - t0);
  }
};
