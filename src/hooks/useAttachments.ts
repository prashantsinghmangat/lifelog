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
    revoke(shown.current)
    const next = stored.map((a) => ({
      id: a.id,
      url: URL.createObjectURL(a.blob),
      createdAt: a.createdAt,
    }))
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

  const remove = useCallback(
    async (id: string) => {
      await attachments.remove(id)
      await refresh()
    },
    [refresh],
  )

  return { photos, addState, add, remove }
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
          const next: Record<string, Thumbnail> = {}
          for (const [id, { blob, count }] of Object.entries(found)) {
            next[id] = { url: URL.createObjectURL(blob), count }
          }
          if (!live) {
            // Nothing will ever render these, so they leak unless dropped here.
            for (const shot of Object.values(next)) URL.revokeObjectURL(shot.url)
            return
          }
          for (const shot of Object.values(shown.current)) URL.revokeObjectURL(shot.url)
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
