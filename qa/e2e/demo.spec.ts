/**
 * The demo video's raw footage (docs/SUBMISSION.md): the scenes of demo.js played with the
 * emulated hands on the published build, recorded at 1080p with their captions, plus a second
 * player for the multiplayer scene. qa/video/edit.py cuts it into the submission video.
 *   QA_DEMO=1 QA_URL=https://<user>.github.io/claymind/ npx --prefix client playwright test -c qa/e2e/playwright.config.ts demo
 * Outputs (git-ignored): qa/recordings/demo-<time>/ (A.webm, B.webm, marks.json).
 */
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from 'playwright/test';
import { withEmulator } from './iwer';

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = join(__dirname, '..', 'recordings', `demo-${STAMP}`);
const URL = process.env.QA_URL ?? 'http://localhost:5191/';
const SIZE = { width: 1920, height: 1080 };

test.skip(!process.env.QA_DEMO, 'demo footage only (QA_DEMO=1)');

interface Mark { page: string; scene: string; from: number; to: number; ret: unknown }
const marks: Mark[] = [];
const t0: Record<string, number> = {};

async function open(browser: Browser, who: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: join(OUT, who), size: SIZE } });
  const page = await ctx.newPage();
  t0[who] = Date.now(); // the recording starts with the page
  page.on('pageerror', (e) => console.log(`[${who} pageerror] ${e.message}`));
  await withEmulator(page);
  await page.goto(`${URL}?debug`);
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 90_000 });
  for (const f of ['driver.js', 'flows.js', 'flows-more.js', 'demo.js']) await page.addScriptTag({ path: join(__dirname, f) });
  console.log(who, 'xr', JSON.stringify(await page.evaluate(() => (window as any).qa.enterXR())));
  await scene(page, who, 'setup', 'demo.setup()');
  return page;
}

/** Run one scene and mark where it is in that page's recording (seconds). */
async function scene(page: Page, who: string, name: string, call: string): Promise<any> {
  const from = (Date.now() - t0[who]) / 1000;
  let ret: unknown;
  try {
    ret = await page.evaluate(call);
  } catch (e) {
    ret = { ok: false, error: (e as Error).message.split('\n')[0] };
  }
  const to = (Date.now() - t0[who]) / 1000;
  marks.push({ page: who, scene: name, from, to, ret });
  console.log(`${who} ${name}: ${from.toFixed(1)}-${to.toFixed(1)} s ${JSON.stringify(ret).slice(0, 300)}`);
  return ret;
}

test('demo footage', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const A = await open(browser, 'A');
  for (const s of ['sculpt', 'life', 'game', 'keep', 'comfort']) await scene(A, 'A', s, `demo.${s}()`);

  const B = await open(browser, 'B');
  const made = await scene(A, 'A', 'room', 'demo.roomCreate()');
  if (made?.code) {
    await scene(B, 'B', 'join', `demo.roomJoin(${JSON.stringify(made.code)})`);
    await A.evaluate(() => (window as any).demo.caption(''));
    const pull = A.evaluate(() => (window as any).demo.sharedPull());
    const from = (Date.now() - t0.B) / 1000;
    await B.evaluate(() => (window as any).demo.caption('Player 2 sees it'));
    await pull;
    await B.waitForTimeout(1500);
    marks.push({ page: 'B', scene: 'shared', from, to: (Date.now() - t0.B) / 1000, ret: null });
    marks.push({ page: 'A', scene: 'shared', from: (from * 1000 + t0.B - t0.A) / 1000, to: (Date.now() - t0.A) / 1000, ret: null });
  }
  writeFileSync(join(OUT, 'marks.json'), JSON.stringify({ t0, marks }, null, 1));
  for (const p of [A, B]) await p.context().close();
  // one file per player
  for (const who of ['A', 'B']) {
    const f = readdirSync(join(OUT, who)).find((x) => x.endsWith('.webm'));
    if (f) renameSync(join(OUT, who, f), join(OUT, `${who}.webm`));
  }
  console.log(`out: ${OUT}`);
});
