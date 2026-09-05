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
 * fake deliberately has no such method and soft deletes are the rule.
 */

type Result = { data?: unknown; error?: { message: string } | null }

type Builder = {
  select: (...args: unknown[]) => Builder
  insert: (...args: unknown[]) => Builder
  update: (...args: unknown[]) => Builder
  eq: (...args: unknown[]) => Builder
  is: (...args: unknown[]) => Builder
  gte: (...args: unknown[]) => Builder
  lte: (...args: unknown[]) => Builder
  order: (...args: unknown[]) => Builder
  then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
}

const calls: { op: string; arg: unknown }[] = []
let rowsOnServer: unknown[] = []
let writeFails = false

function builder(): Builder {
  let writing = false
  const self: Builder = {
    select: (...args) => {
      calls.push({ op: 'select', arg: args[0] })
      return self
    },
    insert: (...args) => {
      writing = true
      calls.push({ op: 'insert', arg: args[0] })
      return self
    },
    update: (...args) => {
      writing = true
      calls.push({ op: 'update', arg: args[0] })
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
      const result: Result = writing
        ? { error: writeFails ? { message: 'network down' } : null }
        : { data: rowsOnServer, error: null }
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

let ids = 0
beforeEach(() => {
  calls.length = 0
  rowsOnServer = []
  writeFails = false
  ids = 0
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `local-${++ids}` })
})

async function mounted(day = '2026-09-05') {
  const view = renderHook(() => useEntries(day))
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
    expect(calls.some((call) => call.op === 'insert')).toBe(true)
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

  it('replays the same insert when retried', async () => {
    writeFails = true
    const { result } = await mounted()
    act(() => {
      result.current.add(parsed)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('failed'))

    writeFails = false
    const row = result.current.entries[0]
    act(() => {
      if (row) result.current.retry(row)
    })
    await waitFor(() => expect(result.current.entries[0]?.status).toBeUndefined())
    expect(calls.filter((call) => call.op === 'insert')).toHaveLength(2)
  })
})

describe('refetching a day', () => {
  /** Leaving the day and returning is what actually triggers a refetch. */
  async function acrossADayChange() {
    const view = renderHook((day: string) => useEntries(day), { initialProps: '2026-09-05' })
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
      const write = calls.find((call) => call.op === 'update')
      expect(write?.arg).toHaveProperty('deleted_at')
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
      (call) => call.op === 'update' && (call.arg as { deleted_at?: unknown }).deleted_at === null,
    )
    expect(cleared).toHaveLength(1)
  })

  it('puts the row back if the delete itself fails', async () => {
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
