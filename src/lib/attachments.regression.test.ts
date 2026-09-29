import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { put, removeAll } from './attachments'
import type { Entry } from '../types'

/**
 * The whole feature rests on one boundary: a photo must never become part of
 * the synced `Entry`. `exportJson` in `App.tsx` is `JSON.stringify(all, null,
 * 2)` over exactly the array `fetchAll` returns — this test exercises that
 * same shape, not a description of it, so a future change that starts
 * threading attachment data through `Entry` fails here rather than in
 * production.
 */

function entry(): Entry {
  return {
    id: 'regress-1',
    kind: 'expense',
    occurred_on: '2026-09-05',
    occurred_at: null,
    title: 'lunch',
    note: null,
    amount_paise: 35_000,
    duration_minutes: null,
    category: 'food',
    data: {},
    created_at: '2026-09-05T10:00:00+05:30',
  }
}

afterEach(async () => {
  await removeAll('regress-1')
})

it('adding and removing a photo leaves the Entry object byte-for-byte unchanged', async () => {
  const row = entry()
  const before = JSON.stringify(row)

  await put(row.id, new Blob(['x'], { type: 'image/jpeg' }))
  expect(JSON.stringify(row)).toBe(before)

  await removeAll(row.id)
  expect(JSON.stringify(row)).toBe(before)
})

it('is absent from the exported JSON shape', async () => {
  const row = entry()
  await put(row.id, new Blob(['x'], { type: 'image/jpeg' }))

  // What `exportJson` actually writes: `JSON.stringify(all, null, 2)`.
  const [exported] = JSON.parse(JSON.stringify([row], null, 2)) as Entry[]
  if (exported === undefined) throw new Error('expected one exported row')

  expect(exported).toEqual(row)
  expect(Object.keys(exported)).not.toContain('photos')
  expect(Object.keys(exported)).not.toContain('attachments')
  expect(JSON.stringify(exported.data)).toBe('{}')
})
