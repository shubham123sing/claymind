/**
 * Client-side AI types + response validation. AI output is a *suggestion*:
 * it is validated, clamped to known ids, and only then shown or stored.
 */
export interface MaterialProb {
  name: string;
  prob: number;
}

export interface DescribeResult {
  name: string;
  category: string;
  confidence: number;
  material: MaterialProb[];
  parts: string[];
  notes: string;
  cached?: boolean;
  provider?: string;
}

export interface LocalHints {
  best_template: string | null;
  best_similarity: number;
  size_cm: number[];
  open_top: number;
  holes: number;
}

export interface DescribeRequest {
  images: string[];
  materials: string[];
  categories: string[];
  hints: LocalHints;
}

export interface GenerateRequest {
  image: string;
  category: string;
  name: string;
  size_cm: number[];
}

/** Validate an untrusted describe response; returns null if unusable. */
export function validateDescribe(raw: unknown, allowedMaterials: string[]): DescribeResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null);
  const name = str(r.name, 40), category = str(r.category, 40);
  if (!name || !category) return null;
  const confidence = typeof r.confidence === 'number' && isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0.5;
  const mats = Array.isArray(r.material) ? r.material : [];
  const material: MaterialProb[] = [];
  for (const m of mats) {
    if (!m || typeof m !== 'object') continue;
    const { name: mn, prob } = m as Record<string, unknown>;
    if (typeof mn !== 'string' || !allowedMaterials.includes(mn) || typeof prob !== 'number' || !isFinite(prob) || prob < 0) continue;
    material.push({ name: mn, prob });
  }
  if (!material.length) return null;
  const total = material.reduce((a, m) => a + m.prob, 0) || 1;
  for (const m of material) m.prob /= total;
  material.sort((a, b) => b.prob - a.prob);
  return {
    name,
    category: category.toLowerCase(),
    confidence,
    material: material.slice(0, 4),
    parts: Array.isArray(r.parts) ? r.parts.filter((p): p is string => typeof p === 'string').slice(0, 8) : [],
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 200) : '',
    cached: r.cached === true,
    provider: typeof r.provider === 'string' ? r.provider : undefined,
  };
}

export interface AiProvider {
  readonly name: string;
  /** True for providers that cost nothing and need no network. */
  readonly local: boolean;
  describe(req: DescribeRequest, signal?: AbortSignal): Promise<DescribeResult>;
  /** Optional cleanup step; returns a data URL (pass-through when unsupported). */
  refine(image: string, prompt: string, signal?: AbortSignal): Promise<string>;
  /** Image -> textured model. Resolves with GLB bytes, or null when the provider has no model for it. */
  generate(req: GenerateRequest, onProgress: (p: number) => void, signal?: AbortSignal): Promise<ArrayBuffer | null>;
}

export class AiError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}
