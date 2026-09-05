import { describe, expect, it } from 'vitest'
import { pageRange, snapshotKey, stale, totalFrom } from './backup.ts'

describe('snapshotKey', () => {
  it('names one snapshot per UTC day', () => {
    expect(snapshotKey(new Date(Date.UTC(2026, 8, 5, 3, 30)))).toBe('entries-2026-09-05.json')
  })

  it('pads months and days so the names sort chronologically', () => {
    const keys = [
      snapshotKey(new Date(Date.UTC(2026, 10, 14))),
      snapshotKey(new Date(Date.UTC(2026, 0, 2))),
      snapshotKey(new Date(Date.UTC(2026, 9, 9))),
    ]
    expect([...keys].sort()).toEqual([
      'entries-2026-01-02.json',
      'entries-2026-10-09.json',
      'entries-2026-11-14.json',
    ])
  })

  it('uses UTC, so a late-evening IST run does not overwrite yesterday', () => {
    // 5 Sep 01:00 UTC is 6:30am IST on the 5th; both agree on the date here.
    expect(snapshotKey(new Date(Date.UTC(2026, 8, 5, 1, 0)))).toBe('entries-2026-09-05.json')
  })
})

describe('stale', () => {
  const keys = [
    'entries-2026-09-01.json',
    'entries-2026-09-02.json',
    'entries-2026-09-03.json',
    'entries-2026-09-04.json',
  ]

  it('keeps the newest and returns the rest', () => {
    expect(stale(keys, 2)).toEqual(['entries-2026-09-01.json', 'entries-2026-09-02.json'])
  })

  it('returns nothing when there is less than the limit', () => {
    expect(stale(keys, 10)).toEqual([])
  })

  it('ignores anything that is not a snapshot', () => {
    expect(stale([...keys, 'notes.txt', 'entries-latest.csv'], 4)).toEqual([])
  })

  it('treats a zero or negative limit as keep nothing, not keep everything', () => {
    expect(stale(keys, 0)).toHaveLength(4)
    expect(stale(keys, -1)).toHaveLength(4)
  })
})

describe('paging', () => {
  it('builds the Range header for each page', () => {
    expect(pageRange(0, 1000)).toBe('0-999')
    expect(pageRange(1, 1000)).toBe('1000-1999')
    expect(pageRange(3, 500)).toBe('1500-1999')
  })

  it('reads the total out of Content-Range', () => {
    expect(totalFrom('0-999/2431')).toBe(2431)
    expect(totalFrom('0-11/12')).toBe(12)
  })

  it('returns null when the total is unknown or absent', () => {
    expect(totalFrom(null)).toBeNull()
    expect(totalFrom('0-999/*')).toBeNull()
    expect(totalFrom('nonsense')).toBeNull()
  })
})
