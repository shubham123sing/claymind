/**
 * Game agent eval (V5): does the agent do what the player asks?
 * Runs only with CLAYMIND_EVAL=1 and the backend up (server/agents, real free models):
 *   CLAYMIND_EVAL=1 npx vitest run tests/eval/playkit-eval.test.ts
 * Cases: eval/playkit/cases.json. Writes eval/playkit/results.json and docs/EVAL_REPORT.md.
 * Per case: Kit Analyst roles vs expected, game chosen vs expected, the player's numbers kept
 * (their rules win over the web), the Referee (client validateSpec), the game played headless
 * by the demo planner without errors, time taken.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { numbersOf } from '../../src/game-agent/adjust';
import { validateSpec, type GameSpec } from '../../src/playkit/game-spec';
import { templateById } from '../../src/playkit/templates';
import { HavokSim } from '../physics/havok-sim';
import { runGame, sceneFromSpec } from '../../src/sim/dry-run';

const BASE = process.env.CLAYMIND_AGENTS ?? 'http://127.0.0.1:8790';
const ROOT = new URL('../../../', import.meta.url);
const PACE_MS = Number(process.env.CLAYMIND_EVAL_PACE ?? 40000); // free-tier budgets: about one design a minute

interface Case {
  id: string;
  kit: string;
  request: Record<string, unknown>;
  expect: { template?: string[]; roles?: Record<string, string>; players?: number; shotsPerTurn?: number; maxTurns?: number; timerSec?: number; target?: number; cannot?: boolean; blocked?: boolean; anyGame?: boolean };
}

async function post(path: string, body: unknown): Promise<{ ms: number; json: Record<string, unknown> }> {
  const t0 = performance.now();
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5190', 'X-Player-ID': 'eval' }, body: JSON.stringify(body) });
  return { ms: Math.round(performance.now() - t0), json: (await r.json()) as Record<string, unknown> };
}

/** Re-write the report from eval/playkit/results.json (CLAYMIND_EVAL=report): no backend calls. */
/** The agent part of docs/EVAL_REPORT.md; everything from the KEEP marker on (Point + Say, the other evals) stays. */
const KEEP = '<!-- other evals: kept when the agent eval is re-run -->';
function writeReport(agent: string): void {
  const url = new URL('docs/EVAL_REPORT.md', ROOT);
  let rest = '';
  try {
    const old = readFileSync(url, 'utf8');
    if (old.includes(KEEP)) rest = old.slice(old.indexOf(KEEP));
  } catch {
    // first run
  }
  writeFileSync(url, `${agent.trimEnd()}\n\n${rest || `${KEEP}\n`}`);
}

describe.skipIf(process.env.CLAYMIND_EVAL !== 'report')('game agent eval report', () => {
  it('re-scores the last results', () => {
    const data = JSON.parse(readFileSync(new URL('eval/playkit/cases.json', ROOT), 'utf8')) as { cases: Case[] };
    const res = JSON.parse(readFileSync(new URL('eval/playkit/results.json', ROOT), 'utf8')) as { rows: Record<string, unknown>[] };
    for (const r of res.rows) {
      const c = data.cases.find((x) => x.id === r.id);
      if (!c || c.expect.blocked) continue;
      const game = r.game as string | null;
      r.gameOk = c.expect.anyGame ? r.referee !== undefined && !!game : !!game && (c.expect.template ?? []).some((t) => game === t || game.startsWith(`${t}-`));
      r.ok = r.gameOk && r.referee && r.plays && (r.rulesOk ?? true) && (r.cannotOk ?? true);
    }
    writeFileSync(new URL('eval/playkit/results.json', ROOT), JSON.stringify(res, null, 1));
    writeReport(report(res.rows, true));
  });
});

describe.skipIf(process.env.CLAYMIND_EVAL !== '1')('game agent eval', () => {
  it('runs every case', async () => {
    (await HavokSim.create()).destroy(); // Havok's wasm for the headless plays
    const data = JSON.parse(readFileSync(new URL('eval/playkit/cases.json', ROOT), 'utf8')) as { kits: Record<string, unknown[]>; cases: Case[] };
    const rows: Record<string, unknown>[] = [];
    for (const [i, c] of data.cases.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));
      const kit = data.kits[c.kit];
      const row: Record<string, unknown> = { id: c.id };
      // roles: the Kit Analyst's first suggestion vs expected
      if (c.expect.roles) {
        const a = await post('/v1/kit/analyse', { kit });
        const items = (a.json.items as { id: string; suggestedRoles: string[] }[]) ?? [];
        const hits = Object.entries(c.expect.roles).map(([id, want]) => items.find((x) => x.id === id)?.suggestedRoles[0] === want);
        row.roles = `${hits.filter(Boolean).length}/${hits.length}`;
        row.roleHits = hits.filter(Boolean).length;
        row.roleTotal = hits.length;
      }
      let ans: Record<string, unknown> = {};
      try {
        const g = await post('/v1/game', { ...c.request, kit });
        ans = g.json;
        row.ms = g.ms;
      } catch (e) {
        row.error = String(e);
      }
      const spec = ((ans.spec as GameSpec | null) ?? (ans.templateId ? templateById(String(ans.templateId)) : null)) as GameSpec | null;
      const game = (ans.templateId as string | null) ?? spec?.id ?? null;
      row.path = ans.path;
      row.game = game;
      row.name = (ans.preview as { name?: string } | undefined)?.name;
      row.blocked = !!ans.blocked;
      if (c.expect.blocked) row.ok = !!ans.blocked;
      else {
        // an adapted template keeps its family (knock-down, knock-down-custom, ...)
        row.gameOk = c.expect.anyGame ? !!spec : !!game && (c.expect.template ?? []).some((t) => game === t || game.startsWith(`${t}-`));
        row.referee = spec ? validateSpec(spec).length === 0 : false;
        const n = spec ? numbersOf(spec) : null;
        const numbers = (['players', 'shotsPerTurn', 'maxTurns', 'timerSec', 'target'] as const).filter((k) => c.expect[k] !== undefined);
        if (numbers.length) {
          const kept = numbers.filter((k) => n && n[k] === c.expect[k]);
          row.rulesWin = `${kept.length}/${numbers.length}`;
          row.rulesOk = kept.length === numbers.length;
          row.numbers = n;
        }
        if (c.expect.cannot) row.cannotOk = Array.isArray(ans.cannot) && (ans.cannot as unknown[]).length > 0;
        if (spec && row.referee) {
          try {
            const run = await runGame(sceneFromSpec(spec), spec, 7, 30);
            row.plays = run.actions > 0 || run.result !== 'unfinished';
            row.play = `${run.result}, ${run.actions} actions`;
          } catch (e) {
            row.plays = false;
            row.play = String(e).slice(0, 80);
          }
        } else row.plays = false;
        row.ok = row.gameOk && row.referee && row.plays && (row.rulesOk ?? true) && (row.cannotOk ?? true);
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
    writeFileSync(new URL('eval/playkit/results.json', ROOT), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
    writeReport(report(rows));
    expect(rows.length).toBe(data.cases.length);
  }, 60 * 60 * 1000);
});

function pct(a: number, b: number): string {
  return b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '-';
}

function report(rows: Record<string, unknown>[], rescored = false): string {
  const count = (f: (r: Record<string, unknown>) => unknown) => rows.filter(f).length;
  const has = (k: string) => rows.filter((r) => r[k] !== undefined);
  const roleHits = rows.reduce((s, r) => s + Number(r.roleHits ?? 0), 0), roleTotal = rows.reduce((s, r) => s + Number(r.roleTotal ?? 0), 0);
  const games = rows.filter((r) => r.gameOk !== undefined);
  const times = rows.map((r) => Number(r.ms ?? 0)).filter(Boolean).sort((a, b) => a - b);
  const lines = [
    '# Evals (V5)',
    '',
    '## Game agent',
    '',
    `${rescored ? "Re-scored" : "Run"} ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC${rescored ? " from the last run (2026-10-16, 27 cases)," : ""} against the local backend with the free Groq models (real calls, paced for the free budgets). Cases: \`eval/playkit/cases.json\`; raw results: \`eval/playkit/results.json\`; re-run: \`eval/playkit/README.md\`.`,
    '',
    '| Measure | Result |',
    '|---|---|',
    `| Cases fully right | ${pct(count((r) => r.ok), rows.length)} |`,
    `| Roles (Kit Analyst first choice = expected) | ${pct(roleHits, roleTotal)} |`,
    `| Game chosen as expected | ${pct(count((r) => r.gameOk), games.length)} |`,
    `| Player's rules kept (their numbers, over the web) | ${pct(count((r) => r.rulesOk), has('rulesOk').length)} |`,
    `| Rules it cannot express are said | ${pct(count((r) => r.cannotOk), has('cannotOk').length)} |`,
    `| Referee passes the game | ${pct(count((r) => r.referee), games.length)} |`,
    `| Game plays (headless demo planner, no errors) | ${pct(count((r) => r.plays), games.length)} |`,
    `| Unsafe requests refused | ${pct(count((r) => r.blocked && r.ok), rows.filter((r) => r.id && String(r.id).startsWith('unsafe')).length)} |`,
    `| Time per request (median / max) | ${times.length ? `${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s / ${(times[times.length - 1] / 1000).toFixed(1)} s` : '-'} |`,
    '',
    '| Case | Path | Game (name) | Roles | Rules kept | Cannot said | Referee | Plays | Time | OK |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.path ?? ''} | ${r.game ?? (r.blocked ? 'refused' : '')}${r.name ? ` (${r.name})` : ''} | ${r.roles ?? ''} | ${r.rulesWin ?? ''} | ${r.cannotOk === undefined ? '' : r.cannotOk ? 'yes' : 'no'} | ${r.referee === undefined ? '' : r.referee ? 'pass' : 'fail'} | ${r.play ?? ''} | ${r.ms ? `${(Number(r.ms) / 1000).toFixed(1)} s` : ''} | ${r.ok ? 'yes' : 'no'} |`),
    '',
  ];
  return lines.join('\n');
}
