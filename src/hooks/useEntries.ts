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
 *
 * **And a refusal is not always worth repeating.** `refused` is a server that
 * said no this time — a token about to refresh, a rate limit, a bad minute —
 * and waiting is exactly the right response. `rejected` is a server that will
 * say no to this row for ever, because the objection is to the row rather than
 * to the moment. Retrying that every thirty seconds for the life of the app
 * achieves nothing and costs a request each time. Both are shown as `failed`
 * with a Retry chip: the row is still visible, still editable, and an explicit
 * Retry still sends it. Only the *automatic* retry knows the difference.
 */
type Attempt = 'saving' | 'unreachable' | 'refused' | 'rejected'

/** The server answered with a refusal, of either kind. */
function answered(attempt: Attempt | undefined): boolean {
  return attempt === 'refused' || attempt === 'rejected'
}

/**
 * Whether a refusal is one that waiting cannot fix.
 *
 * 401 and 403 come back once a token refreshes or the user signs in again; 408
 * and 429 say "try again" outright; 5xx is the server having a bad minute. The
 * rest of the 4xx range is about the row itself — a value out of range, a
 * constraint, a request the server cannot parse — and will be refused
 * identically for ever, however long the app keeps asking.
 */
function permanent(status: number | undefined): boolean {
  if (status === undefined) return false
  if (status === 401 || status === 403 || status === 408 || status === 429) return false
  return status >= 400 && status < 500
}

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

/**
 * Drops the display-only flags, so neither is ever written to storage or the wire.
 *
 * `occurrence` marks a row that was *derived* for a day a repeat merely lands
 * on — reading may be derived, writing may not. `App`'s `asStored` resolves one
 * back to its stored row before any write sees it, and that is still where the
 * rule is enforced. This is the boundary saying so too: a caller that ever
 * forgets would otherwise persist the marker, and `isOccurrence` would start
 * answering true for a row that is not one.
 */
function bare({ status: _status, occurrence: _occurrence, ...entry }: Row & { occurrence?: true }): Entry {
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
 * How many rows one read asks for.
 *
 * PostgREST caps a response, so a read without a range comes back short rather
 * than complete — and a short read is indistinguishable from a log that has
 * lost rows. The same size the nightly backup reads at, so the two agree about
 * what a page is.
 */
const PAGE = 1000

/** A stop, so a server answering oddly cannot spin this loop for ever. */
const MAX_PAGES = 200

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

/**
 * @param local A log with no account behind it, which nothing may try to sync.
 *   Every request would be refused — there is no session and RLS answers to
 *   nobody — so attempting them would put a Retry chip on every row and an
 *   offline notice over a log that is working perfectly. The guest path is not a
 *   degraded one: locally this is the same app, because locally it always was.
 */
/** This device's log for one user, or an empty one where there is no storage. */
function read(userId: string): Stored {
  return typeof localStorage === 'undefined' ? EMPTY : load(localStorage, userId)
}

export function useEntries(day: string, userId: string, local = false) {
  const online = useOnline()
  const [stored, setStored] = useState<Stored>(() => read(userId))
  // Last outcome of a sync attempt, per row. Absent means never attempted,
  // which is what a write made with no network looks like.
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({})
  /** Whose log `stored` currently holds. */
  const [owner, setOwner] = useState(userId)
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

  /**
   * The user changed, so this device's log is a different log.
   *
   * The initial state is read once, which was fine while the id could not change
   * under a mounted hook — and then a guest could sign in. `adopt` rewrites the
   * account's key before this hook ever sees the new id, so keeping the previous
   * user's state here meant the persist effect below wrote it straight back over
   * the adopted log, taking the account's own unsynced writes with it. Silent,
   * and only visible on the next launch.
   *
   * Adjusted during render rather than in an effect: `write` reads the ref in
   * the same tick, so a log that is still the previous user's for one commit is
   * a log an entry can be added to and lost from.
   */
  if (owner !== userId) {
    const fresh = read(userId)
    current.current = fresh
    setOwner(userId)
    setStored(fresh)
    // Per-row sync outcomes belong to rows this log no longer contains.
    setAttempts({})
    setError(null)
  }

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
    // Nobody to sync with. Not a failure and not offline — there is no account,
    // and the rows are exactly where they are meant to be.
    if (local) return
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
              // An answer, even a refusal, means the server was reached. Which
              // kind of refusal decides whether asking again can ever help.
              setReachable(true)
              outcome = permanent(result.status) ? 'rejected' : 'refused'
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
  }, [apply, local])

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
  /**
   * Whether anything owed could still land by being sent again.
   *
   * A row the server has *rejected* is excluded: it is owed, it is visible, it
   * keeps its Retry chip and an edit re-sends it at once — but asking again on
   * a timer cannot change an answer that is about the row rather than about the
   * moment, so a single bad row otherwise made a request every thirty seconds
   * for as long as the app was open.
   */
  const owing = useMemo(
    () => !local && stored.pending.some((row) => attempts[row.id] !== 'rejected'),
    [local, stored.pending, attempts],
  )

  useEffect(() => {
    if (!owing) return
    const ticking = window.setInterval(() => void flush(), 30_000)
    return () => window.clearInterval(ticking)
  }, [owing, flush])

  useEffect(() => {
    let live = true

    // Nothing to read from. The day is already on the device, so going through
    // the loading state would flash placeholders over rows that are right there.
    if (local) {
      setLoading(false)
      return
    }

    setLoading(true)

    // Wrapped rather than chained: a read that rejects instead of resolving with
    // an error must not become an unhandled rejection, and offline is the common
    // case for exactly that.
    const read = async (): Promise<void> => {
      // Stamped before the request, not after: the reply describes the log as
      // it was at this moment, so anything logged later is not missing from it
      // — it is newer than it. See `reconcile`.
      const since = new Date().toISOString()
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
          apply((prev) => reconcile(prev, (data ?? []) as Entry[], day, since))
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
  }, [day, apply, local])

  const rows = useMemo((): Row[] => {
    // No account, so no row is owed to anybody and none carries a write state.
    // `pending` still accumulates, because signing in later hands exactly that
    // set to `adopt` — it simply says nothing on screen until there is a server
    // for it to be behind.
    if (local) return stored.entries

    const owed = new Set(stored.pending.map((row) => row.id))

    const held: Row[] = stored.entries.map((row) => {
      if (!owed.has(row.id)) return row
      const attempt = attempts[row.id]
      // A write that could not reach the server is queued, not failed. Only a
      // server that answered and refused is a failure worth a Retry — and note
      // this asks what happened to the request, never `navigator.onLine`.
      if (attempt === 'saving') return { ...row, status: 'saving' }
      if (answered(attempt)) return { ...row, status: 'failed' }
      return { ...row, status: 'queued' }
    })

    // A delete the server answered and *refused* has to come back: claiming the
    // row is gone when it is not is a lie the next full read undoes anyway. A
    // delete that could not be sent stays gone, because it is going to land —
    // that is the whole point of holding it.
    const refused: Row[] = stored.pending
      .filter((row) => row.deleted_at !== null && answered(attempts[row.id]))
      .map(({ deleted_at: _deleted, queued_at: _queued, ...entry }) => ({
        ...entry,
        status: 'failed' as const,
      }))

    return [...held, ...refused]
  }, [stored, attempts, local])

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
    const held = current.current.entries
      .filter((row) => row.occurred_on >= from && row.occurred_on <= to)
      .map((row) => row.occurred_on)

    if (local) return [...new Set(held)]

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

      if (result === 'timeout' || result.error) return [...new Set(held)]
      const found = (result.data ?? []) as { occurred_on: string }[]
      return [...new Set([...found.map((row) => row.occurred_on), ...held])]
    } catch {
      return [...new Set(held)]
    }
  }, [local])

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
    // This device *is* the whole log. Same answer, one step shorter.
    if (local) return byDayDescending(current.current.entries)

    const since = new Date().toISOString()
    const fetched: Entry[] = []

    try {
      // Paged, because an unpaged read is a *short* read once the log outgrows
      // PostgREST's cap — and `reconcile` treats a full read as the truth, so
      // every row past the cap was deleted from this device on launch. Silent,
      // unattended, and it took the export built on this call down with it.
      // `netlify/lib/run.ts` pages too — though it carried both halves of this
      // same defect until the release audit, so it was a precedent in shape
      // rather than in correctness.
      /** Rows the server says match, whatever one response was willing to carry. */
      let total: number | null = null

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await impatient(
          supabase
            // `count: 'exact'` is what makes "the whole log" a checkable claim
            // rather than a guess. A short page is *not* proof of the end: the
            // cap is a server setting and can be below `PAGE`, in which case
            // every page is short and stopping on one would truncate exactly
            // the way the unpaged read did.
            .from('entries')
            .select(COLUMNS, { count: 'exact' })
            .is('deleted_at', null)
            .order('occurred_on', { ascending: false })
            .order('created_at', { ascending: true })
            .range(fetched.length, fetched.length + PAGE - 1),
          PATIENCE,
        )

        // This one has to answer either way: a question with no answer, and a
        // launch that never re-arms its reminders, are both silent failures.
        // A page that fails mid-loop keeps what it already has and says so, so
        // the rows it never reached are folded rather than removed.
        if (result === 'timeout' || result.error) break

        const batch = (result.data ?? []) as Entry[]
        if (typeof result.count === 'number') total = result.count
        fetched.push(...batch)

        // An empty page is the end of the data; a short one only means the
        // server would not send more in one go.
        if (batch.length === 0) break
        if (total !== null && fetched.length >= total) break
      }

      // Authoritative only when the count says everything arrived. Short of
      // that the read is news about the rows it carried and silent about the
      // rest, so `reconcile` removes nothing.
      const whole = total !== null && fetched.length >= total
      if (whole || fetched.length > 0) {
        apply((prev) => reconcile(prev, fetched, null, since, whole))
      }
      return byDayDescending(current.current.entries)
    } catch {
      return byDayDescending(current.current.entries)
    }
  }, [apply, local])

  const entries = useMemo(
    () => rows.filter((row) => row.occurred_on === day).sort(byClock),
    [rows, day],
  )

  /** Writes the server refused, on days other than this one, so they are not invisible. */
  const failedElsewhere = useMemo(
    () => rows.filter((row) => row.status === 'failed' && row.occurred_on !== day),
    [rows, day],
  )

  /** How far behind the server is, for saying so honestly — and zero with no server. */
  const owed = local ? 0 : stored.pending.length

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
