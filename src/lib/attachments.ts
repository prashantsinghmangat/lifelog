/**
 * Photos attached to an entry, kept entirely on this device.
 *
 * A dedicated IndexedDB store, indexed by `entryId` rather than keyed by it —
 * one entry can hold more than one photo. Nothing here is read or written by
 * `useEntries.ts`, so a photo can never reach `entries.data`, Supabase, an
 * export or a backup. `id` is generated here, never taken from the picked
 * file's name: a camera or gallery file's name is arbitrary and sometimes
 * reused, so it cannot double as a stable key.
 */
export type Attachment = {
  id: string
  entryId: string
  blob: Blob
  createdAt: string
}

const DB_NAME = 'lifelog-attachments'
const STORE = 'attachments'
const ENTRY_INDEX = 'entryId'

const changed = new EventTarget()

/** Runs after a write actually commits, so a UI watching for changes never fires early. */
function notifyChanged(): void {
  changed.dispatchEvent(new Event('change'))
}

/** Subscribes to every put/remove; returns the function that stops listening. */
export function onChange(listener: () => void): () => void {
  changed.addEventListener('change', listener)
  return () => changed.removeEventListener('change', listener)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex(ENTRY_INDEX, 'entryId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open the attachments database'))
  })
}

/**
 * One transaction, one request. Resolves on `tx.oncomplete` rather than the
 * request's own `onsuccess`, so a write is durable — and a listener notified
 * — only once it has actually committed, never while it could still fail.
 */
function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        let result: T
        request.onsuccess = () => {
          result = request.result
        }
        request.onerror = () => reject(request.error ?? new Error('Attachment request failed'))
        tx.onerror = () => reject(tx.error ?? new Error('Attachment transaction failed'))
        tx.oncomplete = () => {
          if (mode === 'readwrite') notifyChanged()
          resolve(result)
        }
      }),
  )
}

/** Stores one photo for an entry, under an id this module generates. */
export async function put(entryId: string, blob: Blob): Promise<Attachment> {
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    entryId,
    blob,
    createdAt: new Date().toISOString(),
  }
  await run('readwrite', (store) => store.add(attachment))
  return attachment
}

/** An entry's photos, oldest first. */
export function list(entryId: string): Promise<Attachment[]> {
  return openDb().then(
    (db) =>
      new Promise<Attachment[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const index = tx.objectStore(STORE).index(ENTRY_INDEX)
        const found: Attachment[] = []
        const request = index.openCursor(IDBKeyRange.only(entryId))
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            found.push(cursor.value as Attachment)
            cursor.continue()
          }
        }
        request.onerror = () => reject(request.error ?? new Error('Failed to list attachments'))
        tx.oncomplete = () => resolve(found.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        tx.onerror = () => reject(tx.error ?? new Error('Failed to list attachments'))
      }),
  )
}

/** Deletes one photo. */
export function remove(id: string): Promise<void> {
  return run('readwrite', (store) => store.delete(id))
}

/** Deletes every photo belonging to one entry. */
export async function removeAll(entryId: string): Promise<void> {
  const photos = await list(entryId)
  for (const photo of photos) await remove(photo.id)
}

/** Every entry id that currently has at least one stored photo. */
function storedEntryIds(): Promise<Set<string>> {
  return openDb().then(
    (db) =>
      new Promise<Set<string>>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const index = tx.objectStore(STORE).index(ENTRY_INDEX)
        const ids = new Set<string>()
        // `nextunique` walks one entry per distinct key, so this is one pass
        // over the index rather than one read per stored photo.
        const request = index.openKeyCursor(undefined, 'nextunique')
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            ids.add(cursor.key as string)
            cursor.continue()
          }
        }
        request.onerror = () =>
          reject(request.error ?? new Error('Failed to read attachment entry ids'))
        tx.oncomplete = () => resolve(ids)
        tx.onerror = () => reject(tx.error ?? new Error('Failed to read attachment entry ids'))
      }),
  )
}

/**
 * Which entries in `entryIds` have a stored photo — one pass over the index,
 * not one IndexedDB read per row, so a 100-row day never becomes 100 queries.
 */
export async function hasPhotoMap(entryIds: string[]): Promise<Record<string, boolean>> {
  const stored = await storedEntryIds()
  const map: Record<string, boolean> = {}
  for (const id of entryIds) map[id] = stored.has(id)
  return map
}

/**
 * Stored entry ids no longer present in the live log — safe to delete.
 *
 * Pure and IndexedDB-free: the only thing that decides whether a photo is an
 * orphan is the live id set it's handed, so a caller that skips this on a
 * failed load (rather than passing it an empty live set) is what keeps a
 * network hiccup from reading as "every entry was deleted."
 */
export function orphansOf(storedIds: Iterable<string>, liveIds: Iterable<string>): string[] {
  const live = new Set(liveIds)
  return [...new Set(storedIds)].filter((id) => !live.has(id))
}

/** Deletes every photo whose entry is no longer in the live log. */
export async function sweepOrphans(liveEntryIds: string[]): Promise<void> {
  const stored = await storedEntryIds()
  for (const entryId of orphansOf(stored, liveEntryIds)) await removeAll(entryId)
}
