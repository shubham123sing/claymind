/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

export default defineConfig({
  // IWSDK_HTTP=1 serves plain HTTP (localhost is still a secure context) for
  // tools that cannot accept the self-signed dev certificate.
  plugins: [iwsdkDev(process.env.IWSDK_HTTP === '1' ? { https: false } : {})],
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    // dev: /api -> the local AI server (server/, `uvicorn app.main:app --port 8787`)
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: {
      input: {
        main: './index.html',
        sdf: './spikes/sdf.html',
        hands: './spikes/hands.html',
      },
    },
  },
  worker: { format: 'es' },
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
