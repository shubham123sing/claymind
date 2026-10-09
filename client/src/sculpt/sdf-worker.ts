/// <reference lib="webworker" />
/**
 * Sculpt worker: owns the SculptEngine (SDF grid, history), applies strokes,
 * re-meshes only dirty chunks and transfers chunk geometry to the main thread.
 */
import { LumpSpec, MeshUpdate, SculptEngine, Stroke } from './sculpt-engine.js';

export type SculptRequest =
  | { type: 'init'; id: number; res: number; size: number; lump: LumpSpec }
  | { type: 'strokes'; id: number; action: number; strokes: Stroke[] }
  | { type: 'undo'; id: number }
  | { type: 'redo'; id: number }
  | { type: 'resample'; id: number; res: number };

export type SculptResponse = MeshUpdate & {
  type: 'mesh';
  id: number;
  /** Time spent applying strokes / undo / resample. */
  brushMs: number;
  meshMs: number;
};

let engine: SculptEngine | null = null;

function send(id: number, brushMs: number, full = false): void {
  const t0 = performance.now();
  const update = full ? engine!.remeshAll() : engine!.update();
  const meshMs = performance.now() - t0;
  const transfer: ArrayBuffer[] = [];
  for (const c of update.chunks) transfer.push(c.positions.buffer as ArrayBuffer, c.normals.buffer as ArrayBuffer);
  const msg: SculptResponse = { type: 'mesh', id, brushMs, meshMs, ...update };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

self.onmessage = (e: MessageEvent<SculptRequest>) => {
  const m = e.data;
  const t0 = performance.now();
  if (m.type === 'init') {
    engine = new SculptEngine(m.res, m.size, m.lump);
    send(m.id, performance.now() - t0, true);
    return;
  }
  if (!engine) return;
  if (m.type === 'strokes') engine.apply(m.action, m.strokes);
  else if (m.type === 'undo') engine.undo();
  else if (m.type === 'redo') engine.redo();
  else if (m.type === 'resample') {
    engine.resample(m.res);
    send(m.id, performance.now() - t0, true);
    return;
  }
  send(m.id, performance.now() - t0);
};
