import { describe, expect, it } from 'vitest'
import {
  authorised,
  isSnapshotKey,
  rowRange,
  snapshotKey,
  stale,
  totalFrom,
} from './backup.ts'

describe('which keys the download endpoint will accept', () => {
  // The key reaches a blob lookup and a `filename="…"` header. Matching the
  // exact shape `snapshotKey` writes is what keeps both of those boring.

  it('accepts a name it could itself have written', () => {
    expect(isSnapshotKey(snapshotKey(new Date(Date.UTC(2026, 8, 5))))).toBe(true)
    expect(isSnapshotKey('entries-2026-09-05.json')).toBe(true)
  })

  it('refuses anything that tries to climb out', () => {
    for (const key of [
      '../secret',
      '../../secret',
      '../entries-2026-09-05.json',
      'entries-2026-09-05.json/../../secret',
      '..%2Fsecret',
    ]) {
      expect(isSnapshotKey(key)).toBe(false)
    }
  })

  it('refuses anything carrying a separator, either kind', () => {
    expect(isSnapshotKey('foo/bar')).toBe(false)
    expect(isSnapshotKey('foo\\bar')).toBe(false)
    expect(isSnapshotKey('backups/entries-2026-09-05.json')).toBe(false)
    expect(isSnapshotKey('C:\\Windows\\win.ini')).toBe(false)
    expect(isSnapshotKey('/etc/passwd')).toBe(false)
  })

  it('refuses a quote, which would end the filename parameter early', () => {
    expect(isSnapshotKey('entries-2026-09-05.json"; filename="x')).toBe(false)
    expect(isSnapshotKey('entries-2026-09-05.json\r\nX-Injected: 1')).toBe(false)
  })

  it('refuses the wrong extension, or none', () => {
    expect(isSnapshotKey('entries-2026-09-05.txt')).toBe(false)
    expect(isSnapshotKey('entries-2026-09-05')).toBe(false)
    expect(isSnapshotKey('entries-2026-09-05.json.bak')).toBe(false)
  })

  it('refuses the wrong shape of name', () => {
    expect(isSnapshotKey('')).toBe(false)
    expect(isSnapshotKey('entries-.json')).toBe(false)
    expect(isSnapshotKey('entries-26-9-5.json')).toBe(false)
    expect(isSnapshotKey('notentries-2026-09-05.json')).toBe(false)
    expect(isSnapshotKey('entries-2026-09-05.json '.trimEnd() + 'x')).toBe(false)
  })

  it('refuses a very long key without trying to read it', () => {
    expect(isSnapshotKey(`entries-2026-09-05${'0'.repeat(10_000)}.json`)).toBe(false)
    expect(isSnapshotKey('a'.repeat(100_000))).toBe(false)
  })

  it('anchors both ends, so a valid name buried in junk is still refused', () => {
    expect(isSnapshotKey('x entries-2026-09-05.json')).toBe(false)
    expect(isSnapshotKey('entries-2026-09-05.json x')).toBe(false)
    expect(isSnapshotKey('entries-2026-09-05.json\nentries-2026-09-06.json')).toBe(false)
  })
})

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
  it('builds the Range header from the rows already held', () => {
    expect(rowRange(0, 1000)).toBe('0-999')
    expect(rowRange(1000, 1000)).toBe('1000-1999')
    expect(rowRange(1500, 500)).toBe('1500-1999')
  })

  it('advances by what arrived, not by what was asked for', () => {
    // The distinction the old page-index version could not make: a server that
    // capped every response at 400 left rows 400-999 unread, and the row count
    // in the snapshot gave no sign of the hole.
    expect(rowRange(400, 1000)).toBe('400-1399')
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

describe('the shared secret guarding the backup endpoints', () => {
  const ask = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers })

  const SECRET = 'a-long-random-backup-token'
  const URL_BASE = 'https://lifelog.example/.netlify/functions/backups'

  it('accepts the token in the query string, which is what a browser can send', () => {
    expect(authorised(ask(`${URL_BASE}?token=${SECRET}`), SECRET)).toBe(true)
  })

  it('accepts it as a bearer header, which is what a script should send', () => {
    expect(authorised(ask(URL_BASE, { authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true)
    // However the header was cased on the way in.
    expect(authorised(ask(URL_BASE, { authorization: `bearer ${SECRET}` }), SECRET)).toBe(true)
  })

  it('refuses everything else', () => {
    expect(authorised(ask(URL_BASE), SECRET)).toBe(false)
    expect(authorised(ask(`${URL_BASE}?token=`), SECRET)).toBe(false)
    expect(authorised(ask(`${URL_BASE}?token=wrong`), SECRET)).toBe(false)
    // A prefix of the real token, which a length-only comparison would pass.
    expect(authorised(ask(`${URL_BASE}?token=${SECRET.slice(0, -1)}`), SECRET)).toBe(false)
    // And one that merely starts with it.
    expect(authorised(ask(`${URL_BASE}?token=${SECRET}x`), SECRET)).toBe(false)
    expect(authorised(ask(URL_BASE, { authorization: SECRET }), SECRET)).toBe(false)
  })

  it('does not fall back to the query string once a bearer header is offered', () => {
    // Otherwise a wrong header is quietly rescued by a right query param, and
    // the endpoint's behaviour depends on which of the two the caller got right.
    const request = ask(`${URL_BASE}?token=${SECRET}`, { authorization: 'Bearer wrong' })
    expect(authorised(request, SECRET)).toBe(false)
  })
})
