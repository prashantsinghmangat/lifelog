import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOnline } from './useOnline'
import { byClock } from '../lib/history'
import type { ParsedEntry } from '../lib/parser'
import {
  EMPTY,
  load,
  payloadOf,
  reconcile,
  removeLocal,
  save,
  settle,
  upsertLocal,
  type Stored,
} from '../lib/store'
import { supabase } from '../lib/supabase'
import type { Entry } from '../types'

const COLUMNS =
  'id,kind,occurred_on,occurred_at,title,note,amount_paise,duration_minutes,category,data,created_at'

/**
 * Every Supabase call, and the only writer of the local log.
 *
 * **This device is what you are reading; the server is a copy of it.** Writes
 * land in `store.ts` synchronously and durably, then sync when they can — on
 * launch, when the network returns, and whenever the app is brought back to the
 * front. Nothing about logging an entry, seeing a day, totalling it or setting
 * a reminder waits on a request, because none of it needs one.
 *
 * Reads fold into the same local log rather than replacing it, so a day already
 * seen stays readable with no network, and after one online launch — which
 * fetches everything to re-arm reminders — the whole log is readable offline.
 */

/**
 * `queued` is not a failure: the write is durable and waiting for a connection.
 * Calling that "failed" put a red Retry chip on every entry logged on a train,
 * which is alarming about the one case the app now handles properly.
 */
export type WriteState = 'saving' | 'queued' | 'failed'

/**
 * How the last attempt at a row ended.
 *
 * **The two failures are not the same failure, and `navigator.onLine` cannot
 * tell them apart.** On the Android emulator, with the network genuinely
 * unreachable — airplane mode, `ping` failing — the WebView still reports
 * `onLine === true`, so a row that could not be sent was labelled `failed` with
 * a red Retry chip, on the exact platform this feature exists for. Reachability
 * is therefore *observed* from what happened to the request rather than asked
 * of the browser: a request that never got an answer means no network, and an
 * error the server actually sent back means the server refused.
 */
type Attempt = 'saving' | 'unreachable' | 'refused'

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
    | 'data'
  >
>

/** Drops the display-only flag, so it is never written to storage or the wire. */
function bare({ status: _status, ...entry }: Row): Entry {
  return entry
}

/**
 * Whether a reply means "there was no network" rather than "the server said no".
 *
 * **A failed fetch does not reject.** postgrest-js catches it and returns an
 * ordinary error result carrying `status: 0`, so the `catch` around these calls
 * almost never fires. Verified on the emulator: in airplane mode a read came
 * back as `{ error: 'TypeError: Failed to fetch', status: 0 }` and the app
 * printed that at the user as though the server had refused something. An HTTP
 * status is proof the server answered; its absence is proof it did not.
 */
function unreachable(result: { status?: number }): boolean {
  return result.status === undefined || result.status === 0
}

/**
 * How long a request gets before it is treated as no network.
 *
 * Not a guess: on the emulator, offline with an expired access token, a write
 * never settled at all. supabase-js asks auth for a token before sending, and
 * auth sits in its own refresh-retry loop, so the request neither succeeded nor
 * failed. The row showed "saving" indefinitely — claiming a write is in flight
 * that nothing will ever finish — and, far worse, the sync loop's in-progress
 * flag was never released, so *every later sync was blocked too*, including the
 * one that should have run when the network came back.
 */
const PATIENCE = 10_000

/**
 * Stops waiting after `ms` and says so, rather than awaiting a promise that may
 * never settle. The abandoned request is left to its fate: every write here is
 * an idempotent upsert, so one that lands after we gave up on it changes
 * nothing, and one that does not gets sent again.
 */
async function impatient<T>(work: PromiseLike<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Newest day first, oldest entry within it — the order `fetchAll` returned. */
function byDayDescending(rows: Entry[]): Entry[] {
  return [...rows].sort(
    (a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) || a.created_at.localeCompare(b.created_at),
  )
}

export function useEntries(day: string, userId: string) {
  const online = useOnline()
  const [stored, setStored] = useState<Stored>(() =>
    typeof localStorage === 'undefined' ? EMPTY : load(localStorage, userId),
  )
  // Last outcome of a sync attempt, per row. Absent means never attempted,
  // which is what a write made with no network looks like.
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Whether the last request got an answer of any kind. Observed, not asked —
  // see `Attempt`. This is what the UI says "offline" from.
  const [reachable, setReachable] = useState(true)

  /**
   * The log, held where a callback can read it without being rebuilt when it
   * changes — `flush` is a dependency of the effects that wake it up, so a
   * `flush` that changed on every write would restart the sync on every write.
   *
   * **This ref is the authority and the state is its mirror**, not the other way
   * round. `write` has to attempt the sync in the same tick, before React has
   * re-rendered, so reading the state there would read the log as it was before
   * the entry existed and send nothing. Every mutation therefore goes through
   * `apply`, which advances the ref and the state together.
   */
  const current = useRef(stored)
  const flushing = useRef(false)
  /** Something was written while a sync was already running. */
  const again = useRef(false)

  const apply = useCallback((next: (state: Stored) => Stored) => {
    const updated = next(current.current)
    current.current = updated
    setStored(updated)
  }, [])

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    save(localStorage, userId, stored)
  }, [stored, userId])

  /**
   * Sends every row the server is behind on, one idempotent upsert each.
   *
   * A rejected row does not stop the others: the writes are independent, and one
   * row the server refuses is no reason to strand the rest.
   */
  const flush = useCallback(async (): Promise<void> => {
    // Already running. Noted rather than dropped: two entries logged in quick
    // succession put the second one's sync here, and returning without a mark
    // left it sitting until the app next came back to the front.
    if (flushing.current) {
      again.current = true
      return
    }
    if (current.current.pending.length === 0) return

    flushing.current = true
    try {
      do {
        again.current = false
        // Re-read each pass: a row written during the last one is owed too.
        for (const row of current.current.pending) {
          setAttempts((prev) => ({ ...prev, [row.id]: 'saving' }))

          // A write can reject instead of answering — that is what a dropped
          // connection looks like. Uncaught, it escaped the loop and left the
          // row reading "saving" for ever, which is worse than saying it
          // failed: it claims a write is in flight that nothing will finish.
          let outcome: Exclude<Attempt, 'saving'> | null = null
          try {
            const result = await impatient(
              supabase.from('entries').upsert(payloadOf(row)),
              PATIENCE,
            )
            if (result === 'timeout') {
              setReachable(false)
              outcome = 'unreachable'
            } else if (result.error === null) {
              setReachable(true)
              outcome = null
            } else if (unreachable(result)) {
              setReachable(false)
              outcome = 'unreachable'
            } else {
              // An answer, even a refusal, means the server was reached — and
              // that this will not fix itself by waiting.
              setReachable(true)
              outcome = 'refused'
            }
          } catch {
            setReachable(false)
            outcome = 'unreachable'
          }

          if (outcome !== null) {
            setAttempts((prev) => ({ ...prev, [row.id]: outcome }))
            continue
          }

          apply((prev) => settle(prev, row.id, row.queued_at))
          setAttempts((prev) => {
            const next = { ...prev }
            delete next[row.id]
            return next
          })
        }
        // Only a write that arrived mid-pass asks for another one, so this
        // stops as soon as nothing new has been logged.
      } while (again.current)
    } finally {
      flushing.current = false
      again.current = false
    }
  }, [apply])

  // Launch, and every time the network comes back.
  useEffect(() => {
    void flush()
  }, [flush, online])

  // `online` does not fire reliably in an Android WebView, and a phone that has
  // been in a pocket since the entry was logged reports nothing at all. Coming
  // back to the app is the signal that actually happens.
  useEffect(() => {
    const wake = () => void flush()
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [flush])

  /**
   * The backstop, and on Android the thing that actually recovers a write.
   *
   * Verified on the emulator: with the network genuinely unreachable the
   * WebView still reports `onLine === true`, so it never reports going *back*
   * online either — the `online` event cannot be relied on to fire at all. With
   * the app left in the foreground and no reason to refocus it, an entry logged
   * offline would sit unsynced indefinitely. Armed only while something is
   * owed, so a log with nothing pending makes no requests.
   */
  const owing = stored.pending.length > 0
  useEffect(() => {
    if (!owing) return
    const ticking = window.setInterval(() => void flush(), 30_000)
    return () => window.clearInterval(ticking)
  }, [owing, flush])

  useEffect(() => {
    let live = true
    setLoading(true)

    // Wrapped rather than chained: a read that rejects instead of resolving with
    // an error must not become an unhandled rejection, and offline is the common
    // case for exactly that.
    const read = async (): Promise<void> => {
      try {
        const result = await impatient(
          supabase.from('entries').select(COLUMNS).eq('occurred_on', day).is('deleted_at', null),
          PATIENCE,
        )

        if (!live) return
        if (result === 'timeout') {
          setReachable(false)
          setError(null)
          return
        }
        const { data, error: readError } = result

        if (readError === null) {
          setReachable(true)
          setError(null)
          apply((prev) => reconcile(prev, (data ?? []) as Entry[], day))
        } else if (unreachable(result)) {
          // No network. Not an error the user can act on, and the raw
          // "TypeError: Failed to fetch" is the opposite of an explanation —
          // the offline line says it properly instead.
          setReachable(false)
          setError(null)
        } else {
          setReachable(true)
          setError(readError.message)
        }
      } catch {
        if (!live) return
        setReachable(false)
        setError(null)
      } finally {
        if (live) setLoading(false)
      }
    }

    void read()

    return () => {
      live = false
    }
  }, [day, apply])

  const rows = useMemo((): Row[] => {
    const owed = new Set(stored.pending.map((row) => row.id))

    const held: Row[] = stored.entries.map((row) => {
      if (!owed.has(row.id)) return row
      const attempt = attempts[row.id]
      // A write that could not reach the server is queued, not failed. Only a
      // server that answered and refused is a failure worth a Retry — and note
      // this asks what happened to the request, never `navigator.onLine`.
      if (attempt === 'saving') return { ...row, status: 'saving' }
      if (attempt === 'refused') return { ...row, status: 'failed' }
      return { ...row, status: 'queued' }
    })

    // A delete the server answered and *refused* has to come back: claiming the
    // row is gone when it is not is a lie the next full read undoes anyway. A
    // delete that could not be sent stays gone, because it is going to land —
    // that is the whole point of holding it.
    const refused: Row[] = stored.pending
      .filter((row) => row.deleted_at !== null && attempts[row.id] === 'refused')
      .map(({ deleted_at: _deleted, queued_at: _queued, ...entry }) => ({
        ...entry,
        status: 'failed' as const,
      }))

    return [...held, ...refused]
  }, [stored, attempts])

  const write = useCallback(
    (next: (state: Stored, at: string) => Stored) => {
      const at = new Date().toISOString()
      apply((prev) => next(prev, at))
      // Attempted at once, so an entry logged with a connection is saved with a
      // connection rather than waiting for a wake-up.
      void flush()
    },
    [apply, flush],
  )

  const add = useCallback(
    (parsed: ParsedEntry): Row => {
      const row: Entry = {
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
      }

      write((state, at) => upsertLocal(state, row, at))
      return { ...row, status: online ? 'saving' : 'queued' }
    },
    [write, online],
  )

  const update = useCallback(
    (row: Row, patch: Patch) => {
      const next = { ...bare(row), ...patch }
      write((state, at) => upsertLocal(state, next, at))
    },
    [write],
  )

  /** Soft delete. Gone from this device at once, and owed to the server. */
  const remove = useCallback(
    (row: Row) => {
      write((state, at) => removeLocal(state, bare(row), at))
    },
    [write],
  )

  /** Undo a soft delete. Reversible actions get an undo, not a confirmation. */
  const restore = useCallback(
    (row: Row) => {
      write((state, at) => upsertLocal(state, bare(row), at))
    },
    [write],
  )

  /** Sends everything still owed. Nothing is per-row: the sync is the whole set. */
  const retry = useCallback(() => {
    void flush()
  }, [flush])

  /**
   * The distinct days in a range holding at least one entry, for the calendar
   * dots. Falls back to this device's copy, and merges it in either way — a day
   * whose only entry has not synced yet still has an entry on it.
   */
  const fetchDays = useCallback(async (from: string, to: string): Promise<string[]> => {
    const local = current.current.entries
      .filter((row) => row.occurred_on >= from && row.occurred_on <= to)
      .map((row) => row.occurred_on)

    try {
      const result = await impatient(
        supabase
          .from('entries')
          .select('occurred_on')
          .gte('occurred_on', from)
          .lte('occurred_on', to)
          .is('deleted_at', null),
        PATIENCE,
      )

      if (result === 'timeout' || result.error) return [...new Set(local)]
      const found = (result.data ?? []) as { occurred_on: string }[]
      return [...new Set([...found.map((row) => row.occurred_on), ...local])]
    } catch {
      return [...new Set(local)]
    }
  }, [])

  /**
   * The whole log: the export, the corpus a question is answered from, the
   * memories under a day, and the set reminders are re-armed from.
   *
   * Returns this device's copy when the server cannot be reached, which is what
   * makes all four of those work offline. On success the answer is folded in
   * first, so what comes back includes rows that have not synced yet — a
   * question must not ignore an entry typed a minute ago on a train.
   */
  const fetchAll = useCallback(async (): Promise<Entry[]> => {
    try {
      const result = await impatient(
        supabase
          .from('entries')
          .select(COLUMNS)
          .is('deleted_at', null)
          .order('occurred_on', { ascending: false })
          .order('created_at', { ascending: true }),
        PATIENCE,
      )

      // This one has to answer either way: a question with no answer, and a
      // launch that never re-arms its reminders, are both silent failures.
      if (result === 'timeout' || result.error) return byDayDescending(current.current.entries)

      apply((prev) => reconcile(prev, (result.data ?? []) as Entry[], null))
      return byDayDescending(current.current.entries)
    } catch {
      return byDayDescending(current.current.entries)
    }
  }, [apply])

  const entries = useMemo(
    () => rows.filter((row) => row.occurred_on === day).sort(byClock),
    [rows, day],
  )

  /** Writes the server refused, on days other than this one, so they are not invisible. */
  const failedElsewhere = useMemo(
    () => rows.filter((row) => row.status === 'failed' && row.occurred_on !== day),
    [rows, day],
  )

  /** How far behind the server is, for saying so honestly. */
  const owed = stored.pending.length

  return {
    entries,
    // The whole local log, for the callers that are not about one day. The bell
    // is the reason: read from the launch fetch instead, it could not show a
    // reminder typed since — which is precisely the thing you just asked it
    // about. Costs no query, because this device already holds the log.
    all: rows,
    failedElsewhere,
    loading,
    error,
    reachable,
    owed,
    add,
    update,
    remove,
    restore,
    retry,
    fetchAll,
    fetchDays,
  }
}
