import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests do not boot the IWSDK dev plugin.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts', 'tests/physics/**/*.test.ts', 'tests/eval/**/*.test.ts'],
    // geometry/physics tests take ~1 s alone but can pass 5 s on a busy machine (dev server + browser running)
    testTimeout: 20000, environment: 'node' },
});
