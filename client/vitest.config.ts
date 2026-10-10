import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests do not boot the IWSDK dev plugin.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts', 'tests/physics/**/*.test.ts'], environment: 'node' },
});
