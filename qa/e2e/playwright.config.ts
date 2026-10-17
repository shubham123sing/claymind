/**
 * ClayMind XR end-to-end test (scripted emulated hands). Run from the repo root:
 *   npx --prefix client playwright test -c qa/e2e/playwright.config.ts
 * Needs a release build in client/dist (cd client && npm run build). The backend
 * (server, port 8790) is started if it is not already running.
 * Outputs (git-ignored): qa/recordings/<run>/ (video, step screenshots, console, network, fps, steps.json).
 */
import { defineConfig } from 'playwright/test';

const HEADED = process.env.QA_HEADED === '1';

export default defineConfig({
  testDir: '.',
  timeout: 30 * 60 * 1000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results',
  use: {
    baseURL: 'http://localhost:5191',
    viewport: { width: 1280, height: 720 },
    headless: !HEADED,
    launchOptions: {
      args: [
        // WebGL without a display: ANGLE on the GPU (d3d11 on Windows) or SwiftShader (QA_GL=swiftshader)
        `--use-angle=${process.env.QA_GL ?? (process.platform === 'win32' ? 'd3d11' : 'swiftshader')}`,
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        // a background tab must not be throttled (two players run side by side)
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: [
    {
      command: 'npx vite preview --port 5191 --strictPort',
      cwd: '../../client',
      env: { IWSDK_HTTP: '1' },
      url: 'http://localhost:5191',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: process.platform === 'win32' ? '.venv\\Scripts\\python -m agents.run' : '.venv/bin/python -m agents.run',
      cwd: '../../server',
      url: 'http://127.0.0.1:8790/v1/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
