/** Main-thread side of the dry-run worker: one worker, a promise per job, 45 s cap. */
import type { GameSpec } from '../playkit/game-spec.js';
import type { DryRun, SimScene } from './dry-run.js';

const CAP_MS = 45000;
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (v: DryRun) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

export function dryRunInWorker(scene: SimScene, spec: GameSpec): Promise<DryRun> {
  if (!worker) {
    worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      clearTimeout(w.timer);
      if (e.data.ok) w.ok(e.data.result);
      else w.fail(new Error(e.data.error));
    };
  }
  const id = ++seq;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      worker?.terminate();
      worker = null;
      fail(new Error('The physics check took too long'));
    }, CAP_MS);
    waiting.set(id, { ok, fail, timer });
    worker!.postMessage({ id, scene, spec });
  });
}
