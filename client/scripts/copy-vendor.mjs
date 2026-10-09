// Copies runtime files that must be served locally (no CDN at play time).
import { cpSync, mkdirSync } from 'node:fs';
const dest = 'public/vendor/mediapipe/wasm';
mkdirSync(dest, { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', dest, { recursive: true });
console.log('[vendor] mediapipe wasm ->', dest);
