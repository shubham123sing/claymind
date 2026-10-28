/**
 * Headroom estimate without a Quest (V6 section 6): the release in emulated XR with the CPU slowed
 * 1x, 4x and 6x (Chrome DevTools throttling). Measures fps idle and while sculpting, the clay worker's
 * stroke time, and what the frame-rate governor did. A desktop estimate only, not a Quest measurement.
 *   QA_THROTTLE=1 npx --prefix client playwright test -c qa/e2e/playwright.config.ts throttle
 */
import { join } from 'node:path';
import { test } from 'playwright/test';
import { withEmulator } from './iwer';

test.skip(!process.env.QA_THROTTLE, 'set QA_THROTTLE=1');

for (const rate of [1, 4, 6]) {
  test(`CPU ${rate}x`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await withEmulator(page);
    await page.goto('/?debug');
    await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 120_000 });
    for (const f of ['driver.js', 'flows.js', 'flows-more.js']) await page.addScriptTag({ path: join(__dirname, f) });
    await page.evaluate(() => (window as any).qa.enterXR());
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await page.evaluate(async () => {
      const w = window as any, qa = w.qa, F = w.qaFlows;
      const idle = await qa.fps(3000);
      await F.menuPath('make', 'add');
      const f0 = w.__world.renderer.info.render.frame, t0 = performance.now();
      for (let i = 0; i < 4; i++) await F.stroke([i % 2 ? -1 : 1, 0.3, 0.4], [0.03 * (i % 2 ? -1 : 1), 0.01, 0.02]);
      const sculpting = Math.round(((w.__world.renderer.info.render.frame - f0) * 1000) / (performance.now() - t0) * 10) / 10;
      await qa.frames(60);
      const st = w.__sys.sculpt.sculptClient.stats;
      return {
        idle, sculpting, workerP90: Math.round(st.workerP90 * 10) / 10, rttP50: Math.round(st.rttP50 * 10) / 10, res: w.__sys.sculpt.sculptClient.res,
        downgrades: st.downgrades, quality: w.__quality.level, qualityChanges: w.__quality.changes, calls: w.__world.renderer.info.render.calls, tris: w.__world.renderer.info.render.triangles,
      };
    });
    console.log(`THROTTLE ${rate}x ${JSON.stringify(r)}`);
  });
}
