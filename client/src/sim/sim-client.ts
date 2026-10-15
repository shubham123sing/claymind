/** Main-thread side of the simulation worker: one worker, promise per job, 60 s cap. */
import type { GameSpec } from '../playkit/game-spec.js';
import type { Fix, GameRun, SimScene, Stability, Variant, WhatIfOption } from './runs.js';

const CAP_MS = 60000;
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function post<T>(job: Record<string, unknown>): Promise<T> {
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
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      stopSimulation(); // a stuck run: start a fresh worker next time
      fail(new Error('The simulation took too long'));
    }, CAP_MS);
    waiting.set(id, { ok: ok as (v: unknown) => void, fail, timer });
    worker!.postMessage({ id, ...job });
  });
}

/** Stop button: end every running job now. */
export function stopSimulation(): void {
  worker?.terminate();
  worker = null;
  for (const [, w] of waiting) {
    clearTimeout(w.timer);
    w.fail(new Error('Stopped'));
  }
  waiting.clear();
}

export const simulate = {
  game: (scene: SimScene, spec: GameSpec, seed: number) => post<GameRun>({ op: 'game', scene, spec, seed }),
  stability: (scene: SimScene) => post<Stability>({ op: 'stability', scene }),
  fix: (scene: SimScene) => post<Fix | null>({ op: 'fix', scene }),
  whatIf: (scene: SimScene, spec: GameSpec, option: WhatIfOption, seed: number) =>
    post<{ variants: Variant[]; best: Variant; current: Variant | null; replayIdentical: boolean }>({ op: 'whatif', scene, spec, option, seed }),
};
