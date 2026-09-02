import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedEntry } from '../lib/parser'
import { supabase } from '../lib/supabase'
import type { Entry } from '../types'

const COLUMNS =
  'id,kind,occurred_on,occurred_at,title,note,amount_paise,duration_minutes,category,data,created_at'

/** A write in flight, or one that failed and can be retried. Absent means the row matches the server. */
export type WriteState = 'saving' | 'failed'

export type Row = Entry & { status?: WriteState }

/** The columns the inline editor is allowed to change. */
export type Patch = Partial<
  Pick<
    Entry,
    | 'title'
    | 'note'
    | 'occurred_on'
    | 'occurred_at'
    | 'amount_paise'
    | 'duration_minutes'
    | 'category'
    | 'kind'
  >
>

type WriteResult = { error: { message: string } | null }

/** Timed rows first, in clock order; untimed rows after, oldest first. */
function byTime(a: Row, b: Row): number {
  if (a.occurred_at !== null && b.occurred_at !== null) {
    return a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0
  }
  if (a.occurred_at !== null) return -1
  if (b.occurred_at !== null) return 1
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

function payloadOf(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    occurred_on: row.occurred_on,
    occurred_at: row.occurred_at,
    title: row.title,
    note: row.note,
    amount_paise: row.amount_paise,
    duration_minutes: row.duration_minutes,
    category: row.category,
    data: row.data,
  }
}

/**
 * Replace what we hold for `day` with the server's answer, but keep any row whose
 * write is still unresolved — a pending insert for another day must not be discarded
 * just because the visible day was refetched.
 */
function merge(prev: Row[], fetched: Entry[]): Row[] {
  const landed = new Set(fetched.map((row) => row.id))
  const unresolved = prev.filter((row) => row.status !== undefined && !landed.has(row.id))
  return [...unresolved, ...fetched]
}

export function useEntries(day: string) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const retries = useRef(new Map<string, () => Promise<void>>())

  useEffect(() => {
    let live = true
    setLoading(true)

    void supabase
      .from('entries')
      .select(COLUMNS)
      .eq('occurred_on', day)
      .is('deleted_at', null)
      .then(({ data, error: readError }) => {
        if (!live) return
        if (readError) {
          setError(readError.message)
        } else {
          setError(null)
          setRows((prev) => merge(prev, (data ?? []) as Entry[]))
        }
        setLoading(false)
      })

    return () => {
      live = false
    }
  }, [day])

  const mark = useCallback((id: string, status: WriteState | undefined) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)))
  }, [])

  /** Run a write, flag the row on failure, and remember the attempt so `retry` can repeat it. */
  const persist = useCallback(
    (id: string, send: () => Promise<WriteResult>) => {
      const attempt = async (): Promise<void> => {
        mark(id, 'saving')
        const { error: writeError } = await send()
        if (writeError) {
          mark(id, 'failed')
          return
        }
        retries.current.delete(id)
        mark(id, undefined)
      }
      retries.current.set(id, attempt)
      void attempt()
    },
    [mark],
  )

  const add = useCallback(
    (parsed: ParsedEntry): Row => {
      const row: Row = {
        id: crypto.randomUUID(),
        kind: parsed.kind,
        occurred_on: parsed.occurredOn,
        occurred_at: parsed.occurredAt ?? null,
        title: parsed.title,
        note: null,
        amount_paise: parsed.amountPaise ?? null,
        duration_minutes: parsed.durationMinutes ?? null,
        category: parsed.category ?? null,
        data: parsed.data,
        created_at: new Date().toISOString(),
        status: 'saving',
      }

      setRows((prev) => [...prev, row])
      persist(row.id, async () => await supabase.from('entries').insert(payloadOf(row)))
      return row
    },
    [persist],
  )

  const update = useCallback(
    (row: Row, patch: Patch) => {
      setRows((prev) =>
        prev.map((current) =>
          current.id === row.id ? { ...current, ...patch, status: 'saving' } : current,
        ),
      )
      persist(row.id, async () => await supabase.from('entries').update(patch).eq('id', row.id))
    },
    [persist],
  )

  /** Soft delete. The row leaves the list at once and comes back flagged if the write fails. */
  const remove = useCallback((row: Row) => {
    const attempt = async (): Promise<void> => {
      setRows((prev) => prev.filter((current) => current.id !== row.id))

      const { error: writeError } = await supabase
        .from('entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', row.id)

      if (!writeError) {
        retries.current.delete(row.id)
        return
      }
      setRows((prev) =>
        prev.some((current) => current.id === row.id) ? prev : [...prev, { ...row, status: 'failed' }],
      )
    }

    retries.current.set(row.id, attempt)
    void attempt()
  }, [])

  /** Undo a soft delete. Reversible actions get an undo, not a confirmation. */
  const restore = useCallback(
    (row: Row) => {
      const attempt = async (): Promise<void> => {
        setRows((prev) =>
          prev.some((current) => current.id === row.id) ? prev : [...prev, { ...row, status: 'saving' }],
        )
        const { error: writeError } = await supabase
          .from('entries')
          .update({ deleted_at: null })
          .eq('id', row.id)

        if (writeError) {
          mark(row.id, 'failed')
          return
        }
        retries.current.delete(row.id)
        mark(row.id, undefined)
      }

      retries.current.set(row.id, attempt)
      void attempt()
    },
    [mark],
  )

  const retry = useCallback((row: Row) => {
    const attempt = retries.current.get(row.id)
    if (attempt) void attempt()
  }, [])

  /** The distinct days in a range that hold at least one entry, for the calendar dots. */
  const fetchDays = useCallback(async (from: string, to: string): Promise<string[]> => {
    const { data, error: readError } = await supabase
      .from('entries')
      .select('occurred_on')
      .gte('occurred_on', from)
      .lte('occurred_on', to)
      .is('deleted_at', null)

    if (readError) throw new Error(readError.message)
    const found = (data ?? []) as { occurred_on: string }[]
    return [...new Set(found.map((row) => row.occurred_on))]
  }, [])

  /** Every surviving entry, for Export JSON. */
  const fetchAll = useCallback(async (): Promise<Entry[]> => {
    const { data, error: readError } = await supabase
      .from('entries')
      .select(COLUMNS)
      .is('deleted_at', null)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: true })

    if (readError) throw new Error(readError.message)
    return (data ?? []) as Entry[]
  }, [])

  const entries = useMemo(
    () => rows.filter((row) => row.occurred_on === day).sort(byTime),
    [rows, day],
  )

  /** Failed writes for other days, so a backfill that did not land is still visible. */
  const failedElsewhere = useMemo(
    () => rows.filter((row) => row.status === 'failed' && row.occurred_on !== day),
    [rows, day],
  )

  return {
    entries,
    failedElsewhere,
    loading,
    error,
    add,
    update,
    remove,
    restore,
    retry,
    fetchAll,
    fetchDays,
  }
}
