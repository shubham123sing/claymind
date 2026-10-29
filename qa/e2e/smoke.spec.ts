/**
 * Release smoke test (V6 Stage D): the build as published, in a few minutes. Against the local
 * release preview by default, or a deployed copy with QA_URL (e.g. the Pages address):
 *   npx --prefix client playwright test -c qa/e2e/playwright.config.ts smoke
 *   QA_URL=https://<user>.github.io/claymind/ npx --prefix client playwright test -c qa/e2e/playwright.config.ts smoke
 * Checks: it loads with no page errors and nothing from outside hosts but the game agent's backend;
 * it names its build; with the backend unreachable it still loads clean; Enter VR gives an
 * immersive VR session (emulated headset, not a Quest).
 */
import { join } from 'node:path';
import { expect, Page, test } from 'playwright/test';
import { withEmulator } from './iwer';

test.skip(!!process.env.QA_PROBE || !!process.env.QA_EXPLORE, 'other mode');

const URL = process.env.QA_URL ?? 'http://localhost:5191/';
const BACKEND = 'claymind-agents.onrender.com';
/** On localhost the game uses the local backend instead (agent-client.ts). */
const LOCAL_BACKEND = '127.0.0.1:8790';

async function load(page: Page, query = ''): Promise<{ errors: string[]; hosts: Set<string>; failed: string[] }> {
  const errors: string[] = [], failed: string[] = [], hosts = new Set<string>();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => hosts.add(new globalThis.URL(r.url()).host));
  page.on('requestfailed', (r) => !r.url().includes(BACKEND) && !r.url().includes(LOCAL_BACKEND) && failed.push(r.url()));
  await page.goto(URL + query);
  await page.waitForSelector('canvas', { timeout: 90_000 });
  await page.waitForTimeout(8000);
  return { errors, hosts, failed };
}

test('loads clean, nothing from outside hosts but the backend', async ({ page }) => {
  const r = await load(page);
  const own = new globalThis.URL(URL).host;
  const outside = [...r.hosts].filter((h) => h && h !== own && h !== BACKEND && h !== LOCAL_BACKEND);
  console.log(`SMOKE hosts ${[...r.hosts].join(', ')}`);
  expect(r.errors).toEqual([]);
  expect(r.failed).toEqual([]);
  expect(outside).toEqual([]);
});

test('names its build (Settings -> About shows the same id)', async ({ page, request }) => {
  const html = await (await request.get(URL)).text();
  const main = html.match(/src="([^"]*assets\/main-[^"]+\.js)"/)?.[1];
  expect(main).toBeTruthy();
  const js = await (await request.get(new globalThis.URL(main!, URL).href)).text();
  const id = js.match(/"([0-9a-f]{7}|local) (\d{4}-\d{2}-\d{2})"/)?.[0];
  console.log(`SMOKE build ${id}`);
  expect(id).toBeTruthy();
  void page;
});

test('the backend unreachable: still loads clean', async ({ page }) => {
  await page.route(`https://${BACKEND}/**`, (r) => r.abort());
  await page.route(`http://${LOCAL_BACKEND}/**`, (r) => r.abort());
  const r = await load(page);
  expect(r.errors).toEqual([]);
  expect(r.failed).toEqual([]);
});

test('Enter VR gives an immersive VR session (emulated headset)', async ({ page }) => {
  await withEmulator(page);
  await page.goto(URL + '?debug');
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 90_000 });
  await page.addScriptTag({ path: join(__dirname, 'driver.js') });
  await page.evaluate(() => (window as any).qa.enterXR());
  const s = await page.evaluate(() => {
    const x = (window as any).__world.renderer.xr;
    const session = x.getSession();
    return { presenting: x.isPresenting, blend: session?.environmentBlendMode, room: !!(window as any).__sys.sculpt };
  });
  console.log(`SMOKE xr ${JSON.stringify(s)}`);
  expect(s.presenting).toBe(true);
  expect(s.blend).toBe('opaque');
});
