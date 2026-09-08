// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEntries } from './useEntries'
import type { ParsedEntry } from '../lib/parser'

/**
 * The transitions, not the rendering. Every read and write in the app goes
 * through here, and until now none of it was covered.
 *
 * Supabase is replaced at the module boundary with a builder that records what
 * was asked of it — which also means a stray `.delete()` would throw, since the
 * fake deliberately has no such method and soft deletes are the rule. There is
 * no `.insert()` or `.update()` either: every write is one idempotent upsert of
 * the row's full current state, which is what makes a queue of offline writes
 * replayable in any order.
 */

/**
 * `status` matters as much as `error`. postgrest-js turns a failed fetch into an
 * ordinary error result carrying `status: 0` rather than rejecting, so a fake
 * that only sets `error` cannot tell "no network" apart from "the server
 * refused" — which is the distinction the app now depends on.
 */
type Result = { data?: unknown; error?: { message: string } | null; status?: number }

type Builder = {
  select: (...args: unknown[]) => Builder
  upsert: (...args: unknown[]) => Builder
  eq: (...args: unknown[]) => Builder
  is: (...args: unknown[]) => Builder
  gte: (...args: unknown[]) => Builder
  lte: (...args: unknown[]) => Builder
  order: (...args: unknown[]) => Builder
  then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
}

const calls: { op: string; arg: unknown }[] = []
let rowsOnServer: unknown[] = []
/** The server answers and refuses: an HTTP status, so waiting will not help. */
let writeFails = false
/**
 * No network, exactly as postgrest-js reports it: an error result with
 * `status: 0`, never a rejection. This is what the emulator actually does.
 */
let offlineResult = false
/** The rarer path, where the call really does reject. Also "no network". */
let readThrows = false
/** When set, every write waits on this before answering. */
let held: Promise<void> | null = null

function builder(): Builder {
  let writing = false
  const self: Builder = {
    select: (...args) => {
      calls.push({ op: 'select', arg: args[0] })
      return self
    },
    upsert: (...args) => {
      writing = true
      calls.push({ op: 'upsert', arg: args[0] })
      return self
    },
    eq: (...args) => {
      calls.push({ op: 'eq', arg: args[1] })
      return self
    },
    is: () => self,
    gte: () => self,
    lte: () => self,
    order: () => self,
    then: (resolve, reject) => {
      if (readThrows) {
        return Promise.reject(new TypeError('Failed to fetch')).then(resolve, reject)
      }
      if (offlineResult) {
        const down: Result = {
          data: null,
          error: { message: 'TypeError: Failed to fetch' },
          status: 0,
        }
        return Promise.resolve(down).then(resolve, reject)
      }
      const result: Result = writing
        ? writeFails
          ? { error: { message: 'permission denied' }, status: 403 }
          : { error: null, status: 201 }
        : { data: rowsOnServer, error: null, status: 200 }

      // A write can be held open, so a second entry can be logged while the
      // first one's request is still in flight.
      if (writing && held !== null) {
        return held.then(() => result).then(resolve, reject)
      }
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  return self
}

vi.mock('./../lib/supabase', () => ({ supabase: { from: () => builder() } }))

function serverRow(over: Record<string, unknown>) {
  return {
    id: 'server-1',
    kind: 'expense',
    occurred_on: '2026-09-05',
    occurred_at: null,
    title: 'from the server',
    note: null,
    amount_paise: 1000,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-05T09:00:00+05:30',
    ...over,
  }
}

const parsed: ParsedEntry = {
  kind: 'expense',
  occurredOn: '2026-09-05',
  title: 'lunch',
  amountPaise: 35000,
  data: {},
}

const USER = 'user-1'

/**
 * jsdom reports `navigator.onLine` as true always, so without this an "offline"
 * test is only testing a server that is down — which the app treats differently
 * and should.
 */
function connection(state: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => state })
}

let ids = 0
beforeEach(() => {
  calls.length = 0
  rowsOnServer = []
  writeFails = false
  readThrows = false
  offlineResult = false
  held = null
  ids = 0
  connection(true)
  // The log is persisted now, so without this each test inherits the last one's
  // entries — and its unsynced writes.
  localStorage.clear()
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `local-${++ids}` })
})

async function mounted(day = '2026-09-05') {
  const view = renderHook(() => useEntries(day, USER))
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

describe('optimistic insert', () => {
  it('shows the row before the server has answered', async () => {
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })
    // Present immediately, not after a round trip: capture must never wait.
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]?.title).toBe('lunch')
  })

  it('keeps the row and clears the flag once the server agrees', async () => {
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBeUndefined())
    expect(result.current.entries).toHaveLength(1)
    expect(calls.some((call) => call.op === 'upsert')).toBe(true)
  })

  it('flags the row rather than removing it when the write fails', async () => {
    writeFails = true
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })
    // Losing what was typed would be worse than showing it as unsaved.
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('failed'))
    expect(result.current.entries).toHaveLength(1)
  })

  it('replays the same write when retried', async () => {
    writeFails = true
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('failed'))

    writeFails = false
    act(() => {
      result.current.retry()
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBeUndefined())
    expect(calls.filter((call) => call.op === 'upsert')).toHaveLength(2)
  })

  it('syncs an entry logged while the previous one was still in flight', async () => {
    const { result } = await mounted()

    // The first write is held open, so the second entry is logged while a sync
    // is already running — which used to leave it queued until the app was
    // next brought back to the front.
    let release = () => {}
    held = new Promise<void>((resolve) => {
      release = resolve
    })

    act(() => {
      result.current.add(parsed)
    })
    act(() => {
      result.current.add({ ...parsed, title: 'coffee' })
    })

    expect(result.current.owed).toBe(2)
    held = null
    act(() => {
      release()
    })

    await waitFor(() => expect(result.current.owed).toBe(0))
    expect(result.current.entries).toHaveLength(2)
  })
})

describe('logging with no network', () => {
  /** No network, reported the way postgrest-js actually reports it. */
  function offline() {
    offlineResult = true
    connection(false)
  }

  it('keeps the entry, and says it is waiting rather than that it failed', async () => {
    offline()
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })

    // 'failed' would put a red Retry chip on every entry logged on a train.
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('queued'))
    expect(result.current.owed).toBe(1)
  })

  it('still says waiting when the device claims to be online but is not', async () => {
    // Both halves of what the emulator found. The network is genuinely
    // unreachable — airplane mode, ping failing — and yet the WebView reports
    // onLine as true, so trusting it labelled every unsent row 'failed' with a
    // red Retry chip on the exact platform this feature exists for. And the
    // failure arrives as an ordinary result with status 0, not as a rejection,
    // so the `catch` that was supposed to notice never ran.
    offlineResult = true
    connection(true)
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })

    await waitFor(() => expect(result.current.owed).toBe(1))
    expect(result.current.entries[0]?.status).toBe('queued')
    expect(result.current.reachable).toBe(false)
  })

  it('treats a request that really does reject as no network too', async () => {
    // The rarer path, and the reason the `catch` stays.
    readThrows = true
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })

    await waitFor(() => expect(result.current.owed).toBe(1))
    expect(result.current.entries[0]?.status).toBe('queued')
    expect(result.current.reachable).toBe(false)
  })

  it('gives up on a request that never answers, instead of saying "saving" for ever', async () => {
    // Found on the emulator: offline with an expired access token, supabase-js
    // waits on auth for a token that will not come, so the write neither
    // succeeded nor failed. The row read "saving" indefinitely — and the sync
    // loop's in-progress flag was never released, so every later sync was
    // blocked too, including the one due when the network returned.
    vi.useFakeTimers()
    try {
      held = new Promise<void>(() => {
        // Never resolves. This is the hang.
      })
      const view = renderHook(() => useEntries('2026-09-05', USER))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000)
      })

      act(() => {
        view.result.current.add(parsed)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000)
      })

      expect(view.result.current.entries[0]?.status).toBe('queued')
      expect(view.result.current.reachable).toBe(false)

      // And the loop is free again, so the next attempt actually runs.
      held = null
      act(() => {
        view.result.current.retry()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(view.result.current.owed).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never shows a raw fetch failure as though the server refused something', async () => {
    // "TypeError: Failed to fetch" was on screen on the emulator. It is not an
    // error the user can act on and not an explanation of anything.
    offlineResult = true
    const { result } = await mounted()
    expect(result.current.error).toBeNull()
    expect(result.current.reachable).toBe(false)
  })

  it('does call it a failure when the server answers and refuses', async () => {
    // The other half of the distinction: an answer means the server was there,
    // so this one is not going to fix itself by waiting.
    writeFails = true
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })

    await waitFor(() => expect(result.current.entries[0]?.status).toBe('failed'))
    expect(result.current.reachable).toBe(true)
  })

  it('survives the app being closed and reopened, which is the whole point', async () => {
    offline()
    const first = await mounted()
    act(() => {
      first.result.current.add(parsed)
    })
    await waitFor(() => expect(first.result.current.owed).toBe(1))
    first.unmount()

    // A fresh mount, reading only what was persisted. Held in React state, this
    // entry used to be gone for good while its reminder still fired.
    const again = await mounted()
    expect(again.result.current.entries).toHaveLength(1)
    expect(again.result.current.entries[0]?.title).toBe('lunch')
    expect(again.result.current.owed).toBe(1)
  })

  it('syncs what it was holding once the network is back', async () => {
    offline()
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('queued'))

    offlineResult = false
    connection(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(result.current.owed).toBe(0))
    expect(result.current.entries[0]?.status).toBeUndefined()
  })

  it('reads a day it has seen before from this device', async () => {
    rowsOnServer = [serverRow({})]
    const first = await mounted()
    await waitFor(() => expect(first.result.current.entries).toHaveLength(1))
    first.unmount()

    offline()
    const local = await mounted()
    expect(local.result.current.entries).toHaveLength(1)
    expect(local.result.current.entries[0]?.title).toBe('from the server')
  })

  it('answers a question from this device when the log cannot be fetched', async () => {
    rowsOnServer = [serverRow({})]
    const first = await mounted()
    await waitFor(() => expect(first.result.current.entries).toHaveLength(1))
    first.unmount()

    offline()
    const local = await mounted()
    // The corpus behind `?` questions, the memories under a day, the export and
    // the set reminders are re-armed from all come through here.
    const all = await local.result.current.fetchAll()
    expect(all.map((row) => row.title)).toEqual(['from the server'])
  })

  it('still marks the calendar for a day only this device knows about', async () => {
    offline()
    const { result } = await mounted()
    act(() => {
      result.current.add({ ...parsed, occurredOn: '2026-09-02' })
    })
    await waitFor(() => expect(result.current.owed).toBe(1))

    const days = await result.current.fetchDays('2026-09-01', '2026-09-30')
    expect(days).toContain('2026-09-02')
  })
})

describe('refetching a day', () => {
  /** Leaving the day and returning is what actually triggers a refetch. */
  async function acrossADayChange() {
    const view = renderHook((day: string) => useEntries(day, USER), {
      initialProps: '2026-09-05',
    })
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    return view
  }

  it('keeps an unresolved write that the server does not know about yet', async () => {
    writeFails = true
    const { result, rerender } = await acrossADayChange()
    act(() => {
      result.current.add(parsed)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('failed'))

    rowsOnServer = [serverRow({ id: 'server-1' })]
    rerender('2026-09-04')
    await waitFor(() => expect(result.current.entries).toHaveLength(0))
    rerender('2026-09-05')

    // The failed row survived a round trip it was never part of.
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    const titles = result.current.entries.map((entry) => entry.title)
    expect(titles).toContain('lunch')
    expect(titles).toContain('from the server')
  })

  it('lets the server replace a row whose write did land', async () => {
    const { result, rerender } = await acrossADayChange()
    act(() => {
      result.current.add(parsed)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBeUndefined())

    // The same entry, as the server now returns it. It must not appear twice.
    rowsOnServer = [serverRow({ id: 'local-1', title: 'lunch' })]
    rerender('2026-09-04')
    rerender('2026-09-05')

    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(result.current.entries[0]?.id).toBe('local-1')
  })
})

describe('deleting', () => {
  it('is a soft delete, and the row leaves the list at once', async () => {
    rowsOnServer = [serverRow({})]
    const { result } = await mounted()
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    const row = result.current.entries[0]
    act(() => {
      if (row) result.current.remove(row)
    })

    expect(result.current.entries).toHaveLength(0)
    await waitFor(() => {
      const write = calls.find((call) => call.op === 'upsert')
      // A soft delete is an upsert too: the row's desired state carries the
      // timestamp, so replaying it out of order cannot resurrect the row.
      expect((write?.arg as { deleted_at?: unknown }).deleted_at).toBeTruthy()
    })
  })

  it('brings the row back when undone', async () => {
    rowsOnServer = [serverRow({})]
    const { result } = await mounted()
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    const row = result.current.entries[0]
    act(() => {
      if (row) result.current.remove(row)
    })
    await waitFor(() => expect(result.current.entries).toHaveLength(0))

    act(() => {
      if (row) result.current.restore(row)
    })
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    const cleared = calls.filter(
      (call) => call.op === 'upsert' && (call.arg as { deleted_at?: unknown }).deleted_at === null,
    )
    expect(cleared).toHaveLength(1)
  })

  it('puts the row back if the server answers and refuses the delete', async () => {
    rowsOnServer = [serverRow({})]
    const { result } = await mounted()
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    writeFails = true
    const row = result.current.entries[0]
    act(() => {
      if (row) result.current.remove(row)
    })

    // Pretending it is gone when it is not would be a lie the next refetch undoes.
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(result.current.entries[0]?.status).toBe('failed')
  })

  it('keeps the row deleted when the delete is only waiting for a network', async () => {
    rowsOnServer = [serverRow({})]
    const first = await mounted()
    await waitFor(() => expect(first.result.current.entries).toHaveLength(1))

    offlineResult = true
    connection(false)
    // The event, not just the flag: the hook is already mounted, and it learns
    // about a lost connection the same way the browser tells it.
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    const row = first.result.current.entries[0]
    act(() => {
      if (row) first.result.current.remove(row)
    })

    // Unlike a refusal, this write is going to land — resurrecting the row would
    // mean undoing a delete the user made, which is worse than either outcome.
    await waitFor(() => expect(first.result.current.owed).toBe(1))
    expect(first.result.current.entries).toHaveLength(0)

    first.unmount()
    const again = await mounted()
    expect(again.result.current.entries).toHaveLength(0)
  })
})

describe('a write that belongs to another day', () => {
  it('surfaces the failure, which would otherwise be invisible', async () => {
    writeFails = true
    const { result } = await mounted('2026-09-05')

    act(() => {
      result.current.add({ ...parsed, occurredOn: '2026-09-01', title: 'backfilled' })
    })

    await waitFor(() => expect(result.current.failedElsewhere).toHaveLength(1))
    // Not on the visible day, so the timeline alone would never show it.
    expect(result.current.entries).toHaveLength(0)
    expect(result.current.failedElsewhere[0]?.title).toBe('backfilled')
  })
})

describe('the calendar dots', () => {
  it('reports each day once, however many entries it holds', async () => {
    rowsOnServer = [
      { occurred_on: '2026-09-01' },
      { occurred_on: '2026-09-01' },
      { occurred_on: '2026-09-04' },
    ]
    const { result } = await mounted()

    const days = await result.current.fetchDays('2026-09-01', '2026-09-30')
    expect(days).toEqual(['2026-09-01', '2026-09-04'])
  })
})
