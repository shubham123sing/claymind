/**
 * The AI upgrade layer on top of the offline game. After "Bring to life" the
 * local object exists immediately; then, without blocking play:
 *   1. cache lookup (same shape again -> instant answer + model);
 *   2. render the sculpt -> vision model: name, category, material guesses;
 *   3. merge material evidence (local estimate + AI) -> material + KG `vlm` beliefs;
 *   4. for objects that kept the raw sculpt: image -> clean 3D model, with live
 *      progress on the object's label; the model swaps in when ready.
 * Any failure keeps the local result and says so in one line. Provider:
 *   ?ai=auto (default: server if reachable, else in-browser mock) | server | mock | off
 *   ?aiUrl=<base>  (default /api, proxied to server/ in dev)
 */
import { AssetManager, createSystem } from '@iwsdk/core';
import { bus } from '../core/event-bus.js';
import { estimateMaterial, MATERIALS, Priors } from '../materials/materials.js';
import type { Creation } from '../objects/creation.js';
import { TEMPLATES } from '../objects/templates.js';
import { aiCacheKey, getCached, putCached } from './ai-cache.js';
import { aiEnabled, AiMode, aiState } from './ai-state.js';
import { HttpAiProvider, probeServer } from './http-provider.js';
import { LocalMockProvider } from './local-mock-provider.js';
import { normalizeModel } from './model-normalize.js';
import { renderViews } from './snapshot-renderer.js';
import type { AiProvider, DescribeResult } from './types.js';

type Baked = Parameters<Parameters<typeof bus.on<'creation:baked'>>[1]>[0];

/** Templates are already clean; only replace the sculpt itself or weak matches. */
const MODEL_IF_MATCH_BELOW = 0.85;
/** Weight of the AI's material opinion vs. the local estimate. */
const AI_WEIGHT = 1;
const LOCAL_WEIGHT = 0.6;
const PRIVACY_KEY = 'claymind-ai-notice';

export class AiSystem extends createSystem({}) {
  private provider: AiProvider | null = null;
  private base = '/api';
  private running = new Map<string, AbortController>();
  private noticeShown = false;

  init(): void {
    const params = new URLSearchParams(location.search);
    aiState.mode = (params.get('ai') as AiMode) || 'auto';
    // relative by default: same origin (dev proxy); a static build without a server falls back to the mock
    this.base = params.get('aiUrl') ?? (import.meta.env.VITE_AI_URL as string | undefined) ?? './api';
    try {
      this.noticeShown = localStorage.getItem(PRIVACY_KEY) === '1';
    } catch {
      /* private mode */
    }
    void this.chooseProvider();
    this.cleanupFuncs.push(
      bus.on('creation:baked', (e) => void this.process(e)),
      bus.on('ai:toggle', () => {
        aiState.mode = aiState.mode === 'off' ? 'auto' : 'off';
        if (aiState.mode === 'off') for (const c of this.running.values()) c.abort();
        void this.chooseProvider();
      }),
    );
  }

  private async chooseProvider(): Promise<void> {
    const samples = `${import.meta.env.BASE_URL}samples/`;
    const mode = aiState.mode;
    if (mode === 'off') {
      this.provider = null;
      aiState.provider = 'none';
      return;
    }
    if (mode === 'mock') {
      this.provider = new LocalMockProvider(samples);
    } else {
      const health = await probeServer(this.base);
      aiState.serverUp = !!health;
      if (health) this.provider = new HttpAiProvider(this.base, health.mock ? 'server-mock' : 'server');
      else if (mode === 'auto') this.provider = new LocalMockProvider(samples); // static / offline build
      else this.provider = null;
    }
    aiState.provider = this.provider?.name ?? 'none';
    console.info(`[ai] mode ${mode}, provider ${aiState.provider}`);
  }

  private status(c: Creation, text: string): void {
    bus.emit('creation:ai-status', { creationId: c.id, text });
  }

  private async process(e: Baked): Promise<void> {
    if (!aiEnabled() || !this.provider) return;
    const provider = this.provider;
    const c = e.creation;
    const ctl = new AbortController();
    this.running.set(c.id, ctl);
    const t0 = performance.now();
    const key = aiCacheKey(c.descriptor, e.scale, provider.name);
    try {
      const cached = await getCached(key);
      if (cached) {
        aiState.stats.cacheHits++;
        this.applyDescribe(c, cached.describe);
        if (cached.glb) await this.applyModel(c, cached.glb, 'cache');
        this.status(c, '');
        return;
      }
      const notice = !provider.local && !this.noticeShown;
      this.status(c, notice ? '✦ AI is looking… (sculpt renders are sent to the AI service)' : '✦ AI is looking…');
      if (notice) this.markNoticeShown();
      // render on the next frame boundary, outside the XR render callback
      await new Promise((r) => setTimeout(r, 0));
      const images = renderViews(this.world.renderer, e.sculptGeometries);
      const best = e.ranking[0];
      const describe = await provider.describe(
        {
          images,
          materials: MATERIALS.map((m) => m.id),
          categories: TEMPLATES.map((t) => t.id),
          hints: { best_template: best?.id ?? null, best_similarity: best?.similarity ?? 0, size_cm: c.sizeCm, open_top: c.descriptor.openTop, holes: c.descriptor.holes },
        },
        ctl.signal,
      );
      aiState.stats.describes++;
      aiState.stats.lastDescribeMs = performance.now() - t0;
      this.applyDescribe(c, describe);

      let glb: ArrayBuffer | null = null;
      if (c.source !== 'template' || c.matchScore < MODEL_IF_MATCH_BELOW) {
        const t1 = performance.now();
        this.status(c, '✦ Making a clean model…');
        const prompt = `a clean studio product photo of a ${describe.name.toLowerCase()} made of ${c.materialId}, plain background`;
        const image = await provider.refine(images[0], prompt, ctl.signal);
        glb = await provider.generate(
          { image, category: describe.category, name: describe.name, size_cm: c.sizeCm },
          (p) => this.status(c, `✦ Making a clean model ${Math.round(p * 100)}%`),
          ctl.signal,
        );
        if (glb && (await this.applyModel(c, glb, 'ai'))) {
          aiState.stats.models++;
          aiState.stats.lastModelMs = performance.now() - t1;
        } else glb = null;
      }
      await putCached({ key, describe, glb, savedAt: Date.now() });
      this.status(c, '');
    } catch (err) {
      if (ctl.signal.aborted) {
        this.status(c, '');
        return;
      }
      aiState.stats.failures++;
      console.warn('[ai] falling back to the local result:', (err as Error).message);
      this.status(c, 'AI unavailable · kept the local result');
      setTimeout(() => this.status(c, ''), 4000);
    } finally {
      this.running.delete(c.id);
    }
  }

  private markNoticeShown(): void {
    this.noticeShown = true;
    try {
      localStorage.setItem(PRIVACY_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  /** Name, brain beliefs and material from the vision model's (validated) suggestion. */
  private applyDescribe(c: Creation, d: DescribeResult): void {
    if (d.confidence >= 0.5) c.name = d.name;
    bus.emit('creation:described', { creationId: c.id, result: d });
    const local: Priors = Object.fromEntries(c.materialGuesses.map((g) => [g.id, g.prob]));
    const ai: Priors = Object.fromEntries(d.material.map((m) => [m.name, m.prob]));
    const merged = estimateMaterial([{ priors: local, weight: LOCAL_WEIGHT }, { priors: ai, weight: AI_WEIGHT * Math.max(0.3, d.confidence) }]);
    c.materialGuesses = merged.slice(0, 4);
    bus.emit('creation:set-material', { creationId: c.id, materialId: merged[0].id, by: 'ai', confidence: merged[0].prob });
  }

  private async applyModel(c: Creation, glb: ArrayBuffer, source: 'ai' | 'cache'): Promise<boolean> {
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    try {
      const gltf = await AssetManager.loadGLTF(url, `ai-${c.id}`);
      const mesh = normalizeModel(gltf.scene, [c.sizeCm[0] / 100, c.sizeCm[1] / 100, c.sizeCm[2] / 100]);
      if (!mesh) return false;
      c.source = 'ai';
      c.sizeCm = [mesh.size[0] * 100, mesh.size[1] * 100, mesh.size[2] * 100];
      bus.emit('creation:model', { creationId: c.id, mesh, source });
      return true;
    } catch (err) {
      console.warn('[ai] model could not be loaded:', (err as Error).message);
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
