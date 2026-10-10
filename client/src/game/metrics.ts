/**
 * Mastery metrics: how the brain improves with use (brief, section 6.7).
 * Honest mechanisms only: cache reuse, priors from corrections, KG growth,
 * experiments remembered. Persisted in IndexedDB ('settings' / 'metrics').
 */
import { idbGet, idbSet } from '../storage/idb.js';

export const METRICS_SCHEMA_VERSION = 1;

export interface Metrics {
  schemaVersion: number;
  /** Seconds from "Bring to life" to a usable object (local), newest last. */
  timeToObject: number[];
  /** Seconds until the AI result (describe or cached) arrived, newest last. */
  timeToAi: number[];
  objects: number;
  /** Material guesses the user kept vs. all creations. */
  materialKept: number;
  materialTotal: number;
  experimentsRun: number;
  /** Experiments the agent skipped because it already knew the answer. */
  experimentsSaved: number;
  beliefsFixed: number;
  aiCacheHits: number;
}

export function emptyMetrics(): Metrics {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION, timeToObject: [], timeToAi: [], objects: 0, materialKept: 0, materialTotal: 0,
    experimentsRun: 0, experimentsSaved: 0, beliefsFixed: 0, aiCacheHits: 0,
  };
}

export const metrics: Metrics = emptyMetrics();

const KEY = 'metrics';
const MAX_HISTORY = 50;

export function pushHistory(list: number[], v: number): void {
  list.push(Math.round(v * 1000) / 1000);
  if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY);
}

export async function loadMetrics(): Promise<void> {
  const raw = await Promise.race([idbGet<Partial<Metrics>>('settings', KEY), new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]);
  if (raw && (raw.schemaVersion ?? 0) <= METRICS_SCHEMA_VERSION) Object.assign(metrics, emptyMetrics(), raw, { schemaVersion: METRICS_SCHEMA_VERSION });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function saveMetrics(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void idbSet('settings', KEY, { ...metrics }), 400);
}

export function resetMetrics(): void {
  Object.assign(metrics, emptyMetrics());
  saveMetrics();
}

export interface MasteryInputs {
  userBeliefs: number;
  kgNodes: number;
  kgEdges: number;
}

/** 0..100: objects made, material accuracy, beliefs you taught it, experiments it ran. */
export function masteryScore(m: Metrics, k: MasteryInputs): number {
  const accuracy = m.materialTotal ? m.materialKept / m.materialTotal : 0;
  const score =
    0.3 * Math.min(1, m.objects / 10) +
    0.25 * accuracy * Math.min(1, m.materialTotal / 3) +
    0.25 * Math.min(1, (k.userBeliefs + m.beliefsFixed) / 5) +
    0.2 * Math.min(1, (m.experimentsRun + m.experimentsSaved) / 5);
  return Math.round(score * 100);
}

export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
