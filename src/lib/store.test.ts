import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  adopt,
  keyFor,
  load,
  payloadOf,
  reconcile,
  removeLocal,
  save,
  settle,
  upsertLocal,
  type Stored,
} from './store'
import type { Entry, Kind } from '../types'

let seq = 0
function entry(over: Partial<Entry> & { id?: string } = {}): Entry {
  seq += 1
  return {
    id: over.id ?? `id-${seq}`,
    kind: 'expense' as Kind,
    occurred_on: '2026-09-05',
    occurred_at: null,
    title: 'lunch',
    note: null,
    amount_paise: 35000,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-05T10:00:00+05:30',
    ...over,
  }
}

/** localStorage's contract, without a browser — including the ways it fails. */
function fakeStorage(over: { full?: boolean; unreadable?: boolean } = {}): Storage {
  const held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => {
      if (over.unreadable === true) throw new Error('blocked')
      return held.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      // A real quota error rejects the large write and allows a small one.
      if (over.full === true && value.length > 1000) throw new Error('QuotaExceededError')
      held.set(key, value)
    },
    removeItem: (key: string) => void held.delete(key),
  }
}

describe('what the server should end up with', () => {
  it('sends the row it holds, deletion included', () => {
    const sent = payloadOf({ ...entry({ id: 'a' }), deleted_at: null, queued_at: 'x' })
    expect(sent['id']).toBe('a')
    expect(sent['deleted_at']).toBeNull()
    // Local metadata, not a column the server knows about.
    expect(sent).not.toHaveProperty('queued_at')
  })

  it('sends the time the row was created here, not whenever it syncs', () => {
    // A row logged offline on Tuesday and synced on Friday claiming Friday
    // would sort wrongly within its day for ever.
    const row = entry({ created_at: '2026-09-01T08:00:00+05:30' })
    expect(payloadOf({ ...row, deleted_at: null, queued_at: 'x' })['created_at']).toBe(
      '2026-09-01T08:00:00+05:30',
    )
  })
})

describe('writing locally', () => {
  it('holds the row and owes it to the server', () => {
    const state = upsertLocal(EMPTY, entry({ id: 'a' }), 'now')
    expect(state.entries.map((row) => row.id)).toEqual(['a'])
    expect(state.pending.map((row) => row.id)).toEqual(['a'])
  })

  it('collapses repeated edits into one write', () => {
    // Five edits offline are one row the server is behind on, not five.
    let state = upsertLocal(EMPTY, entry({ id: 'a', title: 'one' }), 't1')
    state = upsertLocal(state, entry({ id: 'a', title: 'two' }), 't2')
    state = upsertLocal(state, entry({ id: 'a', title: 'three' }), 't3')

    expect(state.pending).toHaveLength(1)
    expect(state.entries).toHaveLength(1)
    expect(state.pending[0]?.title).toBe('three')
  })

  it('takes a deleted row out of the log and still owes the deletion', () => {
    const row = entry({ id: 'a' })
    const state = removeLocal(upsertLocal(EMPTY, row, 't1'), row, 't2')

    expect(state.entries).toHaveLength(0)
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]?.deleted_at).toBe('t2')
  })

  it('brings a deleted row back, and owes that instead', () => {
    const row = entry({ id: 'a' })
    let state = removeLocal(upsertLocal(EMPTY, row, 't1'), row, 't2')
    state = upsertLocal(state, row, 't3')

    expect(state.entries).toHaveLength(1)
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]?.deleted_at).toBeNull()
  })
})

describe('a write landing', () => {
  it('stops owing the row', () => {
    const state = settle(upsertLocal(EMPTY, entry({ id: 'a' }), 't1'), 'a', 't1')
    expect(state.pending).toHaveLength(0)
    expect(state.entries).toHaveLength(1)
  })

  it('keeps owing a row that was edited again while the write was in flight', () => {
    // The reply describes a version of the row that no longer exists. Treating
    // it as settled would mean the edit made a moment ago is never sent.
    let state = upsertLocal(EMPTY, entry({ id: 'a', title: 'sent' }), 't1')
    state = upsertLocal(state, entry({ id: 'a', title: 'edited since' }), 't2')
    state = settle(state, 'a', 't1')

    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]?.title).toBe('edited since')
  })
})

describe('folding a read into what this device holds', () => {
  const local = (rows: Entry[], pending: Stored['pending'] = []): Stored => ({
    version: 1,
    entries: rows,
    pending,
  })

  it('takes the server as the truth for a day it just read', () => {
    const state = reconcile(
      local([entry({ id: 'stale', occurred_on: '2026-09-05' })]),
      [entry({ id: 'fresh', occurred_on: '2026-09-05' })],
      '2026-09-05',
    )
    expect(state.entries.map((row) => row.id)).toEqual(['fresh'])
  })

  it('leaves other days alone, so a day already seen stays readable', () => {
    const state = reconcile(
      local([entry({ id: 'elsewhere', occurred_on: '2026-08-01' })]),
      [entry({ id: 'fresh', occurred_on: '2026-09-05' })],
      '2026-09-05',
    )
    expect(state.entries.map((row) => row.id).sort()).toEqual(['elsewhere', 'fresh'])
  })

  it('drops what a full read did not return, since that row is genuinely gone', () => {
    const state = reconcile(
      local([entry({ id: 'deleted-elsewhere', occurred_on: '2026-08-01' })]),
      [entry({ id: 'kept', occurred_on: '2026-09-05' })],
      null,
    )
    expect(state.entries.map((row) => row.id)).toEqual(['kept'])
  })

  it('never lets the server overwrite a change that has not synced yet', () => {
    // The server's copy is the one about to be replaced. Preferring it is how an
    // edit made offline vanishes the moment the network returns.
    const mine = { ...entry({ id: 'a', title: 'my edit' }), deleted_at: null, queued_at: 't1' }
    const state = reconcile(
      local([entry({ id: 'a', title: 'my edit' })], [mine]),
      [entry({ id: 'a', title: 'the old title' })],
      '2026-09-05',
    )
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.title).toBe('my edit')
  })

  it('keeps a row deleted here that the server has not caught up with', () => {
    const gone = { ...entry({ id: 'a' }), deleted_at: 't2', queued_at: 't2' }
    const state = reconcile(local([], [gone]), [entry({ id: 'a' })], '2026-09-05')
    expect(state.entries).toHaveLength(0)
  })

  it('does not delete an entry logged after the read was sent', () => {
    // The reply describes the log as it was when the server answered. An entry
    // typed while the read was in flight, whose own write then landed first, is
    // absent from it and no longer pending — and was dropped off the device,
    // vanishing from the screen while sitting safely on the server.
    const sent = '2026-09-11T10:00:00.000Z'
    const justLogged = entry({
      id: 'typed-meanwhile',
      occurred_on: '2026-09-05',
      created_at: '2026-09-11T10:00:04.000Z',
    })

    const state = reconcile(local([justLogged]), [], '2026-09-05', sent)
    expect(state.entries.map((row) => row.id)).toEqual(['typed-meanwhile'])
  })

  it('still drops a row the read predates, whatever its offset says', () => {
    // The guard must not become "keep everything": a row created before the
    // read and absent from it really was deleted somewhere else. Compared as
    // moments, not as text — the server stamps +05:30 and the client stamps Z.
    const sent = '2026-09-11T10:00:00.000Z'
    const older = entry({
      id: 'deleted-elsewhere',
      occurred_on: '2026-09-05',
      created_at: '2026-09-11T14:00:00+05:30', // 08:30Z, before the read
    })

    const state = reconcile(local([older]), [], '2026-09-05', sent)
    expect(state.entries).toHaveLength(0)
  })

  it('never shows one entry twice, whichever day it is read from', () => {
    // A row moved to another day is returned by a read of where it went while
    // this device still holds it under where it was.
    const state = reconcile(
      local([entry({ id: 'a', occurred_on: '2026-08-01' })]),
      [entry({ id: 'a', occurred_on: '2026-09-05' })],
      '2026-09-05',
    )
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]?.occurred_on).toBe('2026-09-05')
  })
})

describe('surviving a reload', () => {
  it('reads back what it wrote', () => {
    const storage = fakeStorage()
    const state = upsertLocal(EMPTY, entry({ id: 'a' }), 't1')
    save(storage, 'user-1', state)

    const again = load(storage, 'user-1')
    expect(again.entries.map((row) => row.id)).toEqual(['a'])
    expect(again.pending.map((row) => row.id)).toEqual(['a'])
  })

  it('keeps one user out of another user’s log', () => {
    const storage = fakeStorage()
    save(storage, 'user-1', upsertLocal(EMPTY, entry({ id: 'a' }), 't1'))
    expect(load(storage, 'user-2')).toEqual(EMPTY)
    // And the first user's unsynced write is still there when they come back.
    expect(load(storage, 'user-1').pending).toHaveLength(1)
  })

  it('starts empty rather than throwing on a corrupt value', () => {
    const storage = fakeStorage()
    storage.setItem(keyFor('user-1'), '{not json')
    // An empty cache costs a fetch. A throw at boot costs the whole app.
    expect(load(storage, 'user-1')).toEqual(EMPTY)
  })

  it('starts empty rather than throwing when storage cannot be read at all', () => {
    expect(load(fakeStorage({ unreadable: true }), 'user-1')).toEqual(EMPTY)
  })

  it('ignores a version it does not understand', () => {
    const storage = fakeStorage()
    storage.setItem(keyFor('user-1'), JSON.stringify({ version: 99, entries: [entry()] }))
    expect(load(storage, 'user-1')).toEqual(EMPTY)
  })

  it('drops rows that are not rows, and keeps the ones that are', () => {
    const storage = fakeStorage()
    storage.setItem(
      keyFor('user-1'),
      JSON.stringify({ version: 1, entries: [entry({ id: 'good' }), null, 7, {}], pending: [] }),
    )
    expect(load(storage, 'user-1').entries.map((row) => row.id)).toEqual(['good'])
  })

  it('drops a row whose shape would take the screen down or corrupt a number', () => {
    // Every one of these is dereferenced without asking, on every launch, from
    // a value still sitting in localStorage with no screen left to clear it.
    const storage = fakeStorage()
    const bad: unknown[] = [
      // React throws outright rendering an object as a child.
      { ...entry({ id: 'object-title' }), title: { text: 'lunch' } },
      // `KIND_NAME[kind]` and the colour maps are total over four values.
      { ...entry({ id: 'fifth-kind' }), kind: 'invoice' },
      // `parseISO` feeds `format`, which throws on a date it cannot read.
      { ...entry({ id: 'bad-day' }), occurred_on: 'the fifth' },
      { ...entry({ id: 'bad-clock' }), occurred_at: 1757000000000 },
      // `total + row.amount_paise` on a string concatenates rather than adds,
      // so a day of ₹350 and ₹120 silently totals "0350120".
      { ...entry({ id: 'string-money' }), amount_paise: '35000' },
      { ...entry({ id: 'string-minutes' }), duration_minutes: '60' },
      { ...entry({ id: '' }), id: '' },
    ]

    storage.setItem(
      keyFor('user-1'),
      JSON.stringify({ version: 1, entries: [...bad, entry({ id: 'good' })], pending: [] }),
    )
    expect(load(storage, 'user-1').entries.map((row) => row.id)).toEqual(['good'])
  })

  it('keeps the fields that are genuinely allowed to be absent', () => {
    // Tightening the guard must not start throwing away ordinary rows: a note
    // has no amount, no duration, no category, no clock and no note text.
    const storage = fakeStorage()
    const bare = {
      ...entry({ id: 'a-note' }),
      kind: 'note',
      occurred_at: null,
      note: null,
      amount_paise: null,
      duration_minutes: null,
      category: null,
    }
    storage.setItem(keyFor('user-1'), JSON.stringify({ version: 1, entries: [bare], pending: [] }))
    expect(load(storage, 'user-1').entries.map((row) => row.id)).toEqual(['a-note'])
  })

  it('drops a row missing the `data` every row is read through', () => {
    // `done`, `weeklyDays` and `repeatLabel` all reach into `entry.data` while
    // painting the timeline. A stored row without it would throw on every
    // launch, with the bad value still in storage and no screen left to clear
    // it from — which is the failure this guard exists to prevent.
    const storage = fakeStorage()
    const { data: _data, ...dataless } = entry({ id: 'half-written' })
    storage.setItem(
      keyFor('user-1'),
      JSON.stringify({
        version: 1,
        entries: [entry({ id: 'good' }), dataless, { ...entry({ id: 'nulled' }), data: null }],
        pending: [],
      }),
    )
    expect(load(storage, 'user-1').entries.map((row) => row.id)).toEqual(['good'])
  })

  it('saves the unsynced writes even when the whole log will not fit', () => {
    // The cache can be fetched again. A write that exists only here cannot.
    const storage = fakeStorage({ full: true })
    const many = Array.from({ length: 40 }, (_, index) => entry({ id: `row-${index}` }))
    save(storage, 'user-1', { version: 1, entries: many, pending: [] })

    const state = upsertLocal({ version: 1, entries: many, pending: [] }, entry({ id: 'mine' }), 't1')
    save(storage, 'user-1', state)

    const again = load(storage, 'user-1')
    expect(again.pending.map((row) => row.id)).toEqual(['mine'])
  })

  it('gives a pending row a stamp even if it was stored without one', () => {
    // Without this it could never match in `settle`, and would be re-sent for ever.
    const storage = fakeStorage()
    storage.setItem(
      keyFor('user-1'),
      JSON.stringify({ version: 1, entries: [], pending: [entry({ id: 'a' })] }),
    )

    const held = load(storage, 'user-1')
    expect(held.pending[0]?.queued_at).toBe('')
    expect(held.pending[0]?.deleted_at).toBeNull()
    expect(settle(held, 'a', '').pending).toHaveLength(0)
  })
})

describe('adopting a guest log on sign-in', () => {
  /**
   * Signing in changes the key this device's log is stored under. Without this
   * every entry made without an account is still on the phone and no longer
   * reachable — which reads exactly like the app threw them away, and would be a
   * worse first impression than the sign-in wall it replaces.
   */
  const AT = '2026-09-14T11:00:00+05:30'

  it('moves every row onto the account', () => {
    const storage = fakeStorage()
    save(storage, 'local-1', {
      version: 1,
      entries: [entry({ id: 'a' }), entry({ id: 'b' })],
      pending: [],
    })

    adopt(storage, 'local-1', 'user-1', AT)

    expect(load(storage, 'user-1').entries.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('queues all of them, because the server has never seen one', () => {
    const storage = fakeStorage()
    save(storage, 'local-1', { version: 1, entries: [entry({ id: 'a' })], pending: [] })

    adopt(storage, 'local-1', 'user-1', AT)

    const owed = load(storage, 'user-1').pending
    expect(owed).toHaveLength(1)
    expect(owed[0]?.id).toBe('a')
    expect(owed[0]?.deleted_at).toBeNull()
    expect(owed[0]?.queued_at).toBe(AT)
  })

  it('leaves nothing behind under the old key', () => {
    const storage = fakeStorage()
    save(storage, 'local-1', { version: 1, entries: [entry({ id: 'a' })], pending: [] })

    adopt(storage, 'local-1', 'user-1', AT)

    expect(load(storage, 'local-1')).toEqual(EMPTY)
  })

  it('keeps what the account already held', () => {
    // Signing back in on a phone that was used as a guest in between: both logs
    // are real, and neither may replace the other.
    const storage = fakeStorage()
    save(storage, 'user-1', { version: 1, entries: [entry({ id: 'old' })], pending: [] })
    save(storage, 'local-1', { version: 1, entries: [entry({ id: 'new' })], pending: [] })

    adopt(storage, 'local-1', 'user-1', AT)

    expect(load(storage, 'user-1').entries.map((row) => row.id).sort()).toEqual(['new', 'old'])
  })

  it('does not replay a guest delete, which would ask to remove a row that never existed', () => {
    const storage = fakeStorage()
    const gone = entry({ id: 'binned' })
    save(storage, 'local-1', {
      version: 1,
      entries: [entry({ id: 'kept' })],
      pending: [{ ...gone, deleted_at: AT, queued_at: AT }],
    })

    adopt(storage, 'local-1', 'user-1', AT)

    const after = load(storage, 'user-1')
    expect(after.entries.map((row) => row.id)).toEqual(['kept'])
    expect(after.pending.map((row) => row.id)).toEqual(['kept'])
  })

  it('does nothing to the account when the guest log is empty', () => {
    const storage = fakeStorage()
    save(storage, 'user-1', { version: 1, entries: [entry({ id: 'old' })], pending: [] })

    adopt(storage, 'local-1', 'user-1', AT)

    expect(load(storage, 'user-1').entries.map((row) => row.id)).toEqual(['old'])
    expect(load(storage, 'user-1').pending).toEqual([])
  })
})
