import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { aiCacheKey } from '../../src/ai/ai-cache';
import { fetchJson } from '../../src/ai/http-provider';
import { LocalMockProvider } from '../../src/ai/local-mock-provider';
import { normalizeModel } from '../../src/ai/model-normalize';
import { validateDescribe } from '../../src/ai/types';
import { weld, writeGlb } from '../../src/objects/glb';
import { bakeFromSdf } from '../../src/objects/bake';
import type { ShapeDescriptor } from '../../src/objects/descriptor';

const MATS = ['ceramic', 'glass', 'rubber'];
const D: ShapeDescriptor = { aspect: 0.9, elong: 0.78, fill: 0.2, openTop: 0.9, holes: 1, profile: [1, 1, 1, 1, 1], angle: 0, center: [0, 0, 0], extents: [0.1, 0.09, 0.08], volume: 1e-4 };

describe('AI response validation', () => {
  it('accepts a valid answer, normalises probabilities and drops unknown materials', () => {
    const v = validateDescribe({ name: ' Mug ', category: 'MUG', confidence: 1.4, material: [{ name: 'ceramic', prob: 3 }, { name: 'unobtainium', prob: 1 }, { name: 'glass', prob: 1 }] }, MATS)!;
    expect(v.name).toBe('Mug');
    expect(v.category).toBe('mug');
    expect(v.confidence).toBe(1);
    expect(v.material.map((m) => m.name)).toEqual(['ceramic', 'glass']);
    expect(v.material[0].prob).toBeCloseTo(0.75, 6);
  });

  it('rejects unusable answers', () => {
    expect(validateDescribe(null, MATS)).toBeNull();
    expect(validateDescribe({ name: '', category: 'x', material: [{ name: 'ceramic', prob: 1 }] }, MATS)).toBeNull();
    expect(validateDescribe({ name: 'X', category: 'x', material: [{ name: 'lava', prob: 1 }] }, MATS)).toBeNull();
  });
});

describe('AI cache key', () => {
  it('is stable for near-identical shapes and differs for different ones', () => {
    const a = aiCacheKey(D, 1, 'p');
    const b = aiCacheKey({ ...D, aspect: 0.91, extents: [0.1005, 0.0902, 0.0801] }, 1, 'p');
    expect(a).toBe(b);
    expect(aiCacheKey({ ...D, openTop: 0.1 }, 1, 'p')).not.toBe(a);
    expect(aiCacheKey(D, 1.5, 'p')).not.toBe(a); // size matters
    expect(aiCacheKey(D, 1, 'other')).not.toBe(a);
  });
});

describe('in-browser mock provider', () => {
  it('answers from local hints within the allowed materials', async () => {
    const p = new LocalMockProvider('/samples/', 100);
    const r = await p.describe({ images: ['data:image/png;base64,x'], materials: MATS, categories: ['mug'], hints: { best_template: 'mug', best_similarity: 0.6, size_cm: [10, 9, 8], open_top: 0.9, holes: 1 } });
    expect(r.category).toBe('mug');
    expect(r.material.every((m) => MATS.includes(m.name))).toBe(true);
  });
});

describe('fetchJson retry policy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries transient errors and gives up on client errors', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls < 3 ? new Response('{}', { status: 503 }) : new Response('{"ok":true}', { status: 200 });
    }));
    expect(await fetchJson('/x', { retries: 3 })).toEqual({ ok: true });
    expect(calls).toBe(3);
    calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return new Response('{"detail":"bad"}', { status: 400 });
    }));
    await expect(fetchJson('/x', { retries: 3 })).rejects.toThrow('400');
    expect(calls).toBe(1);
  });
});

describe('GLB writer -> GLTFLoader -> normalise', () => {
  it('round-trips a baked mesh and scales it to the target size', async () => {
    const r = 0.03;
    const baked = bakeFromSdf((x, y, z) => Math.hypot(x, y, z) - r, 2 * r, { res: 32, pieces: 0 });
    const w = weld(baked.mesh.positions, baked.mesh.normals);
    expect(w.positions.length).toBeLessThan(baked.mesh.positions.length / 3); // welding shares vertices
    const glb = writeGlb({ ...w, color: [1, 0.5, 0.2, 1], roughness: 0.5, metalness: 0 });
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    let tris = 0;
    gltf.scene.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; geometry?: { index: { count: number } } };
      if (m.isMesh) tris += m.geometry!.index.count / 3;
    });
    expect(tris).toBe(baked.mesh.positions.length / 9);
    // a 12 x 12 x 12 cm target box: the sphere is scaled to 12 cm and centred
    const norm = normalizeModel(gltf.scene, [0.12, 0.12, 0.12])!;
    let max = 0;
    for (let i = 0; i < norm.positions.length; i++) max = Math.max(max, Math.abs(norm.positions[i]));
    expect(max).toBeCloseTo(0.06, 2);
    // a flat 20 x 5 x 20 cm target keeps the bbox volume: cbrt(2000) ~ 12.6 cm cube
    const flat = normalizeModel(gltf.scene, [0.2, 0.05, 0.2])!;
    expect(flat.size[0] * flat.size[1] * flat.size[2]).toBeCloseTo(0.2 * 0.05 * 0.2, 5);
  });
});
