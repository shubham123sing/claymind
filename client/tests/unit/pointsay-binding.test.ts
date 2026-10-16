/**
 * Point + Say binding eval (V5 Phase 6.6, the code part): eval/pointsay/cases.json against the
 * binder. Binding accuracy, false triggers, confirm cards needed. Re-runnable, no network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bind, type Attention, type GestureKind, type Word } from '../../src/game-agent/binder';

const ROOT = new URL('../../../', import.meta.url);

interface Case {
  id: string;
  words: [string, number][];
  attention: [GestureKind, number, string][];
  held?: string[];
  pointed?: string;
  expect: Record<string, string[] | 'unresolved' | 'ambiguous'>;
}

describe('Point + Say: binding words to gestures', () => {
  it('binds every case as expected', () => {
    const { cases } = JSON.parse(readFileSync(new URL('eval/pointsay/cases.json', ROOT), 'utf8')) as { cases: Case[] };
    const rows: { id: string; ok: boolean; falseTriggers: number; confirms: number; got: string }[] = [];
    let words = 0, right = 0;
    for (const c of cases) {
      const w: Word[] = c.words.map(([text, t]) => ({ text, t }));
      const att: Attention[] = c.attention.map(([gesture, t, target]) => ({ t, gesture, ...(gesture === 'zone' ? { zone: target } : gesture === 'path' ? { path: target } : { itemId: target }) }));
      const r = bind(w, att, { pointed: c.pointed ?? null, held: c.held ?? [] });
      const got: Record<string, string[] | string> = {};
      for (const b of r.bindings) got[b.index] = b.ids;
      for (const u of r.unresolved) got[u.index] = 'unresolved';
      for (const a of r.ambiguous) got[a.index] = 'ambiguous';
      let ok = true;
      for (const [i, want] of Object.entries(c.expect)) {
        words++;
        const g = got[i];
        const same = Array.isArray(want) ? Array.isArray(g) && g.length === want.length && want.every((x) => g.includes(x)) : g === want;
        if (same) right++;
        else ok = false;
      }
      // a word that should not bind but did
      const falseTriggers = r.bindings.filter((b) => !(String(b.index) in c.expect)).length;
      if (falseTriggers) ok = false;
      rows.push({ id: c.id, ok, falseTriggers, confirms: r.ambiguous.length + r.unresolved.length, got: JSON.stringify(got) });
    }
    const summary = {
      cases: cases.length, casesRight: rows.filter((r) => r.ok).length, words, wordsRight: right,
      falseTriggers: rows.reduce((s, r) => s + r.falseTriggers, 0), confirmCards: rows.reduce((s, r) => s + r.confirms, 0),
    };
    writeFileSync(new URL('eval/pointsay/binding-results.json', ROOT), JSON.stringify({ summary, rows }, null, 1));
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.got}`)).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });
});
