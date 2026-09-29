import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  firstPhotoBlobs,
  hasPhotoMap,
  list,
  orphansOf,
  put,
  remove,
  removeAll,
  sweepOrphans,
  targetSize,
} from './attachments'

/**
 * A photo lives entirely off the synced log — this is the one place that
 * boundary is tested for real, against an in-memory IndexedDB rather than the
 * jsdom test environment, which has none at all.
 */

const blob = () => new Blob(['x'], { type: 'image/jpeg' })

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
    expect(found['thumb-1']).toBeInstanceOf(Blob)
  })

  it('leaves out an entry with no photo, rather than mapping it to nothing', async () => {
    await put('thumb-1', blob())
    const found = await firstPhotoBlobs(['thumb-1', 'thumb-2'])
    expect('thumb-2' in found).toBe(false)
  })

  it('returns an empty map for an empty request', async () => {
    expect(await firstPhotoBlobs([])).toEqual({})
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
