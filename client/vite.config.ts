/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, Plugin } from 'vite';

/**
 * IWSDK's physics worker imports its Havok runtime as `./physics-runtime.js`.
 * Point that one import at ClayMind's extended runtime (compound shapes,
 * collision events: see src/physics/runtime). Nothing else in IWSDK changes.
 */
function claymindPhysicsRuntime(): Plugin {
  const ext = fileURLToPath(new URL('./src/physics/runtime/physics-runtime-ext.ts', import.meta.url));
  const worker = /[\\/]@iwsdk[\\/]core[\\/]dist[\\/]physics[\\/]physics-worker\.js/;
  return {
    name: 'claymind-physics-runtime',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './physics-runtime.js' && importer && worker.test(importer.split('?')[0])) return ext;
      return null;
    },
  };
}

/**
 * UIKitML imports the whole Lucide icon set to register every icon; ClayMind's panels use two.
 * That one import (from @drawcall/uikitml) gets src/ui/lucide-subset.ts instead (V6, R3: cold start).
 */
function lucideSubset(): Plugin {
  const subset = fileURLToPath(new URL('./src/ui/lucide-subset.ts', import.meta.url));
  return {
    name: 'claymind-lucide-subset',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '@pmndrs/uikit-lucide' && importer && /[\\/]@drawcall[\\/]uikitml[\\/]/.test(importer)) return subset;
      return null;
    },
  };
}

/**
 * IWSDK fetches the hand models from cdn.jsdelivr.net. The two generic-hand models ship with the app
 * (public/input-profiles, MIT, @webxr-input-profiles/assets 1.0.20), so the release needs no outside
 * host (V6, R2). Controller models, which ClayMind does not use, still come from the CDN.
 */
function localHands(): Plugin {
  const adapter = /[\\/]@iwsdk[\\/]xr-input[\\/]dist[\\/]visual[\\/]adapter[\\/]base-visual-adapter\.js/;
  const from = '`${DEFAULT_PROFILES_PATH}/${profileId}/';
  return {
    name: 'claymind-local-hands',
    enforce: 'pre',
    transform(code, id) {
      if (!adapter.test(id.split('?')[0]) || !code.includes(from)) return null;
      return code.replace(from, "`${profileId === 'generic-hand' ? './input-profiles' : DEFAULT_PROFILES_PATH}/${profileId}/");
    },
  };
}

/** Build id shown in Settings -> About (V6 gap 4): the commit and the build date, so a report names the exact build. */
function buildId(): string {
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'local';
    }
  }
  return `${sha} ${new Date().toISOString().slice(0, 10)}`;
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // IWSDK_HTTP=1 serves plain HTTP (localhost is still a secure context) for
  // tools that cannot accept the self-signed dev certificate.
  plugins: [claymindPhysicsRuntime(), lucideSubset(), localHands(), iwsdkDev(process.env.IWSDK_HTTP === '1' ? { https: false } : {})],
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      input: { main: './index.html' },
    },
  },
  // workers are bundled separately: they need the runtime swap too
  worker: { format: 'es', plugins: () => [claymindPhysicsRuntime()] },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
