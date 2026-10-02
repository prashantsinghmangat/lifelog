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
  /** Absent means a photo — every record before this field existed is one. */
  kind?: 'document'
  mimeType?: string
  name?: string
}

const DB_NAME = 'lifelog-attachments'
const STORE = 'attachments'
const ENTRY_INDEX = 'entryId'

/** Longest side a stored photo is allowed to keep — a camera original is easily 4000px+. */
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

/**
 * How many photos one entry may hold. Ten is room for every receipt a day
 * produces; past it a batch stops being proof of an entry and starts being a
 * gallery, which is not what this store is for. Enforced by both pickers —
 * the composer's strip and the editor's — never by the store itself, so a
 * record already over the line (there are none, but honesty) still lists.
 */
export const MAX_PHOTOS_PER_ENTRY = 10

/** What the Document button accepts — PDF plus the common office formats. */
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])
/** Some Android pickers hand back a blank or generic `type` — the extension is the fallback. */
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx'])
/** Documents skip the photo pipeline's downscale, so this is the only thing capping their size. */
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024

/** Whether a picked file is one of the document types this app will store. */
export function acceptedDocument(file: File): boolean {
  if (DOCUMENT_MIME_TYPES.has(file.type)) return true
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension !== undefined && DOCUMENT_EXTENSIONS.has(extension)
}

/**
 * What an image of this size is stored at: capped on the longest side, aspect
 * ratio kept, never scaled *up*. Pulled out of `fromFile` because it is the
 * only part of the pipeline that is arithmetic rather than browser plumbing,
 * and therefore the only part a test can reach — `getContext('2d')` returns
 * null under jsdom, so the encode itself needs a real browser.
 */
export function targetSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Decodes, downscales to at most `MAX_DIMENSION` on the longest side, and
 * re-encodes as JPEG — so a multi-MB camera original never lands in IndexedDB
 * whole. Lives here rather than in the hook because a photo can now be picked
 * before the entry exists: the composer stages files and the editor saves them
 * against a row, and both have to produce the same bytes.
 */
/**
 * A gap wide enough for the browser to paint.
 *
 * An animation frame alone only schedules work; the macrotask after it is what
 * lets the frame actually land, and lets native memory from the last decode go
 * before the next one asks for its own.
 */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}

/**
 * Decoding, with one second chance.
 *
 * A 12MP photo is ~48MB of **native** memory — invisible to `usedJSHeapSize`,
 * and the first thing to run out on a phone part-way through a batch. A decode
 * that fails for that reason usually succeeds once the previous one's memory
 * has actually been returned, so the retry pauses first rather than asking
 * again immediately. One retry, never a loop: a file the device genuinely
 * cannot decode must still fail quickly.
 */
async function decode(source: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 150))
    return await createImageBitmap(source)
  }
}

/**
 * The picked files' bytes, read now rather than when each one's turn to
 * decode comes round. Android's picker hands back content-URI-backed `File`
 * handles whose read grant can go stale while earlier photos in the batch are
 * still decoding — the retry in `decode` then re-reads the same dead handle.
 * A copy in memory cannot go stale. One `null` per unreadable file, in place,
 * so the caller can still say which photo was lost rather than losing the
 * whole batch to one bad handle.
 */
export async function snapshot(files: readonly File[]): Promise<(File | null)[]> {
  const copies: (File | null)[] = []
  for (const file of files) {
    try {
      const bytes = await file.arrayBuffer()
      // A `File` again, not a bare `Blob`: `useAttachments.add` reads a bare
      // blob as "already through this pipeline" — the camera's shape.
      copies.push(new File([bytes], file.name, { type: file.type }))
    } catch {
      copies.push(null)
    }
  }
  return copies
}

/** The downscaled drawing, on a canvas the caller will encode and then zero. */
function draw(
  image: ImageBitmap | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const { width, height } = targetSize(sourceWidth, sourceHeight)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is not available')
  ctx.drawImage(image, 0, 0, width, height)
  return canvas
}

async function rasterise(source: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap | null
  try {
    bitmap = await decode(source)
  } catch {
    bitmap = null
  }

  if (bitmap !== null) {
    try {
      return draw(bitmap, bitmap.width, bitmap.height)
    } finally {
      // **The second of two camera photos used to be lost here.** An
      // `ImageBitmap` holds native memory that garbage collection does not
      // hurry to reclaim, and a 12MP photo decodes to roughly 48MB of it. Two
      // attached together meant the second `createImageBitmap` asking a WebView
      // heap the first one was still holding — it failed, and the entry saved
      // with one of the two photos it was given. Released the moment it has
      // been drawn, and in a `finally` because a throw between here and there
      // leaks it just as effectively as forgetting to call it.
      bitmap.close()
    }
  }

  // `createImageBitmap` refused twice. The `<img>` pipeline is the decoder
  // the WebView already trusts for every page it renders, and under memory
  // pressure it keeps working after the bitmap API has given up — the last
  // thing to try before telling the user their photo is lost.
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return draw(image, image.naturalWidth, image.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function fromFile(source: Blob): Promise<Blob> {
  const canvas = await rasterise(source)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // The JPEG is made; the canvas's own backing store (1600×1200 RGBA is
        // ~7.7MB) has no further use. Zeroing it frees that now rather than
        // whenever collection happens to come round, which across a batch is
        // the difference between flat and climbing native memory.
        canvas.width = 0
        canvas.height = 0
        if (blob) resolve(blob)
        else reject(new Error('the image could not be encoded — it may be too large'))
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

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

/**
 * Stores a document for an entry — the file's own bytes, unlike a photo there
 * is no recompress step to shrink it first, so size and type are checked here
 * instead.
 */
export async function putDocument(entryId: string, file: File): Promise<Attachment> {
  if (!acceptedDocument(file)) throw new Error('Only PDF, Word or Excel files are supported')
  if (file.size > MAX_DOCUMENT_SIZE) throw new Error('Documents can be at most 10 MB')

  const attachment: Attachment = {
    id: crypto.randomUUID(),
    entryId,
    blob: file,
    createdAt: new Date().toISOString(),
    kind: 'document',
    mimeType: file.type,
    name: file.name,
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

/**
 * Deletes one photo and hands back what it deleted, so Undo can put the exact
 * bytes back rather than a re-encode of them.
 *
 * Read and delete in one transaction: split across two, a second remove of the
 * same id between them would return a record that no longer exists, and Undo
 * would resurrect a photo the user removed twice.
 */
export function remove(id: string): Promise<Attachment | undefined> {
  return openDb().then(
    (db) =>
      new Promise<Attachment | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const read = store.get(id)
        let taken: Attachment | undefined
        read.onsuccess = () => {
          taken = read.result as Attachment | undefined
          if (taken !== undefined) store.delete(id)
        }
        read.onerror = () => reject(read.error ?? new Error('Failed to read the attachment'))
        tx.onerror = () => reject(tx.error ?? new Error('Failed to remove the attachment'))
        tx.oncomplete = () => {
          notifyChanged()
          resolve(taken)
        }
      }),
  )
}

/** Puts a removed photo back exactly as it was, for Undo. */
export async function restore(photo: Attachment): Promise<void> {
  await run('readwrite', (store) => store.put(photo))
}

/** Deletes every photo belonging to one entry. */
export async function removeAll(entryId: string): Promise<void> {
  const photos = await list(entryId)
  for (const photo of photos) await remove(photo.id)
}

/**
 * Every entry id that currently has at least one stored photo — a document
 * does not count, so this walks records rather than the key cursor `put`'s
 * sibling function used to, the only way to see each one's `kind`.
 */
function storedEntryIds(): Promise<Set<string>> {
  return openDb().then(
    (db) =>
      new Promise<Set<string>>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const index = tx.objectStore(STORE).index(ENTRY_INDEX)
        const ids = new Set<string>()
        const request = index.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            const attachment = cursor.value as Attachment
            if (attachment.kind !== 'document') ids.add(attachment.entryId)
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

/** The photo a row draws, and how many that entry holds in total. */
export type Representative = { blob: Blob; count: number }

/**
 * At most one representative photo per requested entry, and the count it
 * stands for, so a row carrying three can say so.
 *
 * One cursor over the whole index rather than a read per row: the rows on
 * screen are the caller's business, the number of IndexedDB operations is this
 * function's, and it is always one. The count is tallied in that same walk —
 * asking for it separately would be a second pass over the same records.
 */
export async function firstPhotoBlobs(
  entryIds: string[],
): Promise<Record<string, Representative>> {
  const wanted = new Set(entryIds)
  if (wanted.size === 0) return {}

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index(ENTRY_INDEX)
    const found: Record<string, Representative> = {}
    const request = index.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const photo = cursor.value as Attachment
      if (photo.kind !== 'document' && wanted.has(photo.entryId)) {
        const held = found[photo.entryId]
        // The oldest photo on an entry wins, because the cursor walks the
        // index in insertion order and the first one seen is kept — every one
        // after it only adds to the count.
        if (held === undefined) found[photo.entryId] = { blob: photo.blob, count: 1 }
        else held.count += 1
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to read attachments'))
    tx.oncomplete = () => resolve(found)
    tx.onerror = () => reject(tx.error ?? new Error('Failed to read attachments'))
  })
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
  // An empty live set is never evidence: it is what a parse-failed store, the
  // quota fallback's `{entries: [], pending}` and a freshly minted identity all
  // look like, and each of those once meant deleting every photo on the device
  // — the only copies that exist. A log that holds photos is never legitimately
  // empty, so there is nothing real to sweep against.
  if (liveEntryIds.length === 0) return
  const stored = await storedEntryIds()
  for (const entryId of orphansOf(stored, liveEntryIds)) await removeAll(entryId)
}
