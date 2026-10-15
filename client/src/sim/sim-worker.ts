/**
 * Web Worker for "Simulate it for me": headless runs off the main thread so the game
 * keeps its frame rate. Messages: { id, op: 'game' | 'stability' | 'fix' | 'whatif', ... }.
 */
import { runGame, stability, suggestFix, whatIf, type SimScene, type WhatIfOption } from './runs.js';
import type { GameSpec } from '../playkit/game-spec.js';

type Job =
  | { id: number; op: 'game'; scene: SimScene; spec: GameSpec; seed: number }
  | { id: number; op: 'stability'; scene: SimScene }
  | { id: number; op: 'fix'; scene: SimScene }
  | { id: number; op: 'whatif'; scene: SimScene; spec: GameSpec; option: WhatIfOption; seed: number };

self.onmessage = async (e: MessageEvent<Job>) => {
  const j = e.data;
  try {
    const result =
      j.op === 'game' ? await runGame(j.scene, j.spec, j.seed)
        : j.op === 'stability' ? await stability(j.scene)
          : j.op === 'fix' ? await suggestFix(j.scene)
            : await whatIf(j.scene, j.spec, j.option, j.seed);
    (self as unknown as Worker).postMessage({ id: j.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: j.id, ok: false, error: String(err) });
  }
};
