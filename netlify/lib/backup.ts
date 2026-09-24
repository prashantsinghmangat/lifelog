/**
 * Pure helpers for the nightly backup, kept apart from the function so they can
 * be tested without a Netlify runtime.
 */

const PREFIX = 'entries-'
const SUFFIX = '.json'

/**
 * One snapshot per day, named so that lexicographic order is chronological
 * order — which is what makes pruning a sort rather than a date parse.
 */
export function snapshotKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${PREFIX}${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}${SUFFIX}`
}

/**
 * Whether a caller-supplied key names a snapshot this function could have
 * written.
 *
 * The key arrives in a query string and goes two places: a blob lookup, and a
 * `filename="…"` in a Content-Disposition header. Matching the exact shape
 * `snapshotKey` produces is cheaper than escaping either one and leaves nothing
 * to reason about — no traversal, no separators, no quotes, no surprises about
 * what a blob store does with a path-like name.
 *
 * Deliberately not a date *validity* check: `entries-2026-02-31.json` is a name
 * nothing ever wrote, so it simply will not be found.
 */
export function isSnapshotKey(key: string): boolean {
  return new RegExp(`^${PREFIX}\\d{4}-\\d{2}-\\d{2}\\${SUFFIX}$`).test(key)
}

/** Snapshots to delete: everything older than the newest `keep`. */
export function stale(keys: string[], keep: number): string[] {
  const snapshots = keys.filter((key) => key.startsWith(PREFIX) && key.endsWith(SUFFIX)).sort()
  // Guard the whole list rather than trusting a caller's zero or negative.
  if (keep <= 0) return snapshots
  return snapshots.slice(0, Math.max(0, snapshots.length - keep))
}

/**
 * The `Range` header for the next `size` rows starting at `from`.
 *
 * Counted in **rows already held**, never in pages already asked for. Those are
 * the same number only while every page returns exactly what it was asked for,
 * and the whole reason this exists is that PostgREST caps a response — so a
 * page-index offset skips whatever the cap held back, leaving a hole in the
 * middle of the backup that the row count does nothing to reveal.
 */
export function rowRange(from: number, size: number): string {
  return `${from}-${from + size - 1}`
}

/** `0-999/2431` → 2431. Null when the server does not say. */
export function totalFrom(contentRange: string | null): number | null {
  if (contentRange === null) return null
  const total = contentRange.split('/')[1]
  if (total === undefined || total === '*') return null
  const parsed = Number(total)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Whether a request carries the shared secret.
 *
 * One implementation, because this exact check was written twice and guards two
 * endpoints that return every row in the database past RLS — the kind of thing
 * that only has to be got wrong in one of its copies.
 *
 * The header is offered as well as the query string, and is the one to prefer:
 * a URL carrying a bearer credential is written into access logs and browser
 * history, and is handed on by anything that shares the link. The query form
 * stays because it is what a browser address bar can do, which is the whole
 * reason these endpoints are reachable by hand at all.
 *
 * Compared in constant time. The token is long and random and the timing margin
 * over HTTPS is not a realistic attack, but a credential comparison that leaks
 * its prefix is not worth keeping for the sake of one operator.
 */
export function authorised(request: Request, secret: string): boolean {
  const url = new URL(request.url)
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : null

  const offered = bearer ?? url.searchParams.get('token')
  return offered !== null && sameSecret(offered, secret)
}

/** Length-independent, so a wrong length cannot be told apart by timing either. */
function sameSecret(offered: string, secret: string): boolean {
  let differs = offered.length ^ secret.length
  for (let at = 0; at < offered.length; at += 1) {
    differs |= offered.charCodeAt(at) ^ secret.charCodeAt(at % secret.length)
  }
  return differs === 0
}
