import type { Entry } from '../types'

/**
 * The log as this device holds it, and the writes it still owes the server.
 *
 * The whole point: none of what this app does needs a network. Parsing an entry,
 * raising a reminder, totalling a day and answering a question are all local
 * work, so the only reason logging offline ever failed was that the row was
 * kept in React state and thrown away on reload. This is where it lives instead.
 *
 * Pure over an injected `Storage`, so the reducers are tested exactly rather
 * than driven through a browser.
 *
 * **A pending write is a desired end state, not an operation.** The obvious
 * design — a FIFO queue of insert / update / delete — has to replay in order,
 * and every failure raises the question of what the rest of the queue now
 * means: an `update ... eq(id)` replayed before its insert lands matches no rows
 * and reports no error, which loses an entry silently. Here each dirty row
 * carries its full current state, including `deleted_at`, and syncing is one
 * idempotent upsert per row. Order stops mattering, a row edited five times
 * offline is one write, and a failure affects only that row.
 *
 * The cost is last-write-wins per row across devices. For a single-user log on
 * a phone and a laptop that is the expected behaviour, not a compromise.
 */

/** Bumped only when the shape below changes incompatibly. */
const VERSION = 1

/**
 * A row whose local state has not reached the server yet, carrying the
 * `deleted_at` the server should end up with — which is how a soft delete made
 * offline survives a reload without the deleted row staying visible.
 */
export type Pending = Entry & {
  deleted_at: string | null
  /**
   * When this version of the row was queued. `settle` matches on it, so an edit
   * made while the previous version was mid-flight is not marked as synced by
   * the reply to a write that no longer describes the row.
   */
  queued_at: string
}

export type Stored = {
  version: number
  /** Every entry this device knows about, whatever day it falls on. */
  entries: Entry[]
  /** The rows the server has not caught up with. */
  pending: Pending[]
}

export const EMPTY: Stored = { version: VERSION, entries: [], pending: [] }

/**
 * Keyed by user, so signing in as someone else cannot show their log this
 * device's rows — and so signing back in still finds the writes that never
 * got a chance to sync.
 */
export function keyFor(userId: string): string {
  return `lifelog.log.${userId}`
}

/** The wire shape of a row. `deleted_at` included: a delete is an upsert too. */
export function payloadOf(row: Pending): Record<string, unknown> {
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
    // Sent rather than left to the column default, or a row created offline on
    // Tuesday and synced on Friday claims Friday — and `created_at` is the
    // tiebreak that orders untimed entries within their day.
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  }
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<Entry>
  return typeof row.id === 'string' && typeof row.occurred_on === 'string'
}

/**
 * Normalised rather than rejected: a pending row that came back without a stamp
 * would never match in `settle`, and would be re-sent for ever.
 */
function asPending(value: unknown): Pending | null {
  if (!isEntry(value)) return null
  const row = value as Entry & Partial<Pending>
  return {
    ...row,
    deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
    queued_at: typeof row.queued_at === 'string' ? row.queued_at : '',
  }
}

/**
 * Never throws and never returns a half-read state.
 *
 * A corrupt or half-written value must not stop the app from starting: an empty
 * cache costs a fetch, while a throw at boot costs the whole app. Rows are
 * shape-checked one by one because a single bad row is not a reason to discard
 * the rest.
 */
export function load(storage: Storage, userId: string): Stored {
  try {
    const raw = storage.getItem(keyFor(userId))
    if (raw === null) return EMPTY

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY

    const held = parsed as Partial<Stored>
    if (held.version !== VERSION) return EMPTY

    return {
      version: VERSION,
      entries: Array.isArray(held.entries) ? held.entries.filter(isEntry) : [],
      pending: Array.isArray(held.pending)
        ? held.pending.map(asPending).filter((row): row is Pending => row !== null)
        : [],
    }
  } catch {
    return EMPTY
  }
}

/**
 * Best effort, and deliberately silent.
 *
 * Capture is the product, so a storage failure — private browsing, a full quota
 * — must never be what stops an entry from being logged. When the whole state
 * will not fit, the pending writes are saved alone: the cache can be fetched
 * again, and the writes cannot be recovered from anywhere.
 */
export function save(storage: Storage, userId: string, state: Stored): void {
  try {
    storage.setItem(keyFor(userId), JSON.stringify(state))
  } catch {
    try {
      storage.setItem(
        keyFor(userId),
        JSON.stringify({ version: VERSION, entries: [], pending: state.pending }),
      )
    } catch {
      // Nothing can be persisted here. The rows are still in memory and still
      // on screen, and the reminder was scheduled by the OS regardless.
    }
  }
}

function replace<T extends { id: string }>(rows: T[], row: T): T[] {
  const at = rows.findIndex((current) => current.id === row.id)
  if (at === -1) return [...rows, row]
  return rows.map((current) => (current.id === row.id ? row : current))
}

/** A row added or edited here. Also how a restore works — a delete undone. */
export function upsertLocal(state: Stored, row: Entry, at: string): Stored {
  return {
    version: VERSION,
    entries: replace(state.entries, row),
    pending: replace(state.pending, { ...row, deleted_at: null, queued_at: at }),
  }
}

/** Soft delete: gone from this device at once, still owed to the server. */
export function removeLocal(state: Stored, row: Entry, at: string): Stored {
  return {
    version: VERSION,
    entries: state.entries.filter((current) => current.id !== row.id),
    pending: replace(state.pending, { ...row, deleted_at: at, queued_at: at }),
  }
}

/**
 * The server has this row now — unless it was edited again while the write was
 * in flight, in which case the newer version is still owed and stays queued.
 */
export function settle(state: Stored, id: string, queuedAt: string): Stored {
  return {
    version: VERSION,
    entries: state.entries,
    pending: state.pending.filter((row) => !(row.id === id && row.queued_at === queuedAt)),
  }
}

/**
 * Folds a successful read into what this device holds.
 *
 * `day` narrows the read to one day; null means the whole log was fetched and
 * anything absent from it is genuinely gone. Either way a pending row wins over
 * the server's copy of it — the server is the one that is out of date, and
 * overwriting a local edit with the version it is about to replace is how an
 * offline change disappears the moment the network returns.
 */
export function reconcile(state: Stored, fetched: Entry[], day: string | null): Stored {
  const pendingIds = new Set(state.pending.map((row) => row.id))
  const incoming = fetched.filter((row) => !pendingIds.has(row.id))

  // Deduped by id, not only by day: a row that moved day is returned by a read
  // of where it went while this device still holds it under where it was, and
  // one entry appearing twice is worse than either copy being briefly stale.
  const arriving = new Set(incoming.map((row) => row.id))

  const kept = state.entries.filter(
    (row) =>
      !arriving.has(row.id) &&
      (pendingIds.has(row.id) || (day !== null && row.occurred_on !== day)),
  )

  return { version: VERSION, entries: [...kept, ...incoming], pending: state.pending }
}
