/** Exploration helper (QA_EXPLORE=<file.js>): loads the app in XR with the driver, runs the given page script, prints its result. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'playwright/test';
import { withEmulator } from './iwer';

test.skip(!process.env.QA_EXPLORE, 'exploration only');

test('explore', async ({ page }) => {
  page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text()));
  await withEmulator(page);
  await page.goto('/?debug&agents=http://127.0.0.1:8790');
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 60_000 });
  await page.addScriptTag({ path: join(__dirname, 'driver.js') });
  await page.addScriptTag({ path: join(__dirname, 'flows.js') });
  await page.addScriptTag({ path: join(__dirname, 'flows-more.js') });
  if (!process.env.QA_NOXR) await page.evaluate(() => (window as any).qa.enterXR());
  const body = readFileSync(process.env.QA_EXPLORE!, 'utf8');
  const out = await page.evaluate(`(async () => { ${body} })()`);
  console.log(JSON.stringify(out, null, 1));
  if (process.env.QA_SHOT) await page.screenshot({ path: process.env.QA_SHOT });
});
