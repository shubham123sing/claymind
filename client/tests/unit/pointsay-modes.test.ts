/**
 * Point + Say in three modes (V5 Phase 6.6): chat only, gestures + cards only, combined.
 * eval/pointsay/modes.json through the same code the game uses (binder, intent, built-in game
 * choice, roles and marks applied), offline, no AI. Writes eval/pointsay/modes-results.json.
 * Per mode: right game, every role right, goal / path kept, confirm cards needed, pieces put in
 * a wrong role (false triggers).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bind, bindOrdered, type Attention, type GestureKind, type Word } from '../../src/game-agent/binder';
import { addRole, applyIntent, chooseGame, rolesFromNames, rolesFromWords, type Intent, type RoleAssignment, type RoleWord } from '../../src/game-agent/intent';
import type { Mark } from '../../src/game-agent/marks';
import { TEMPLATES } from '../../src/playkit/templates';

const ROOT = new URL('../../../', import.meta.url);

interface Scenario {
  id: string;
  items: Record<string, [string, string | null]>;
  marks?: Mark[];
  truth: { game: string | null; roles: Partial<Record<RoleWord, string[]>>; goal?: string; path?: string; confirm?: string; unused?: RoleWord[] };
  chat: string;
  cards: [string, string, number][];
  combined: { gestures: [GestureKind, string, number][]; text: string };
}

type Mode = 'chat' | 'cards' | 'combined';

const attentionOf = (g: [string, string, number][]): Attention[] =>
  g.filter(([k]) => k !== 'chip').map(([k, target, t]) => ({ t, gesture: k as GestureKind, ...(k === 'zone' ? { zone: target } : k === 'path' ? { path: target } : { itemId: target }) }));

/** What the game would understand in one mode (the same steps as game-agent-system.ts). */
function understand(s: Scenario, mode: Mode): { intent: Intent; confirms: number } {
  const intent: Intent = { roles: [], zones: [], paths: [], text: '' };
  let confirms = 0;
  const names = Object.entries(s.items).map(([key, [name]]) => ({ key, name }));
  const marks = s.marks ?? [];
  const typed = (text: string, attention: Attention[]) => {
    const words: Word[] = text.split(/\s+/).filter(Boolean).map((w, k) => ({ text: w, t: k }));
    const got = rolesFromWords(words, bindOrdered(words, attention));
    const pointed = new Set(got.roles.flatMap((r) => r.items));
    for (const a of rolesFromNames(text, names)) got.roles.push({ role: a.role, items: a.items.filter((k) => !pointed.has(k)) });
    for (const a of got.roles) if (a.items.length) addRole(intent.roles, a.role, a.items);
    if (got.goal) intent.goal = got.goal;
    intent.text = text;
  };
  if (mode === 'chat') typed(s.chat, []);
  else if (mode === 'combined') {
    const att = attentionOf(s.combined.gestures);
    typed(s.combined.text, att);
    intent.zones = marks.filter((m) => m.kind === 'zone' && att.some((a) => a.zone === m.id));
    intent.paths = marks.filter((m) => m.kind === 'path' && att.some((a) => a.path === m.id));
  } else {
    const att = attentionOf(s.cards);
    for (const [kind, role, t] of s.cards) {
      if (kind !== 'chip') continue;
      const text = role === 'here' ? 'here is the goal' : `this is the ${role}`;
      const words: Word[] = text.split(' ').map((w, k) => ({ text: w, t: t + k * 120 }));
      const r = bind(words, att.filter((a) => a.t <= t + 500), {});
      if (r.ambiguous.length) {
        // one short confirm card: the player picks what they meant
        confirms++;
        if (s.truth.confirm && role !== 'here') addRole(intent.roles, role as RoleWord, [s.truth.confirm]);
        continue;
      }
      const got = rolesFromWords(words, r);
      if (got.goal) intent.goal = got.goal;
      for (const a of got.roles) addRole(intent.roles, a.role, a.items);
    }
    intent.zones = marks.filter((m) => m.kind === 'zone' && att.some((a) => a.zone === m.id));
    intent.paths = marks.filter((m) => m.kind === 'path' && att.some((a) => a.path === m.id));
  }
  return { intent, confirms };
}

function score(s: Scenario, mode: Mode) {
  const { intent, confirms } = understand(s, mode);
  const pick = chooseGame(intent, TEMPLATES, (k) => s.items[k]?.[0] ?? '');
  const game = pick?.spec.id ?? null;
  const gameOk = game === s.truth.game;
  const want = s.truth.roles;
  const got = new Map<string, RoleWord>();
  for (const r of intent.roles as RoleAssignment[]) for (const k of r.items) got.set(k, r.role);
  let rolesRight = 0, rolesTotal = 0, wrong = 0;
  for (const [role, keys] of Object.entries(want)) for (const k of keys!) {
    rolesTotal++;
    if (got.get(k) === role) rolesRight++;
  }
  for (const [k, role] of got) if (!(want[role] ?? []).includes(k) && !(s.truth.unused ?? []).includes(role)) wrong++;
  let marksOk = true, problems: string[] = [];
  if (pick) {
    const applied = applyIntent(pick.spec, intent, (k) => s.items[k]?.[1] ?? `new:${k}`);
    problems = applied.problems;
    if (s.truth.goal) marksOk = intent.zones.some((z) => z.id === s.truth.goal) && applied.spec.zones.some((z) => Math.abs(z.center[0] - intent.zones[0].center[0]) < 1e-6);
    if (s.truth.path) marksOk = marksOk && !!applied.spec.paths?.some((p) => p.id === s.truth.path);
  } else if (s.truth.goal || s.truth.path) marksOk = false;
  const rolesOk = rolesRight === rolesTotal;
  return { game, gameOk, rolesRight, rolesTotal, rolesOk, marksOk, confirms, wrong, valid: problems.length === 0, ok: gameOk && rolesOk && marksOk && wrong === 0 && problems.length === 0 };
}

describe('Point + Say: chat only vs gestures + cards vs combined', () => {
  const modes: Mode[] = ['chat', 'cards', 'combined'];
  const run = (file: string) => {
    const { scenarios } = JSON.parse(readFileSync(new URL(`eval/pointsay/${file}.json`, ROOT), 'utf8')) as { scenarios: Scenario[] };
    const rows = scenarios.map((s) => ({ id: s.id, ...Object.fromEntries(modes.map((m) => [m, score(s, m)])) })) as ({ id: string } & Record<Mode, ReturnType<typeof score>>)[];
    const summary = Object.fromEntries(modes.map((m) => {
      const r = rows.map((x) => x[m]);
      return [m, {
        scenarios: r.length, allRight: r.filter((x) => x.ok).length, gameRight: r.filter((x) => x.gameOk).length,
        rolesRight: r.reduce((a, x) => a + x.rolesRight, 0), rolesTotal: r.reduce((a, x) => a + x.rolesTotal, 0),
        marksKept: r.filter((x) => x.marksOk).length, confirmCards: r.reduce((a, x) => a + x.confirms, 0), wrongRoles: r.reduce((a, x) => a + x.wrong, 0),
        invalidSpecs: r.filter((x) => !x.valid).length,
      }];
    }));
    writeFileSync(new URL(`eval/pointsay/${file}-results.json`, ROOT), JSON.stringify({ summary, rows }, null, 1));
    return { scenarios, summary };
  };

  it('scores every scenario in every mode', () => {
    const { scenarios, summary } = run('modes');
    expect(scenarios.length).toBeGreaterThanOrEqual(15);
    // what must hold in every mode: nothing invalid is ever played; the hands never assign a piece wrongly
    for (const m of modes) expect(summary[m].invalidSpecs, m).toBe(0);
    expect(summary.cards.wrongRoles).toBe(0);
    expect(summary.combined.wrongRoles).toBe(0);
  });

  it('held-out scenarios (scored as they come: the honest number)', () => {
    const { summary } = run('modes-heldout');
    for (const m of modes) expect(summary[m].invalidSpecs, m).toBe(0);
  });
});
