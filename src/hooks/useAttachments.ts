import { useCallback, useEffect, useRef, useState } from 'react'
import * as attachments from '../lib/attachments'

export type Photo = { id: string; url: string; createdAt: string }

/** What a timeline row draws: one photo, and how many that entry actually holds. */
export type Thumbnail = { url: string; count: number }

/** Outcome of the last `add`, for the sheet to show — separate from entry-save state. */
export type AddState = 'idle' | 'saving' | 'failed'

function revoke(photos: Photo[]): void {
  for (const photo of photos) URL.revokeObjectURL(photo.url)
}

/**
 * The URLs for a set of stored photos, reusing every one already held.
 *
 * **A photo that has not changed must keep the same URL.** Rebuilding the lot
 * on every write gave every `<img>` on screen a new `src` at once, so adding
 * one photo blanked and repainted all of them — the flicker. Only genuinely
 * new ids are minted, and only genuinely gone ids are revoked.
 */
function reconcileUrls(
  held: Photo[],
  stored: attachments.Attachment[],
): { next: Photo[]; gone: Photo[] } {
  const byId = new Map(held.map((photo) => [photo.id, photo]))
  const next = stored.map((a) => {
    const already = byId.get(a.id)
    if (already !== undefined) return already
    return { id: a.id, url: URL.createObjectURL(a.blob), createdAt: a.createdAt }
  })
  const keeping = new Set(next.map((photo) => photo.id))
  return { next, gone: held.filter((photo) => !keeping.has(photo.id)) }
}

/** One entry's local photos: list, add (from a picked file), remove. */
export function useAttachments(entryId: string) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [addState, setAddState] = useState<AddState>('idle')
  // Tracks the URLs actually on screen, so unmounting can revoke them without
  // ever calling `setState` after the component is gone.
  const shown = useRef<Photo[]>([])

  const refresh = useCallback(async () => {
    // A read that can't reach IndexedDB (locked-down storage, private mode)
    // degrades to "no photos shown" rather than an unhandled rejection — this
    // is passive display, not a save the user is waiting on.
    const stored = await attachments.list(entryId).catch(() => [])
    const { next, gone } = reconcileUrls(shown.current, stored)
    revoke(gone)
    shown.current = next
    setPhotos(next)
  }, [entryId])

  useEffect(() => {
    void refresh()
    return () => revoke(shown.current)
  }, [refresh])

  /**
   * A picked file, or a blob already through the pipeline.
   *
   * The composer processes at pick time — one decode as each photo is chosen,
   * rather than several back to back on Save — so by the time it gets here the
   * work is done. Both paths end at the same `put`, which is the point: there
   * is one way a photo is stored regardless of where it was picked.
   */
  const add = useCallback(
    async (source: File | Blob) => {
      setAddState('saving')
      try {
        const blob = source instanceof File ? await attachments.fromFile(source) : source
        await attachments.put(entryId, blob)
        await refresh()
        setAddState('idle')
      } catch {
        setAddState('failed')
      }
    },
    [entryId, refresh],
  )

  /** Hands back what it removed, so the caller can offer Undo over the real bytes. */
  const remove = useCallback(
    async (id: string) => {
      const taken = await attachments.remove(id)
      await refresh()
      return taken
    },
    [refresh],
  )

  const restore = useCallback(
    async (photo: attachments.Attachment) => {
      await attachments.restore(photo)
      await refresh()
    },
    [refresh],
  )

  return { photos, addState, add, remove, restore }
}

/**
 * Every photo on one entry, loaded on demand with its own URLs.
 *
 * For opening the viewer from a timeline row, where the row holds only the one
 * representative thumbnail and the rest have never been read. The caller owns
 * what comes back and must revoke it — `App` does, when the viewer closes.
 */
export async function photosOf(entryId: string): Promise<Photo[]> {
  const stored = await attachments.list(entryId).catch(() => [])
  return stored.map((a) => ({
    id: a.id,
    url: URL.createObjectURL(a.blob),
    createdAt: a.createdAt,
  }))
}

/**
 * A thumbnail URL for each of `entryIds` that has a photo, refreshed whenever
 * the attachment store changes. One batched lookup for a whole list of rows,
 * never one IndexedDB read per row.
 *
 * The URLs are owned here: a batch replacing an earlier one revokes what it
 * replaced, and unmounting revokes the lot. A row's `img` src going stale is
 * the one thing that must not happen, so the revoke is keyed to the batch
 * rather than to any single row.
 */
export function usePhotoThumbnails(entryIds: string[]): Record<string, Thumbnail> {
  const [urls, setUrls] = useState<Record<string, Thumbnail>>({})
  const shown = useRef<Record<string, Thumbnail>>({})
  const key = entryIds.join(',')

  useEffect(() => {
    let live = true
    const load = () => {
      // Same reasoning as `refresh` above: a row's thumbnail quietly staying
      // off is fine, an unhandled rejection on every render is not.
      void attachments
        .firstPhotoBlobs(entryIds)
        .then((found) => {
          // Same rule as `reconcileUrls` above: a row whose photo has not
          // changed keeps its URL, or every thumbnail on the day blinks each
          // time any one of them is written. Only the count may differ, and
          // changing a number repaints nothing.
          const minted: string[] = []
          const next: Record<string, Thumbnail> = {}
          for (const [id, { blob, count }] of Object.entries(found)) {
            const already = shown.current[id]
            if (already !== undefined) {
              next[id] = already.count === count ? already : { url: already.url, count }
            } else {
              const url = URL.createObjectURL(blob)
              minted.push(url)
              next[id] = { url, count }
            }
          }
          if (!live) {
            // Nothing will ever render these, so they leak unless dropped here.
            for (const url of minted) URL.revokeObjectURL(url)
            return
          }
          for (const [id, shot] of Object.entries(shown.current)) {
            if (next[id]?.url !== shot.url) URL.revokeObjectURL(shot.url)
          }
          shown.current = next
          setUrls(next)
        })
        .catch(() => {
          if (live) setUrls({})
        })
    }
    load()
    const unsubscribe = attachments.onChange(load)
    return () => {
      live = false
      unsubscribe()
    }
    // `key` is the real dependency — `entryIds` is a fresh array every render.
  }, [key])

  // Unmount only: the effect above already revokes a batch it replaces, and
  // tying this to `key` would revoke the URLs the current render is using.
  useEffect(() => {
    return () => {
      for (const shot of Object.values(shown.current)) URL.revokeObjectURL(shot.url)
      shown.current = {}
    }
  }, [])

  return urls
}
