/**
 * Integration check: the game's HttpAiProvider against a running server
 * (default http://127.0.0.1:8787, mock providers). Run:
 *   npx vite-node tests/integration/server-roundtrip.ts [baseUrl]
 */
import { HttpAiProvider, probeServer } from '../../src/ai/http-provider';
import { MATERIALS } from '../../src/materials/materials';
import { TEMPLATES } from '../../src/objects/templates';

// node has no sessionStorage; the provider falls back to 'anon'
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const health = await probeServer(base);
console.log('health', health);
if (!health) process.exit(1);
const p = new HttpAiProvider(base);
const req = {
  images: [PNG], materials: MATERIALS.map((m) => m.id), categories: TEMPLATES.map((t) => t.id),
  hints: { best_template: 'mug', best_similarity: 0.62, size_cm: [11, 10, 8], open_top: 0.9, holes: 1 },
};
let t = performance.now();
const d1 = await p.describe(req);
console.log(`describe: ${d1.name}/${d1.category} ${(d1.confidence * 100).toFixed(0)}% ${d1.material.map((m) => `${m.name} ${(m.prob * 100).toFixed(0)}%`).join(', ')} cached=${d1.cached} ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
const d2 = await p.describe(req);
console.log(`describe again: cached=${d2.cached} ${(performance.now() - t).toFixed(0)} ms`);
const refined = await p.refine(PNG, 'a clean mug');
console.log('refine ok', refined.startsWith('data:image/'));
t = performance.now();
const progress: number[] = [];
const glb = await p.generate({ image: refined, category: d1.category, name: d1.name, size_cm: [11, 10, 8] }, (x) => progress.push(Math.round(x * 100)));
console.log(`generate: ${glb ? `${glb.byteLength} bytes GLB` : 'no model'} in ${((performance.now() - t) / 1000).toFixed(1)} s, progress ${[...new Set(progress)].join(',')}`);
t = performance.now();
const glb2 = await p.generate({ image: refined, category: d1.category, name: d1.name, size_cm: [11, 10, 8] }, () => {});
console.log(`generate again (cache): ${glb2?.byteLength} bytes in ${((performance.now() - t) / 1000).toFixed(2)} s`);
const none = await p.generate({ image: PNG, category: 'spaceship', name: 'x', size_cm: [] }, () => {});
console.log('unknown category ->', none === null ? 'null (client keeps local object)' : 'model?!');
