/**
 * `.claymind.json`: a Library item as a file that ClayMind can import again
 * (all pieces, paint, colliders, shards, materials, colours, name, thumbnail).
 * Typed arrays are stored as base64. Import checks the shape before anything is
 * used and refuses files over 10 MB or anything that is not a ClayMind project.
 */
import { normalizeMaterialId } from '../materials/materials.js';
import { LIBRARY_SCHEMA, SavedCreation } from '../storage/library.js';

export const PROJECT_FORMAT = 'claymind-project';
export const PROJECT_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type Typed = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int32Array;
const TYPES: Record<string, new (b: ArrayBuffer) => Typed> = { Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array };

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): ArrayBuffer {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export function projectToJson(item: SavedCreation): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, item }, (_k, v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const t = v as Typed;
      return { $typed: t.constructor.name, b64: toB64(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)) };
    }
    return v;
  });
}

export class ImportError extends Error {}

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const isVec = (x: unknown, n: number) => Array.isArray(x) && x.length === n && x.every(isNum);

/** Parse and check a project file; throws ImportError with a player-readable reason. */
export function projectFromJson(text: string): SavedCreation {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('File too large (over 10 MB)');
  let data: unknown;
  try {
    data = JSON.parse(text, (_k, v) => {
      if (v && typeof v === 'object' && typeof v.$typed === 'string' && typeof v.b64 === 'string') {
        const T = TYPES[v.$typed];
        if (!T) throw new ImportError('Unknown data in the file');
        return new T(fromB64(v.b64));
      }
      return v;
    });
  } catch (e) {
    throw e instanceof ImportError ? e : new ImportError('Not a ClayMind project file');
  }
  const d = data as { format?: unknown; version?: unknown; item?: SavedCreation };
  if (d?.format !== PROJECT_FORMAT) throw new ImportError('Not a ClayMind project file');
  if (d.version !== PROJECT_VERSION) throw new ImportError('Made by a newer ClayMind');
  const s = d.item;
  if (!s || s.schemaVersion !== LIBRARY_SCHEMA || typeof s.id !== 'string') throw new ImportError('Damaged project file');
  if (!s.creation || typeof s.creation.name !== 'string' || !Array.isArray(s.creation.parts)) throw new ImportError('Damaged project file');
  if (!Array.isArray(s.parts) || s.parts.length < 1 || s.parts.length > 8) throw new ImportError('Damaged project file');
  for (const p of s.parts) {
    const pos = p?.mesh?.positions, nor = p?.mesh?.normals;
    if (!(pos instanceof Float32Array) || pos.length === 0 || pos.length % 9 !== 0) throw new ImportError('Damaged project file');
    if (!(nor instanceof Float32Array) || nor.length !== pos.length) throw new ImportError('Damaged project file');
    if (p.mesh.paint !== undefined && !(p.mesh.paint instanceof Uint8Array && p.mesh.paint.length === (pos.length / 3) * 4)) throw new ImportError('Damaged project file');
    if (!pos.every(Number.isFinite)) throw new ImportError('Damaged project file');
    if (typeof p.materialId !== 'string' || !isVec(p.frame?.p, 3) || !isVec(p.frame?.q, 4) || !Array.isArray(p.shards)) throw new ImportError('Damaged project file');
    if (p.color !== null && typeof p.color !== 'string') throw new ImportError('Damaged project file');
    p.materialId = normalizeMaterialId(p.materialId);
  }
  if (typeof s.thumb !== 'string' || !s.thumb.startsWith('data:image/')) s.thumb = '';
  s.pinned = false;
  s.creation.name = s.creation.name.slice(0, 40) || 'Imported clay';
  return s;
}

/** Save bytes as a file: Blob + <a download>. */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** File-system-safe base name. */
export function fileBase(name: string): string {
  return name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 40) || 'claymind';
}
