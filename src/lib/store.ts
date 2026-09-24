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

const KINDS = new Set(['expense', 'time', 'event', 'note'])
/** A local calendar day, which is the only shape `parseISO` is ever handed. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Present and of the right type, or absent — never something else. */
function optional(value: unknown, type: 'string' | 'number'): boolean {
  return value === null || value === undefined || typeof value === type
}

/**
 * Every field the app dereferences without first asking whether it can.
 *
 * This guard's whole promise is that a corrupt or half-written value costs a
 * fetch rather than the app, so it has to cover what the app actually reads —
 * and checking only `id` and `occurred_on` did not. Each of these is a real way
 * a bad row takes the screen down or corrupts a number, on every launch, with
 * the value still in `localStorage` and no screen left to clear it from:
 *
 * - `title` — React throws outright when asked to render an object as a child.
 * - `kind` — `KIND_NAME[kind]` and the colour maps are total over four values.
 * - `occurred_on` — `parseISO` feeds `format`, which throws on an invalid date.
 * - `occurred_at` — same, by way of `clock` and the occurrence rewriter.
 * - `data` — `done`, `weeklyDays` and `repeatLabel` read into it on every row.
 * - `amount_paise` — `total + row.amount_paise` on a string *concatenates*, so
 *   a day of ₹350 and ₹120 silently totals "0350120" rather than failing.
 */
function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<Entry>

  return (
    typeof row.id === 'string' &&
    row.id !== '' &&
    typeof row.title === 'string' &&
    typeof row.kind === 'string' &&
    KINDS.has(row.kind) &&
    typeof row.occurred_on === 'string' &&
    DAY.test(row.occurred_on) &&
    typeof row.created_at === 'string' &&
    optional(row.occurred_at, 'string') &&
    optional(row.note, 'string') &&
    optional(row.category, 'string') &&
    optional(row.amount_paise, 'number') &&
    optional(row.duration_minutes, 'number') &&
    typeof row.data === 'object' &&
    row.data !== null
  )
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

/**
 * Moves a guest log onto the account that has just signed in.
 *
 * A log kept without an account is keyed by a local id, and signing in would
 * otherwise swap the key and leave every entry on the device, unreachable and
 * looking deleted — which is a worse first impression than the sign-in wall this
 * replaces.
 *
 * **Every adopted row is queued.** The server has never seen one of them, and
 * each is a full-row upsert, so re-queueing the lot is both correct and cheap:
 * the ids are uuids generated here, so nothing can collide with what the account
 * already holds. The guest's *pending* list is deliberately dropped — it records
 * writes owed for rows the server never had, including deletes of entries that
 * never reached it, and replaying those would ask the server to delete rows that
 * do not exist.
 *
 * The old key is removed last: a failure before that point leaves the guest log
 * exactly where it was, which is the safe direction to fail in.
 */
export function adopt(storage: Storage, from: string, to: string, at: string): void {
  const guest = load(storage, from)

  if (guest.entries.length > 0) {
    const moving = new Set(guest.entries.map((row) => row.id))
    const account = load(storage, to)

    save(storage, to, {
      version: VERSION,
      entries: [...account.entries.filter((row) => !moving.has(row.id)), ...guest.entries],
      pending: [
        ...account.pending.filter((row) => !moving.has(row.id)),
        ...guest.entries.map((row) => ({ ...row, deleted_at: null, queued_at: at })),
      ],
    })
  }

  try {
    storage.removeItem(keyFor(from))
  } catch {
    // The log has already been copied; a key left behind costs only space.
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

/** Whether `created` is at or after `since`, across either stamp's offset. */
function loggedSince(created: string, since: string): boolean {
  const at = Date.parse(created)
  const from = Date.parse(since)
  return Number.isFinite(at) && Number.isFinite(from) && at >= from
}

/**
 * Folds a successful read into what this device holds.
 *
 * `day` narrows the read to one day; null means the whole log was fetched and
 * anything absent from it is genuinely gone.
 *
 * **`whole` is what makes that second claim safe to act on.** A full read is
 * authoritative — that is how a delete made on the laptop reaches the phone —
 * and it is only authoritative if it actually returned everything. PostgREST
 * caps a response, so an unpaged read of a long log comes back *short*, and
 * every row past the cap was then deleted from this device: silently, on
 * launch, taking the export built on the same call down with it. A page loop
 * that gives up halfway says `whole: false` and nothing is removed. Either way a pending row wins over
 * the server's copy of it — the server is the one that is out of date, and
 * overwriting a local edit with the version it is about to replace is how an
 * offline change disappears the moment the network returns.
 *
 * **`since` is when the read was sent, and it is what stops a read from
 * deleting something logged after it.** A read is only evidence about the log
 * as it was when the server answered it. An entry typed while a read was in
 * flight, whose own write then landed first, is absent from that reply and not
 * pending any more — so it was dropped from the device, vanishing from the
 * screen while sitting safely on the server until something happened to fetch
 * it again. Arrowing to another day and typing straight away is enough to reach
 * it, and a disappearing entry is the worst thing this app can do.
 */
export function reconcile(
  state: Stored,
  fetched: Entry[],
  day: string | null,
  since?: string,
  whole = true,
): Stored {
  const pendingIds = new Set(state.pending.map((row) => row.id))
  const incoming = fetched.filter((row) => !pendingIds.has(row.id))

  // Deduped by id, not only by day: a row that moved day is returned by a read
  // of where it went while this device still holds it under where it was, and
  // one entry appearing twice is worse than either copy being briefly stale.
  const arriving = new Set(incoming.map((row) => row.id))

  const kept = state.entries.filter(
    (row) =>
      !arriving.has(row.id) &&
      // A read that did not cover its own scope has *seen* rows but cannot
      // vouch for the ones it never reached, so absence stops being evidence.
      (!whole ||
        pendingIds.has(row.id) ||
        (since !== undefined && loggedSince(row.created_at, since)) ||
        (day !== null && row.occurred_on !== day)),
  )

  return { version: VERSION, entries: [...kept, ...incoming], pending: state.pending }
}
