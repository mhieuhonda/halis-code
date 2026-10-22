/**
 * Local-first JSON storage on IndexedDB — the mobile replacement for the
 * desktop app's userData JSON files. One KV store, keys are plain strings;
 * sessions use the `session:<id>` prefix so listing is a range scan.
 */

const DB_NAME = 'halis'
const STORE = 'kv'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const store = t.objectStore(STORE)
        let request: IDBRequest<T> | void
        try {
          request = run(store)
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        t.oncomplete = () => resolve(request && 'result' in request ? request.result : (undefined as T))
        t.onerror = () => reject(t.error ?? new Error('indexedDB transaction failed'))
        t.onabort = () => reject(t.error ?? new Error('indexedDB transaction aborted'))
      }),
  )
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await tx<T | undefined>('readonly', (store) => store.get(key))
    return value === undefined ? fallback : (value as T)
  } catch {
    return fallback
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await tx('readwrite', (store) => {
    store.put(value, key)
  })
}

export async function kvDelete(key: string): Promise<void> {
  await tx('readwrite', (store) => {
    store.delete(key)
  })
}

/** All keys carrying a prefix, in stored order. */
export async function kvKeys(prefix: string): Promise<string[]> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))
    return keys.map(String)
  } catch {
    return []
  }
}

/** JSON helpers shaped like the desktop readJson/writeJson pair. */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  return kvGet<T>(key, fallback)
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  return kvSet(key, value)
}
