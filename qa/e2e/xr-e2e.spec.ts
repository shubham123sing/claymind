/**
 * ClayMind XR end-to-end test that records itself. Hands only: IWER's emulated hands in
 * programmatic control mode, moved frame by frame (driver.js), every action a pinch, a fingertip
 * poke or a hand movement. Scripted hands: test evidence, not a user video.
 *
 * Run (repo root):  npx --prefix client playwright test -c qa/e2e/playwright.config.ts xr-e2e
 * QA_LABEL=before|after names the run folder; QA_STEPS=a,b,... runs some steps only.
 * Outputs: qa/recordings/<label>-<time>/ (git-ignored): videos, step screenshots, key frames cut
 * from the video with ffmpeg, console and network logs, fps samples, steps.json.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from 'playwright/test';
import { withEmulator } from './iwer';

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = join(__dirname, '..', 'recordings', `${process.env.QA_LABEL ?? 'run'}-${STAMP}`);
const ONLY = (process.env.QA_STEPS ?? 'h,a,b,c,d,e,f,r,x,m,k,g').split(',');
const BACKEND = 'http://127.0.0.1:8790';
const LIVE = process.env.QA_URL;
/** The backend the page talks to (blocked for the offline check). */
const AGENTS = LIVE ? 'https://claymind-agents.onrender.com' : BACKEND;

interface StepResult { step: string; name: string; pass: boolean; detail: string; at: number; shot?: string; fps?: number; page: string }
const results: StepResult[] = [];
const t0: Record<string, number> = {};

function ffmpeg(): string | null {
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(base)) return null;
  const dir = readdirSync(base).filter((d) => d.startsWith('ffmpeg')).sort().pop();
  const exe = dir && join(base, dir, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux');
  return exe && existsSync(exe) ? exe : null;
}

async function open(context: BrowserContext, who: string): Promise<Page> {
  const page = await context.newPage();
  t0[who] = Date.now();
  const log = join(OUT, `console-${who}.log`), net = join(OUT, `network-${who}.jsonl`);
  page.on('console', (m) => appendFileSync(log, `${((Date.now() - t0[who]) / 1000).toFixed(1)}s [${m.type()}] ${m.text()}\n`));
  page.on('pageerror', (e) => appendFileSync(log, `${((Date.now() - t0[who]) / 1000).toFixed(1)}s [pageerror] ${e.message}\n`));
  page.on('requestfinished', async (r) => {
    const res = await r.response().catch(() => null);
    appendFileSync(net, JSON.stringify({ t: (Date.now() - t0[who]) / 1000, method: r.method(), url: r.url().slice(0, 200), status: res?.status() ?? null, ms: Math.round(r.timing().responseEnd) }) + '\n');
  });
  page.on('requestfailed', (r) => appendFileSync(net, JSON.stringify({ t: (Date.now() - t0[who]) / 1000, method: r.method(), url: r.url().slice(0, 200), failed: r.failure()?.errorText }) + '\n'));
  page.on('websocket', (ws) => appendFileSync(net, JSON.stringify({ t: (Date.now() - t0[who]) / 1000, websocket: ws.url() }) + '\n'));
  await withEmulator(page);
  // QA_URL: a deployed copy (e.g. the Pages address), with its own backend
  await page.goto(LIVE ? `${LIVE}?debug` : `/?debug&agents=${BACKEND}`);
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 90_000 });
  for (const f of ['driver.js', 'flows.js', 'flows-more.js']) await page.addScriptTag({ path: join(__dirname, f) });
  const xr = await page.evaluate(() => (window as any).qa.enterXR());
  record(who, '0', 'enter XR with emulated hands (hand mode)', xr.xr && xr.left && xr.right, JSON.stringify(xr));
  await shot(page, who, '0-xr');
  return page;
}

function record(who: string, step: string, name: string, pass: boolean, detail: string): StepResult {
  const r: StepResult = { step, name, pass, detail, at: (Date.now() - t0[who]) / 1000, page: who };
  results.push(r);
  console.log(`${pass ? 'PASS' : 'FAIL'} [${who} ${step}] ${name}: ${detail}`);
  return r;
}

let shotNo = 0;
async function shot(page: Page, who: string, label: string): Promise<string> {
  const file = `${String(++shotNo).padStart(2, '0')}-${who}-${label}.png`;
  await page.screenshot({ path: join(OUT, 'steps', file) });
  return file;
}

/** Run a flow in the page; each of its results is recorded, then a screenshot and an fps sample. */
async function flow(page: Page, who: string, step: string, call: string, arg?: unknown): Promise<any[]> {
  let out: any[] = [];
  try {
    out = await page.evaluate(([c, a]) => (window as any).qaFlows[c as string](a), [call, arg] as const);
    if (!Array.isArray(out)) out = [out];
  } catch (e) {
    out = [{ name: call, pass: false, detail: `error: ${(e as Error).message.split('\n')[0]}` }];
  }
  // V6 4.4: no overlapping panels on the screen the player sees, after every flow
  const ov = await page.evaluate(() => (window as any).qa.overlaps()).catch(() => null);
  if (ov) out.push({ name: `no overlapping panels after ${call}`, pass: ov.length === 0, detail: ov.length ? JSON.stringify(ov) : 'none' });
  const file = await shot(page, who, `${step}-${call}`);
  const fps = await page.evaluate(() => (window as any).qa.fps(1000)).catch(() => null);
  for (const r of out) Object.assign(record(who, step, r.name, !!r.pass, r.detail ?? ''), { shot: file, fps });
  return out;
}

test.skip(!!process.env.QA_PROBE || !!process.env.QA_EXPLORE, 'other mode');

test('ClayMind by hand, recorded', async ({ browser }) => {
  mkdirSync(join(OUT, 'steps'), { recursive: true });
  mkdirSync(join(OUT, 'video'), { recursive: true });
  const ctxA = await browser.newContext({ recordVideo: { dir: join(OUT, 'video'), size: { width: 1280, height: 720 } }, viewport: { width: 1280, height: 720 } });
  const A = await open(ctxA, 'A');

  // h first: a new player's first launch (V6, 4.1)
  if (ONLY.includes('h')) for (const part of [1, 2, 3]) await flow(A, 'A', 'h', 'firstFive', part);
  if (ONLY.includes('a')) await flow(A, 'A', 'a', 'sculpt');
  if (ONLY.includes('b')) await flow(A, 'A', 'b', 'colourPaintMaterial');
  if (ONLY.includes('c')) await flow(A, 'A', 'c', 'physicsPush');
  if (ONLY.includes('d')) await flow(A, 'A', 'd', 'libraryAndKit');
  if (ONLY.includes('e')) {
    await flow(A, 'A', 'e', 'gameFromCard', 'Bowling');
    await flow(A, 'A', 'e', 'describeGame');
  }
  if (ONLY.includes('f')) await flow(A, 'A', 'f', 'playGame');
  if (ONLY.includes('r')) await flow(A, 'A', 'r', 'robust');
  if (ONLY.includes('x')) await flow(A, 'A', 'x', 'extras');
  if (ONLY.includes('m')) await flow(A, 'A', 'm', 'panelMove');
  if (ONLY.includes('k')) await flow(A, 'A', 'k', 'seatHeight');
  if (ONLY.includes('e')) {
    // the backend off: every call to it fails, as when the server is down
    await A.route(`${AGENTS}/**`, (r) => r.abort());
    await flow(A, 'A', 'e', 'gameOffline');
    await A.unroute(`${AGENTS}/**`);
  }

  let ctxB: BrowserContext | null = null;
  if (ONLY.includes('g')) {
    // end any game on A first (the HUD's End button)
    await A.evaluate(async () => {
      const qa = (window as any).qa;
      if ((window as any).__sys.playkit.playMode !== 'off' && qa.region('hud:end')) await qa.panelPress('hud:end');
    });
    ctxB = await browser.newContext({ recordVideo: { dir: join(OUT, 'video'), size: { width: 1280, height: 720 } }, viewport: { width: 1280, height: 720 } });
    const B = await open(ctxB, 'B');
    const made = await A.evaluate(() => (window as any).qaFlows.roomCreate());
    record('A', 'g', 'create a room (Multiplayer -> Create)', made.pass, made.detail);
    await shot(A, 'A', 'g-room');
    const joined = made.code ? await B.evaluate((c) => (window as any).qaFlows.roomJoin(c), made.code) : { pass: false, detail: 'no code' };
    record('B', 'g', 'join by code on the pinch keypad', joined.pass, joined.detail);
    await shot(B, 'B', 'g-joined');
    // build one shared piece: A pulls the shared clay, B must see the same clay
    const before = await B.evaluate(() => (window as any).qa.clay().rawVolume);
    const pull = await A.evaluate(async () => {
      const w = window as any, sc = w.__sys.sculpt;
      await w.qaFlows.menuPath('make', 'shape');
      const seq0 = w.__claySync?.lastSeq ?? 0;
      // on the clay's left: creations from earlier steps rest against its right side and take a pinch there
      await w.qaFlows.stroke([-1, 0.3, 0.3], [-0.04, 0.01, 0]);
      await w.qa.frames(30);
      return { tool: sc.tool?.id, mirror: sc.mirror, suspended: sc.suspended, playMode: w.__sys.playkit.playMode, edits: (w.__claySync?.lastSeq ?? 0) - seq0 };
    });
    console.log('A pull:', JSON.stringify(pull));
    await B.evaluate(() => (window as any).qa.frames(90));
    const [va, vb] = await Promise.all([A.evaluate(() => (window as any).qa.clay()), B.evaluate(() => (window as any).qa.clay())]);
    // the same edits in the same order and the same clay (the room's own check: sequence + checksum)
    const sync = async (p: Page) => p.evaluate(async () => ({ seq: (window as any).__claySync?.lastSeq ?? 0, sum: await (window as any).__sys.sculpt.sculptClient.checksum() }));
    const [sa, sb] = [await sync(A), await sync(B)];
    record('B', 'g', 'shared clay: A pulls, B sees the same clay', sa.seq > 0 && sa.seq === sb.seq && sa.sum === sb.sum, `edits applied A ${sa.seq}, B ${sb.seq}; checksums ${sa.sum === sb.sum ? 'equal' : `differ (${sa.sum} / ${sb.sum})`}; B volume ${before} -> ${vb.rawVolume} cm3 (a pull moves clay, it adds little)`);
    await shot(B, 'B', 'g-shared-clay');
    // play one turn: the host starts Knock-down and throws (up to the turn's 3 shots); B mirrors it
    const started = await A.evaluate(() => (window as any).qaFlows.startKnockDown());
    await B.evaluate(() => (window as any).qa.frames(60));
    const mirror = await B.evaluate(() => ({ mirror: (window as any).__sys.playkit.mirror, game: (window as any).__sys.playkit.gameName }));
    record('B', 'g', 'host starts a game, the other player mirrors it', started && mirror.mirror && !!mirror.game, `host started ${started}; B: ${JSON.stringify(mirror)}`);
    const thrown = await A.evaluate(() => (window as any).qaFlows.throwOne());
    await B.evaluate(() => (window as any).qa.frames(60));
    const [ha, hb] = await Promise.all([A.evaluate(() => (window as any).qaFlows.hud()), B.evaluate(() => (window as any).qaFlows.hud())]);
    const moved = !/Blocks down: 0 \//.test(ha.lines.join(' '));
    record('B', 'g', 'one turn played: blocks go down, both see the same score', thrown && moved && ha.lines.join() === hb.lines.join(), `A: ${ha.lines.join(' | ')}; B: ${hb.lines.join(' | ')}`);
    await shot(A, 'A', 'g-turn');
    await shot(B, 'B', 'g-turn');
    // V6 section 5: B's connection drops (as on a network failure); it rejoins the same room by itself
    // and gets the same clay back from the host's snapshot
    const code = made.code;
    await B.evaluate(() => (window as any).__room.dropForTest());
    const back = await B.evaluate(async (c) => {
      const w = window as any, t0 = performance.now();
      while (performance.now() - t0 < 30000 && !(w.__room.connected && w.__room.code === c && w.__room.players.length >= 2)) await new Promise((r) => setTimeout(r, 100));
      await w.qa.frames(90);
      return { connected: w.__room.connected, code: w.__room.code, players: w.__room.players.length, rejoins: w.__sys.multiplayer.rejoins, ms: Math.round(performance.now() - t0) };
    }, code);
    const [ra, rb] = [await sync(A), await sync(B)];
    record('B', 'g', 'connection lost: rejoins the same room by itself, same clay', back.connected && back.code === code && back.players >= 2 && ra.sum === rb.sum,
      `${JSON.stringify(back)}; checksums ${ra.sum === rb.sum ? 'equal' : `differ (${ra.sum} / ${rb.sum})`}`);
    // the host leaves: B becomes the host and keeps its table
    await A.evaluate(() => (window as any).__room.leave());
    const host = await B.evaluate(async () => {
      const w = window as any, t0 = performance.now();
      while (performance.now() - t0 < 10000 && !(w.__room.isHost && w.__room.players.length === 1)) await new Promise((r) => setTimeout(r, 100));
      return { host: w.__room.isHost, connected: w.__room.connected, players: w.__room.players.length, clayVolume: w.qa.clay().rawVolume };
    });
    record('B', 'g', 'the host leaves: the other player becomes host, keeps the table', host.host && host.connected && host.players === 1 && host.clayVolume > 0, JSON.stringify(host));
  }

  // fps over the run's end state, then close (the videos are written on close)
  const videoA = A.video();
  const fpsEnd = await A.evaluate(() => (window as any).qa.fps(2000)).catch(() => null);
  await ctxA.close();
  if (ctxB) await ctxB.close();
  const videos = [await videoA?.path().catch(() => null)].filter(Boolean) as string[];

  // key frames cut from the video at each recorded step (ffmpeg: Playwright's own build)
  const exe = ffmpeg();
  const keyDir = join(OUT, 'keyframes');
  mkdirSync(keyDir, { recursive: true });
  const cut: string[] = [];
  if (exe && videos[0]) {
    for (const [i, r] of results.filter((x) => x.page === 'A').entries()) {
      const f = join(keyDir, `${String(i + 1).padStart(2, '0')}-${r.step}-${r.pass ? 'pass' : 'FAIL'}.png`);
      try {
        execFileSync(exe, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, r.at - 0.5)), '-i', videos[0], '-frames:v', '1', f]);
        cut.push(f);
      } catch {
        /* past the end of the video */
      }
    }
  }
  writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ run: STAMP, label: process.env.QA_LABEL ?? 'run', fpsEnd, videos, keyframes: cut.length, results }, null, 1));
  console.log(`\nRecordings: ${OUT}\n${results.filter((r) => r.pass).length}/${results.length} PASS`);
  expect(results.length).toBeGreaterThan(0);
});
