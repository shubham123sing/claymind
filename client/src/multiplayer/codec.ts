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
