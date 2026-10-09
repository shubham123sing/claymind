/// <reference lib="webworker" />
/**
 * Sculpt worker: owns the SculptEngine (SDF grid, history), applies strokes,
 * re-meshes only dirty chunks and transfers chunk geometry to the main thread.
 * Also "bakes" the sculpt into an object: describe -> match templates -> fit
 * template or keep the sculpt -> mesh + fracture pieces. All local, no network.
 */
import { BakedObject, bakeFromSdf, describeTemplate, fitTemplate, sculptSdf } from '../objects/bake.js';
import { describe, ShapeDescriptor } from '../objects/descriptor.js';
import { MatchResult, rank } from '../objects/matcher.js';
import { TEMPLATES } from '../objects/templates.js';
import type { Sdf } from '../objects/csg.js';
import { LumpSpec, MeshUpdate, SculptEngine, Stroke } from './sculpt-engine.js';

export type SculptRequest =
  | { type: 'init'; id: number; res: number; size: number; lump: LumpSpec }
  | { type: 'strokes'; id: number; action: number; strokes: Stroke[] }
  | { type: 'undo'; id: number }
  | { type: 'redo'; id: number }
  | { type: 'resample'; id: number; res: number }
  | { type: 'bake'; id: number; scale: number; threshold: number; pieces: number; seed: number };

export type SculptResponse = MeshUpdate & {
  type: 'mesh';
  id: number;
  /** Time spent applying strokes / undo / resample. */
  brushMs: number;
  meshMs: number;
};

export interface BakeResponse {
  type: 'baked';
  id: number;
  ok: boolean;
  ms: number;
  descriptor: ShapeDescriptor | null;
  ranking: MatchResult[];
  /** 'template' = matched template fitted to the sculpt; 'sculpt' = the sculpt itself. */
  source: 'template' | 'sculpt';
  templateId: string | null;
  baked: BakedObject | null;
}

export type WorkerResponse = SculptResponse | BakeResponse;

let engine: SculptEngine | null = null;
let templates: { id: string; descriptor: ShapeDescriptor; sdf: Sdf }[] | null = null;

const post = (msg: WorkerResponse, transfer: ArrayBuffer[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

function send(id: number, brushMs: number, full = false): void {
  const t0 = performance.now();
  const update = full ? engine!.remeshAll() : engine!.update();
  const meshMs = performance.now() - t0;
  const transfer: ArrayBuffer[] = [];
  for (const c of update.chunks) transfer.push(c.positions.buffer as ArrayBuffer, c.normals.buffer as ArrayBuffer);
  post({ type: 'mesh', id, brushMs, meshMs, ...update }, transfer);
}

function loadTemplates() {
  templates ??= TEMPLATES.map((t) => ({ id: t.id, ...describeTemplate(t) }));
  return templates;
}

function bake(m: Extract<SculptRequest, { type: 'bake' }>): void {
  const t0 = performance.now();
  const grid = engine!.grid;
  const d = describe(grid);
  const fail = (): void =>
    post({ type: 'baked', id: m.id, ok: false, ms: performance.now() - t0, descriptor: d, ranking: [], source: 'sculpt', templateId: null, baked: null });
  if (!d) return fail();
  const lib = loadTemplates();
  const ranking = rank(d, lib.map((t) => ({ id: t.id, descriptor: t.descriptor })));
  const sculptShape = sculptSdf(grid, d.center, m.scale);
  const top = ranking[0];
  const useTemplate = top && top.similarity >= m.threshold;
  const tmpl = useTemplate ? lib.find((t) => t.id === top.id)! : null;
  const sdf = tmpl ? fitTemplate(tmpl, d, sculptShape, m.scale) : sculptShape;
  const extent = Math.max(...d.extents) * m.scale;
  const baked = bakeFromSdf(sdf, extent, { res: tmpl ? 56 : 48, pieces: m.pieces, seed: m.seed });
  const transfer: ArrayBuffer[] = [baked.mesh.positions.buffer as ArrayBuffer, baked.mesh.normals.buffer as ArrayBuffer];
  for (const p of baked.pieces) transfer.push(p.positions.buffer as ArrayBuffer, p.normals.buffer as ArrayBuffer);
  post(
    { type: 'baked', id: m.id, ok: true, ms: performance.now() - t0, descriptor: d, ranking, source: tmpl ? 'template' : 'sculpt', templateId: tmpl?.id ?? null, baked },
    transfer,
  );
}

self.onmessage = (e: MessageEvent<SculptRequest>) => {
  const m = e.data;
  const t0 = performance.now();
  if (m.type === 'init') {
    engine = new SculptEngine(m.res, m.size, m.lump);
    send(m.id, performance.now() - t0, true);
    // warm the template library while the user sculpts
    setTimeout(loadTemplates, 0);
    return;
  }
  if (!engine) return;
  if (m.type === 'bake') return bake(m);
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
