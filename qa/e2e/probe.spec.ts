/** Probe: headless WebGL + the XR emulator in hand mode + frame rate. QA_PROBE=1 to run. */
import { expect, test } from 'playwright/test';

test.skip(process.env.QA_PROBE !== '1', 'probe only');

test('XR session with emulated hands, fps', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  await page.goto('/?debug&agents=http://127.0.0.1:8790');
  await page.waitForFunction(() => !!(window as any).__sys, null, { timeout: 60_000 });
  const gl = await page.evaluate(() => {
    const r = (window as any).__world.renderer;
    const ctx = r.getContext();
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    return dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const xr = await page.evaluate(async () => {
    const w = window as any, dev = w.IWER_DEVICE;
    dev.controlMode = 'programmatic';
    dev.primaryInputMode = 'hand';
    dev.position.set(0, 1.15, 0);
    dev.grantOfferedSession();
    for (let i = 0; i < 100 && !w.__input.xr; i++) await new Promise((r) => setTimeout(r, 100));
    const info = w.__world.renderer.info.render;
    const f0 = info.frame, t0 = performance.now();
    await new Promise((r) => setTimeout(r, 3000));
    return { xr: w.__input.xr, fps: ((info.frame - f0) * 1000) / (performance.now() - t0), right: w.__input.hands.right.tracked, left: w.__input.hands.left.tracked };
  });
  console.log(JSON.stringify({ gl, ...xr }));
  console.log(logs.filter((l) => l.startsWith('[error]')).join('\n'));
  expect(xr.xr).toBe(true);
});
