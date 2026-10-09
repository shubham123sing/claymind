/** Persists the brain (KG snapshot incl. change log) in IndexedDB, debounced. */
import type { Brain } from '../kg/brain.js';
import { migrateSnapshot } from '../kg/migrations.js';
import { idbDelete, idbGet, idbSet } from './idb.js';

const KEY = 'brain';

export async function loadBrain(brain: Brain): Promise<'loaded' | 'seeded'> {
  // storage must never block the game: give IndexedDB 1.5 s, then start from the seed
  const raw = await Promise.race([
    idbGet<Record<string, unknown>>('kg', KEY),
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500)),
  ]);
  const snap = raw ? migrateSnapshot(raw) : null;
  if (snap && snap.nodes.length > 0) {
    brain.graph.load(snap);
    return 'loaded';
  }
  brain.seedIfEmpty();
  return 'seeded';
}

/** Save shortly after every change (and on page hide). Returns an unsubscribe function. */
export function autoSave(brain: Brain): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    void idbSet('kg', KEY, brain.graph.snapshot());
  };
  const off = brain.graph.onChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  });
  const onHide = () => document.visibilityState === 'hidden' && save();
  document.addEventListener('visibilitychange', onHide);
  return () => {
    off();
    document.removeEventListener('visibilitychange', onHide);
  };
}

export async function clearBrain(): Promise<void> {
  await idbDelete('kg', KEY);
}
