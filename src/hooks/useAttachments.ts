import { useCallback, useEffect, useRef, useState } from 'react'
import * as attachments from '../lib/attachments'

/** Longest side a stored photo is allowed to keep — a camera original is easily 4000px+. */
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

export type Photo = { id: string; url: string; createdAt: string }

/** Outcome of the last `add`, for the sheet to show — separate from entry-save state. */
export type AddState = 'idle' | 'saving' | 'failed'

function revoke(photos: Photo[]): void {
  for (const photo of photos) URL.revokeObjectURL(photo.url)
}

/**
 * Decodes, downscales to at most `MAX_DIMENSION` on the longest side, and
 * re-encodes as JPEG — so a multi-MB camera original never lands in
 * IndexedDB whole.
 */
async function processImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is not available')
  ctx.drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode photo'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
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

  const add = useCallback(
    async (file: File) => {
      setAddState('saving')
      try {
        const blob = await processImage(file)
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
 * Which of `entryIds` have a stored photo, refreshed whenever the attachment
 * store changes. One batched lookup for a whole list of rows, never one
 * IndexedDB read per row.
 */
export function useHasPhotoMap(entryIds: string[]): Record<string, boolean> {
  const [map, setMap] = useState<Record<string, boolean>>({})
  const key = entryIds.join(',')

  useEffect(() => {
    let live = true
    const load = () => {
      // Same reasoning as `refresh` above: a row's indicator quietly staying
      // off is fine, an unhandled rejection on every render is not.
      void attachments
        .hasPhotoMap(entryIds)
        .then((next) => {
          if (live) setMap(next)
        })
        .catch(() => {
          if (live) setMap({})
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

  return map
}
