/**
 * Minimal promise wrapper over IndexedDB (one database, key-value stores).
 * Falls back to an in-memory map when IndexedDB is unavailable (private mode,
 * tests), so the game never fails because storage failed.
 */
const DB_NAME = 'claymind';
const DB_VERSION = 4;
/** creations: the Library (only what the player added) · room: pinned creations, put back after a reload · kit, sets: the Play Kit. */
export const STORES = ['kg', 'creations', 'settings', 'ai', 'room', 'kit', 'sets'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // another tab still holds the old version open: play on with memory storage
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(`${store}/${key}`) as T | undefined;
  return new Promise((resolve) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    memory.set(`${store}/${key}`, value);
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Every value in a store. */
export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  if (!db) return [...memory.entries()].filter(([k]) => k.startsWith(`${store}/`)).map(([, v]) => v as T);
  return new Promise((resolve) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => resolve([]);
  });
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  if (!db) {
    memory.delete(`${store}/${key}`);
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
