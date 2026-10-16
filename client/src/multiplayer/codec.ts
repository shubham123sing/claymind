/**
 * Wire format for snapshots: typed arrays as gzip + base64 (the clay grid compresses well:
 * most samples sit at the clamped band value), everything else as JSON.
 */

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function packArray(a: Float32Array | Uint8Array): Promise<string> {
  return toBase64(await gzip(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)));
}

export async function unpackFloats(s: string): Promise<Float32Array> {
  const b = await gunzip(fromBase64(s));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

export async function unpackBytes(s: string): Promise<Uint8Array> {
  return gunzip(fromBase64(s));
}

type Typed = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int32Array;
const KINDS: [string, new (b: ArrayBuffer) => Typed][] = [['f32', Float32Array], ['u8', Uint8Array], ['u16', Uint16Array], ['u32', Uint32Array], ['i32', Int32Array]];

/** Any JSON-like value with typed arrays inside (a kit toy's parts) -> JSON with packed arrays. */
export async function packDeep(v: unknown): Promise<unknown> {
  for (const [tag, C] of KINDS) if (v instanceof C) return { __ta: tag, d: await packArray(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return Promise.all(v.map(packDeep));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = await packDeep(x);
    return out;
  }
  return v;
}

export async function unpackDeep(v: unknown): Promise<unknown> {
  if (Array.isArray(v)) return Promise.all(v.map(unpackDeep));
  if (v && typeof v === 'object') {
    const o = v as { __ta?: string; d?: string };
    if (o.__ta && typeof o.d === 'string') {
      const bytes = await unpackBytes(o.d), C = KINDS.find(([t]) => t === o.__ta)?.[1] ?? Uint8Array;
      return new C(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = await unpackDeep(x);
    return out;
  }
  return v;
}
