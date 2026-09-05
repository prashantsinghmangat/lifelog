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

/** Snapshots to delete: everything older than the newest `keep`. */
export function stale(keys: string[], keep: number): string[] {
  const snapshots = keys.filter((key) => key.startsWith(PREFIX) && key.endsWith(SUFFIX)).sort()
  // Guard the whole list rather than trusting a caller's zero or negative.
  if (keep <= 0) return snapshots
  return snapshots.slice(0, Math.max(0, snapshots.length - keep))
}

/**
 * PostgREST caps a response at 1000 rows, so a backup that ignores paging
 * silently truncates the moment the log outgrows it — the worst possible
 * failure for a backup, because it still looks like it worked.
 */
export function pageRange(page: number, size: number): string {
  const from = page * size
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
