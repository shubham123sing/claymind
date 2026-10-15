/**
 * Talks to the optional agent backend (server/agents). Where it is: `?agents=<url>` once
 * (remembered in localStorage), else http://127.0.0.1:8790 when the game itself runs on
 * this computer; otherwise there is none and every call answers "offline" at once.
 * The player id is a random string kept in this browser (no account, nothing personal).
 * The game never waits on this: a call gives up after 30 s and the built-in games stay.
 */
import type { GameSpec } from '../playkit/game-spec.js';
import type { KitItem } from '../playkit/kit-store.js';

const URL_KEY = 'claymind.agentsUrl';
const PLAYER_KEY = 'claymind.playerId';
const TIMEOUT_MS = 30000;

export const OFFLINE = 'AI helper is offline, built-in games still work.';

export type Fix = 'none' | 'undo' | 'bring_to_life' | 'open_material' | 'open_color' | 'reset_game' | 'end_game';

export interface GameAnswer {
  path: 'your_rules' | 'template' | 'cached' | 'web' | 'surprise' | 'fallback';
  note: string;
  templateId: string | null;
  spec: GameSpec | null;
  preview: { name: string; howToPlay: string[]; missing: string[] };
  cannot: string[];
  adjustments: string[];
  sources: { title: string; url: string }[];
  guessed: boolean;
}

export interface CoachStep {
  text: string;
  tool: string;
  size_cm?: [number, number, number] | null;
  material?: string | null;
  color?: string | null;
}

export interface HelperAnswer {
  intent: 'teach' | 'kit_ideas' | 'make_game' | 'stuck' | 'chat' | 'blocked' | 'offline';
  reply: string;
  fix?: Fix;
  guide?: { title: string; steps: CoachStep[] };
  games?: { id: string; name: string; summary: string; yourItems: string[] }[];
  game?: GameAnswer;
}

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return value ?? null; // private mode: not remembered
  }
}

export function agentsUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('agents');
  if (fromQuery) return store(URL_KEY, fromQuery.replace(/\/$/, ''));
  const saved = store(URL_KEY);
  if (saved) return saved;
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'http://127.0.0.1:8790' : null;
}

function playerId(): string {
  let id = store(PLAYER_KEY);
  if (!id) id = store(PLAYER_KEY, `p_${Math.random().toString(36).slice(2, 12)}`) ?? 'local';
  return id!;
}

/** What the backend may know about a kit item: measured geometry and the player's name and tag, no meshes. */
export function describeKit(kit: KitItem[]) {
  return kit.slice(0, 50).map((k) => ({
    id: k.id, name: k.name, role: k.role, sizeCm: k.stats.sizeCm, massKg: k.stats.massKg, materials: k.stats.materials, parts: k.stats.parts, fill: k.stats.fill,
  }));
}

export class OfflineError extends Error {}

async function call<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const base = agentsUrl();
  if (!base) throw new OfflineError(OFFLINE);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(base + path, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Player-ID': playerId() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429) throw new OfflineError('Too many questions at once: wait a moment.');
    if (!r.ok) throw new OfflineError(OFFLINE);
    return (await r.json()) as T;
  } catch (e) {
    throw e instanceof OfflineError ? e : new OfflineError(OFFLINE);
  } finally {
    clearTimeout(timer);
  }
}

export const helperApi = {
  async online(): Promise<boolean> {
    try {
      return (await call<{ ok: boolean }>('/v1/health')).ok;
    } catch {
      return false;
    }
  },
  ask: (message: string, context: Record<string, unknown>, kit: KitItem[]) => call<HelperAnswer>('/v1/helper', { message, context, kit: describeKit(kit) }),
  game: (req: { name?: string; rules?: string; rulesUnknown?: boolean; surprise?: boolean }, kit: KitItem[]) => call<GameAnswer>('/v1/game', { ...req, kit: describeKit(kit) }),
  guide: (goal: string) => call<{ title: string; steps: CoachStep[]; offline?: boolean }>('/v1/coach/guide', { goal }),
  check: (step: CoachStep, sizeCm: number[], materials: string[]) => call<{ ok: boolean; message: string; fix?: string }>('/v1/coach/check', { step, sizeCm, materials }),
  trace: () => call<{ calls: Record<string, unknown>[] }>('/v1/trace'),
  forget: () => call<{ deleted: boolean }>('/v1/memory', undefined, 'DELETE'),
};
