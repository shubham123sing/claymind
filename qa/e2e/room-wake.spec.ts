/**
 * Create a room while the room server is asleep (a free host): the page must keep trying and get
 * the room once the server is up, with no second press. The page talks to a backend on its own
 * port that is started 12 s after Create is pressed.
 *   QA_WAKE=1 npx --prefix client playwright test -c qa/e2e/playwright.config.ts room-wake
 * Needs a release build in client/dist and the server venv (server/.venv).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'playwright/test';
import { withEmulator } from './iwer';

const PORT = 8795;
const SERVER = join(__dirname, '..', '..', 'server');

test.skip(!process.env.QA_WAKE, 'room wake check only (QA_WAKE=1)');

let backend: ChildProcess | null = null;
test.afterAll(() => {
  backend?.kill();
});

test('Create a room while the server is asleep', async ({ page }) => {
  test.setTimeout(240_000);
  await withEmulator(page);
  await page.goto(`/?debug&agents=http://127.0.0.1:${PORT}`);
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 90_000 });
  for (const f of ['driver.js', 'flows.js', 'flows-more.js']) await page.addScriptTag({ path: join(__dirname, f) });
  await page.evaluate(() => (window as any).qa.enterXR());
  const pressed = await page.evaluate(async () => {
    const w = window as any;
    await w.qaFlows.menuPath('mp', 'room');
    return (await w.qa.panelPress('create')).ok;
  });
  expect(pressed).toBe(true);
  const t0 = Date.now();
  await page.waitForTimeout(12_000);
  const asleep = await page.evaluate(() => (window as any).__room.connected);
  console.log('after 12 s with no server: connected', asleep);
  expect(asleep).toBe(false);
  const py = process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python';
  backend = spawn(py, ['-m', 'agents.run'], { cwd: SERVER, env: { ...process.env, CLAYMIND_AGENTS_PORT: String(PORT) }, stdio: 'ignore' });
  await page.waitForFunction(() => (window as any).__room.connected, null, { timeout: 90_000, polling: 500 });
  const code = await page.evaluate(() => (window as any).__room.code);
  console.log(`room ${code} after ${((Date.now() - t0) / 1000).toFixed(1)} s, one press`);
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
});
