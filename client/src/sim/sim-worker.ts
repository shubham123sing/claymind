/**
 * The Referee's dry run in a Web Worker (V5): a new game is played headless in the game's own
 * physics before it is offered, so the frame rate stays smooth. Message: { id, scene, spec }.
 */
import type { GameSpec } from '../playkit/game-spec.js';
import { dryRun, type SimScene } from './dry-run.js';

self.onmessage = async (e: MessageEvent<{ id: number; scene: SimScene; spec: GameSpec }>) => {
  const { id, scene, spec } = e.data;
  try {
    const result = await dryRun(scene, spec);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
