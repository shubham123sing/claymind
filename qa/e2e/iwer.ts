/**
 * The XR emulator for the tests. The release build carries no emulator (V6, R2: nothing emulated may
 * take over a real headset, and nothing loads from unpkg), so each test page gets IWER (the npm
 * package, the same version IWSDK's dev tools use) before the app starts: a Quest 3 in programmatic
 * control, exposed as window.IWER_DEVICE for driver.js. No synthetic room: the app's virtual table.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from 'playwright/test';

const require = createRequire(join(__dirname, '..', '..', 'client', 'package.json'));
const IWER = join(require.resolve('iwer/package.json'), '..', 'build', 'iwer.min.js');

export async function withEmulator(page: Page): Promise<void> {
  await page.addInitScript({ path: IWER });
  await page.addInitScript(() => {
    const I = (globalThis as any).IWER;
    const d = new I.XRDevice(I.metaQuest3);
    d.installRuntime({ forceInstall: true }); // headless Chromium has its own (deviceless) navigator.xr
    (globalThis as any).IWER_DEVICE = d;
  });
}
