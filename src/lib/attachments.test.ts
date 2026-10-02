import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PHOTOS_PER_ENTRY,
  acceptedDocument,
  firstPhotoBlobs,
  fromFile,
  hasPhotoMap,
  list,
  orphansOf,
  put,
  putDocument,
  remove,
  removeAll,
  sweepOrphans,
  targetSize,
  yieldToPaint,
} from './attachments'

/**
 * A photo lives entirely off the synced log — this is the one place that
 * boundary is tested for real, against an in-memory IndexedDB rather than the
 * jsdom test environment, which has none at all.
 */

const blob = () => new Blob(['x'], { type: 'image/jpeg' })

describe('yieldToPaint', () => {
  it('resolves even when no frame ever comes', async () => {
    // A WebView that stops producing frames until the next touch stranded a
    // photo batch behind this await on the device — the deadline is the way
    // out (spec 036). The stub never calls back, as that WebView never did.
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    await expect(yieldToPaint()).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})

describe('MAX_PHOTOS_PER_ENTRY', () => {
  // Both pickers quote this number in their messages; a drift here is a lie there.
  it('is ten', () => {
    expect(MAX_PHOTOS_PER_ENTRY).toBe(10)
  })
})

describe('orphansOf', () => {
  it('drops stored entry ids absent from the live set', () => {
    expect(orphansOf(['a', 'b'], ['a'])).toEqual(['b'])
  })

  it('keeps ids present in both sets', () => {
    expect(orphansOf(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('returns empty for an empty stored set', () => {
    expect(orphansOf([], ['a'])).toEqual([])
  })
})

describe('multiple photos on one entry', () => {
  afterEach(async () => {
    await removeAll('multi-1')
  })

  it('are listed together and removing one leaves the others', async () => {
    const first = await put('multi-1', blob())
    const second = await put('multi-1', blob())

    expect((await list('multi-1')).map((a) => a.id).sort()).toEqual(
      [first.id, second.id].sort(),
    )

    await remove(first.id)
    const remaining = await list('multi-1')
    expect(remaining.map((a) => a.id)).toEqual([second.id])
  })

  it('each carries its own entry id', async () => {
    const photo = await put('multi-2', blob())
    expect(photo.entryId).toBe('multi-2')
    await removeAll('multi-2')
  })
})

describe('hasPhotoMap', () => {
  afterEach(async () => {
    await removeAll('map-1')
  })

  it('is true only for entries with a stored photo', async () => {
    await put('map-1', blob())
    expect(await hasPhotoMap(['map-1', 'map-2'])).toEqual({ 'map-1': true, 'map-2': false })
  })

  it('treats an entry holding only a document as having no photo', async () => {
    await putDocument('map-1', new File(['x'], 'bill.pdf', { type: 'application/pdf' }))
    expect(await hasPhotoMap(['map-1'])).toEqual({ 'map-1': false })
  })
})

describe('acceptedDocument', () => {
  it.each([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ])('accepts %s by MIME type', (type) => {
    expect(acceptedDocument(new File(['x'], 'file.bin', { type }))).toBe(true)
  })

  it.each(['pdf', 'doc', 'docx', 'xls', 'xlsx'])(
    'accepts a .%s file by extension when the picker reports a blank type',
    (extension) => {
      expect(acceptedDocument(new File(['x'], `file.${extension}`, { type: '' }))).toBe(true)
    },
  )

  it('rejects an image — that is Gallery and Camera\'s job, not Document\'s', () => {
    expect(acceptedDocument(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false)
  })

  it('rejects a type and extension neither one recognises', () => {
    expect(acceptedDocument(new File(['x'], 'archive.zip', { type: 'application/zip' }))).toBe(
      false,
    )
  })
})

describe('putDocument', () => {
  afterEach(async () => {
    await removeAll('doc-1')
  })

  it('stores the file under kind, mimeType and name', async () => {
    const file = new File(['x'], 'statement.pdf', { type: 'application/pdf' })
    const stored = await putDocument('doc-1', file)
    expect(stored.kind).toBe('document')
    expect(stored.mimeType).toBe('application/pdf')
    expect(stored.name).toBe('statement.pdf')
    expect((await list('doc-1'))[0]?.id).toBe(stored.id)
  })

  it('rejects a file over 10 MB without storing it', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    await expect(putDocument('doc-1', big)).rejects.toThrow(/10 MB/)
    expect(await list('doc-1')).toHaveLength(0)
  })

  it('rejects an unsupported type without storing it', async () => {
    const file = new File(['x'], 'archive.zip', { type: 'application/zip' })
    await expect(putDocument('doc-1', file)).rejects.toThrow(/PDF, Word or Excel/)
    expect(await list('doc-1')).toHaveLength(0)
  })
})

describe('sweepOrphans', () => {
  it('removes photos for entries no longer live, keeps the rest', async () => {
    await put('sweep-keep', blob())
    await put('sweep-gone', blob())

    await sweepOrphans(['sweep-keep'])

    expect(await list('sweep-keep')).toHaveLength(1)
    expect(await list('sweep-gone')).toHaveLength(0)

    await removeAll('sweep-keep')
  })

  it('deletes nothing when the live set is empty — a parse-failed store and the quota fallback both look exactly like this', async () => {
    await put('sweep-empty', blob())

    await sweepOrphans([])

    expect(await list('sweep-empty')).toHaveLength(1)
    await removeAll('sweep-empty')
  })
})

describe('targetSize', () => {
  it('caps the longest side at 1600, keeping the aspect ratio', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    // Portrait: the cap follows the longest side, whichever one that is.
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
  })

  it('leaves an image already under the cap alone, rather than scaling it up', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('firstPhotoBlobs', () => {
  afterEach(async () => {
    await removeAll('thumb-1')
    await removeAll('thumb-2')
  })

  it('returns one representative blob for an entry holding several', async () => {
    await put('thumb-1', blob())
    await put('thumb-1', blob())

    const found = await firstPhotoBlobs(['thumb-1'])
    expect(Object.keys(found)).toEqual(['thumb-1'])
    expect(found['thumb-1']?.blob).toBeInstanceOf(Blob)
  })

  /** One thumbnail understated an entry holding three — the row needs the total. */
  it('counts every photo the entry holds, not just the one it hands back', async () => {
    await put('thumb-1', blob())
    await put('thumb-1', blob())
    await put('thumb-1', blob())
    await put('thumb-2', blob())

    const found = await firstPhotoBlobs(['thumb-1', 'thumb-2'])
    expect(found['thumb-1']?.count).toBe(3)
    expect(found['thumb-2']?.count).toBe(1)
  })

  it('leaves out an entry with no photo, rather than mapping it to nothing', async () => {
    await put('thumb-1', blob())
    const found = await firstPhotoBlobs(['thumb-1', 'thumb-2'])
    expect('thumb-2' in found).toBe(false)
  })

  it('returns an empty map for an empty request', async () => {
    expect(await firstPhotoBlobs([])).toEqual({})
  })

  it('never hands back a document as the representative blob', async () => {
    await putDocument('thumb-1', new File(['x'], 'bill.pdf', { type: 'application/pdf' }))
    expect(await firstPhotoBlobs(['thumb-1'])).toEqual({})
  })
})

describe('fromFile', () => {
  /**
   * "1 of 2 photos couldn't be attached" named the arithmetic and not the
   * problem. The encode path itself needs a real canvas, so what is pinned
   * here is that whatever it throws is worth showing someone.
   */
  it('fails with a message rather than an empty one', async () => {
    // No `createImageBitmap` under node, which is itself a decode failure.
    await expect(fromFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow(
      /.+/,
    )
  })

  /**
   * A 12MP photo is ~48MB of native memory, and the first decode in a batch to
   * run out is not evidence the file is undecodable — only that the previous
   * one had not let go yet. Pinned here because the retry is invisible when it
   * works, and silently losing a photo is what it exists to stop.
   */
  it('retries a decode once, so a photo is not lost to a passing shortage', async () => {
    const decode = vi
      .fn<(file: File) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('out of memory'))
      .mockResolvedValueOnce({ width: 10, height: 10, close: vi.fn() })
    vi.stubGlobal('createImageBitmap', decode)

    // The encode needs a `document`, which this file's node environment has
    // not — so it still rejects, and the two calls are the proof the retry ran
    // rather than the first failure being passed straight on.
    await expect(fromFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })

  it('falls back to the img-element decoder once both bitmap attempts fail', async () => {
    const decode = vi.fn<(file: File) => Promise<unknown>>().mockRejectedValue(new Error('nope'))
    vi.stubGlobal('createImageBitmap', decode)

    // Node has no `Image`, so reaching for the fallback is itself the proof
    // here: the rejection is the fallback's missing element, not the bitmap
    // API's own 'nope' — and that API was still only asked twice, never looped.
    await expect(fromFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow(
      /Image is not defined/,
    )
    expect(decode).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })
})

describe('failure is never silent', () => {
  it('rejects rather than resolving when IndexedDB is unavailable', async () => {
    const real = globalThis.indexedDB
    // @ts-expect-error -- simulating an environment with no IndexedDB at all
    delete globalThis.indexedDB
    try {
      await expect(list('anything')).rejects.toThrow()
    } finally {
      globalThis.indexedDB = real
    }
  })
})
