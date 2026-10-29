/**
 * Autosave (V6 section 6): sculpt and bring a creation to life by hand, close the page without saving
 * anything, open it again: the same clay (checksum) and the creation come back.
 *   npx --prefix client playwright test -c qa/e2e/playwright.config.ts autosave
 */
import { join } from 'node:path';
import { expect, test } from 'playwright/test';
import { withEmulator } from './iwer';

test.skip(!!process.env.QA_PROBE || !!process.env.QA_EXPLORE, 'other mode');

test('a reload loses nothing: the clay and the loose creation come back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withEmulator(page);
  await page.goto('/?debug');
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 90_000 });
  for (const f of ['driver.js', 'flows.js', 'flows-more.js']) await page.addScriptTag({ path: join(__dirname, f) });
  await page.evaluate(() => (window as any).qa.enterXR());
  const before = await page.evaluate(async () => {
    const w = window as any, F = w.qaFlows;
    await F.menuPath('make', 'add');
    await F.stroke([1, 0.3, 0.5], [0.05, 0.01, 0.02]);
    const id = await F.bringToLife();
    await F.stroke([-1, 0.2, 0.3], [-0.04, 0.01, 0.02]); // the fresh lump changed too
    const a = w.__sys.autosave, t0 = performance.now();
    const c0 = a.stats.clay, o0 = a.stats.objects;
    while (performance.now() - t0 < 15000 && (a.stats.clay <= c0 || a.stats.objects <= o0)) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 500));
    return { id, sum: await w.__sys.sculpt.sculptClient.checksum(), creations: w.__sys.objects.liveCreationIds(), stats: { ...a.stats } };
  });
  console.log('before', JSON.stringify(before));
  expect(before.id).toBeTruthy();

  await page.reload();
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 90_000 });
  const after = await page.evaluate(async () => {
    const w = window as any, t0 = performance.now();
    while (performance.now() - t0 < 15000 && !(w.__sys.autosave.stats.restoredClay && w.__sys.objects.liveCreationIds().length)) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 800));
    return { sum: await w.__sys.sculpt.sculptClient.checksum(), creations: w.__sys.objects.liveCreationIds(), stats: { ...w.__sys.autosave.stats } };
  });
  console.log('after', JSON.stringify(after));
  expect(after.stats.restoredClay).toBe(true);
  expect(after.sum).toBe(before.sum);
  expect(after.creations).toEqual(expect.arrayContaining(before.creations));
  expect(errors).toEqual([]);
});
