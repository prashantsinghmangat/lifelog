// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAttachments } from './useAttachments'
import { put, removeAll } from '../lib/attachments'

/**
 * **A photo that has not changed must keep the same object URL.**
 *
 * Rebuilding every URL on every write gave every `<img>` on screen a new `src`
 * at once, so adding one photo blanked and repainted all of them — visible as
 * a flicker on the device and invisible to every test that only asked how many
 * thumbnails there were.
 */

const minted: string[] = []
const revoked: string[] = []

beforeEach(() => {
  minted.length = 0
  revoked.length = 0
  let n = 0
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      n += 1
      const url = `blob:${n}`
      minted.push(url)
      return url
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const jpeg = () => new Blob(['x'], { type: 'image/jpeg' })

/** Renders the hook and exposes its latest value. */
function mount(entryId: string) {
  const seen: { current: ReturnType<typeof useAttachments> | null } = { current: null }
  function Probe() {
    seen.current = useAttachments(entryId)
    return null
  }
  render(<Probe />)
  return seen
}

it('keeps the URL of a photo already shown and mints one only for the new one', async () => {
  await put('flicker-1', jpeg())
  const seen = mount('flicker-1')
  await waitFor(() => expect(seen.current?.photos).toHaveLength(1))

  const first = seen.current!.photos[0]!
  expect(minted).toHaveLength(1)

  await act(async () => {
    await seen.current!.add(jpeg())
  })
  await waitFor(() => expect(seen.current?.photos).toHaveLength(2))

  // The one that was already there is the *same object*, so its `src` never
  // changed and nothing repainted it.
  expect(seen.current!.photos[0]).toBe(first)
  expect(minted).toHaveLength(2)
  expect(revoked).not.toContain(first.url)

  await removeAll('flicker-1')
})

it('revokes only the photo that went, and leaves the rest alone', async () => {
  await put('flicker-2', jpeg())
  await put('flicker-2', jpeg())
  const seen = mount('flicker-2')
  await waitFor(() => expect(seen.current?.photos).toHaveLength(2))

  const [going, staying] = [seen.current!.photos[0]!, seen.current!.photos[1]!]

  await act(async () => {
    await seen.current!.remove(going.id)
  })
  await waitFor(() => expect(seen.current?.photos).toHaveLength(1))

  expect(revoked).toContain(going.url)
  expect(revoked).not.toContain(staying.url)
  expect(seen.current!.photos[0]).toBe(staying)

  await removeAll('flicker-2')
})

it('hands back what it removed, so Undo restores the bytes rather than a re-encode', async () => {
  const stored = await put('flicker-3', jpeg())
  const seen = mount('flicker-3')
  await waitFor(() => expect(seen.current?.photos).toHaveLength(1))

  let taken: Awaited<ReturnType<NonNullable<typeof seen.current>['remove']>> | undefined
  await act(async () => {
    taken = await seen.current!.remove(stored.id)
  })

  // The record itself came back, which is what Undo needs. That its `blob` is
  // a real `Blob` is asserted in `attachments.test.ts`, which runs without
  // jsdom — fake-indexeddb's structured clone does not reconstruct one here.
  expect(taken?.id).toBe(stored.id)
  expect(taken?.entryId).toBe('flicker-3')

  await act(async () => {
    await seen.current!.restore(taken!)
  })
  await waitFor(() => expect(seen.current?.photos).toHaveLength(1))
  expect(seen.current!.photos[0]?.id).toBe(stored.id)

  await removeAll('flicker-3')
})

it('adds a document without touching photos', async () => {
  await put('doc-1', jpeg())
  const seen = mount('doc-1')
  await waitFor(() => expect(seen.current?.photos).toHaveLength(1))

  await act(async () => {
    await seen.current!.addDocument(new File(['x'], 'bill.pdf', { type: 'application/pdf' }))
  })
  await waitFor(() => expect(seen.current?.documents).toHaveLength(1))

  expect(seen.current!.documents[0]?.name).toBe('bill.pdf')
  expect(seen.current!.photos).toHaveLength(1)

  await removeAll('doc-1')
})

it('lets a rejected document propagate, rather than swallowing it like a photo failure', async () => {
  const seen = mount('doc-2')
  await waitFor(() => expect(seen.current).not.toBeNull())

  await expect(
    seen.current!.addDocument(new File(['x'], 'archive.zip', { type: 'application/zip' })),
  ).rejects.toThrow(/PDF, Word or Excel/)
  expect(seen.current!.documents).toHaveLength(0)

  await removeAll('doc-2')
})
