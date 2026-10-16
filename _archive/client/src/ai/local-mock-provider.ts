/**
 * In-browser mock AI (no server, no network, no keys) for the static judge
 * build and offline play. Answers from local shape hints (it cannot see the
 * renders) with realistic latency, and "generates" models from the cached
 * sample GLBs shipped in public/samples. Same interface as the real thing, so
 * the whole pipeline (waiting UI, KG edges, caching, model swap) is exercised.
 */
import { AiProvider, DescribeRequest, DescribeResult, GenerateRequest } from './types.js';

const TYPICAL: Record<string, string[]> = {
  mug: ['glass', 'plastic', 'steel'], bowl: ['glass', 'wood', 'plastic'], plate: ['glass', 'plastic', 'wood'],
  vase: ['glass', 'stone', 'clay'], bottle: ['glass', 'plastic', 'steel'], can: ['steel', 'plastic'],
  ball: ['rubber', 'plastic', 'foam'], block: ['wood', 'plastic', 'stone'], ring: ['rubber', 'foam', 'plastic'],
  plank: ['wood', 'steel', 'plastic'],
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new Error('cancelled'));
    });
  });

export class LocalMockProvider implements AiProvider {
  readonly name = 'local-mock';
  readonly local = true;

  constructor(private samplesBase: string, private speed = 1) {}

  async describe(req: DescribeRequest, signal?: AbortSignal): Promise<DescribeResult> {
    await sleep(1200 / this.speed, signal);
    const h = req.hints;
    const cat = h.best_template && h.best_similarity >= 0.35 ? h.best_template : h.open_top > 0.55 ? 'bowl' : h.holes >= 1 ? 'ring' : 'sculpture';
    const typical = (TYPICAL[cat] ?? ['clay', 'stone', 'plastic']).filter((m) => req.materials.includes(m));
    const probs = [0.64, 0.24, 0.12];
    return {
      name: cat === 'sculpture' ? 'Sculpture' : cat[0].toUpperCase() + cat.slice(1),
      category: cat,
      confidence: Math.min(0.95, Math.max(0.3, (h.best_similarity || 0.4) + 0.15)),
      material: typical.map((name, i) => ({ name, prob: probs[i] ?? 0.05 })),
      parts: cat === 'mug' ? ['body', 'handle'] : ['body'],
      notes: 'offline mock (answers from local shape hints)',
      provider: this.name,
    };
  }

  async refine(image: string, _prompt: string, signal?: AbortSignal): Promise<string> {
    await sleep(300 / this.speed, signal);
    return image;
  }

  async generate(req: GenerateRequest, onProgress: (p: number) => void, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const total = 5000 / this.speed;
    for (let t = 0; t < total; t += 250) {
      onProgress(t / total);
      await sleep(250, signal);
    }
    const r = await fetch(`${this.samplesBase}${encodeURIComponent(req.category)}.glb`, { signal }).catch(() => null);
    if (!r || !r.ok) return null;
    const buf = await r.arrayBuffer();
    onProgress(1);
    return new TextDecoder().decode(new Uint8Array(buf, 0, 4)) === 'glTF' ? buf : null;
  }
}
