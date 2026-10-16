/**
 * AI provider backed by the ClayMind server (server/). Timeouts, retries with
 * exponential backoff for transient failures (network / 5xx / 429), abort on
 * cancel, and response validation. API keys never touch the browser.
 */
import { AiError, AiProvider, DescribeRequest, DescribeResult, GenerateRequest, validateDescribe } from './types.js';

const SESSION = (() => {
  try {
    let id = sessionStorage.getItem('claymind-session');
    if (!id) {
      id = Math.random().toString(36).slice(2);
      sessionStorage.setItem('claymind-session', id);
    }
    return id;
  } catch {
    return 'anon';
  }
})();

export async function fetchJson(
  url: string, init: RequestInit & { timeoutMs?: number; retries?: number } = {}, signal?: AbortSignal,
): Promise<unknown> {
  const { timeoutMs = 30_000, retries = 2, ...rest } = init;
  let attempt = 0;
  for (;;) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...rest, signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Session': SESSION, ...(rest.headers ?? {}) } });
      if (r.ok) return await r.json();
      const retryable = r.status >= 500 || r.status === 429;
      const detail = await r.json().then((j) => (j as { detail?: string }).detail).catch(() => '');
      throw new AiError(`${r.status} ${detail ?? ''}`.trim(), retryable);
    } catch (e) {
      if (signal?.aborted) throw new AiError('cancelled');
      const err = e instanceof AiError ? e : new AiError(ctl.signal.aborted ? 'timeout' : 'network error', true);
      if (!err.retryable || attempt >= retries) throw err;
      attempt++;
      await new Promise((res) => setTimeout(res, 400 * 2 ** attempt + Math.random() * 200));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export class HttpAiProvider implements AiProvider {
  readonly name: string;
  readonly local = false;

  constructor(private base: string, providerName = 'server') {
    this.name = providerName;
  }

  async describe(req: DescribeRequest, signal?: AbortSignal): Promise<DescribeResult> {
    const raw = await fetchJson(`${this.base}/vlm/describe`, { method: 'POST', body: JSON.stringify(req), timeoutMs: 60_000 }, signal);
    const v = validateDescribe(raw, req.materials);
    if (!v) throw new AiError('invalid describe response');
    return v;
  }

  async refine(image: string, prompt: string, signal?: AbortSignal): Promise<string> {
    const raw = (await fetchJson(`${this.base}/image/refine`, { method: 'POST', body: JSON.stringify({ image, prompt }), timeoutMs: 90_000 }, signal)) as { image?: unknown };
    if (typeof raw.image !== 'string' || !raw.image.startsWith('data:image/')) throw new AiError('invalid refine response');
    return raw.image;
  }

  async generate(req: GenerateRequest, onProgress: (p: number) => void, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    let job = (await fetchJson(`${this.base}/model/generate`, { method: 'POST', body: JSON.stringify(req) }, signal)) as Job;
    const t0 = performance.now();
    while (job.status === 'queued' || job.status === 'running') {
      onProgress(job.progress ?? 0);
      if (performance.now() - t0 > 600_000) throw new AiError('generation timeout');
      await new Promise((res) => setTimeout(res, 1000));
      if (signal?.aborted) throw new AiError('cancelled');
      job = (await fetchJson(`${this.base}/model/jobs/${job.id}`, { timeoutMs: 15_000 }, signal)) as Job;
    }
    if (job.status !== 'done' || !job.result_url) return null;
    onProgress(1);
    const r = await fetch(`${this.base}${job.result_url}`, { signal });
    if (!r.ok) throw new AiError(`model download ${r.status}`, true);
    const buf = await r.arrayBuffer();
    if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') throw new AiError('not a GLB');
    return buf;
  }
}

interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress?: number;
  result_url?: string | null;
  error?: string | null;
}

/** Probe the server; resolves with its health JSON or null (never throws). */
export async function probeServer(base: string, timeoutMs = 1500): Promise<{ mock: boolean; providers: Record<string, string> } | null> {
  try {
    const h = (await fetchJson(`${base}/health`, { timeoutMs, retries: 0 })) as { ok?: boolean; mock?: boolean; providers?: Record<string, string> };
    return h.ok ? { mock: !!h.mock, providers: h.providers ?? {} } : null;
  } catch {
    return null;
  }
}
