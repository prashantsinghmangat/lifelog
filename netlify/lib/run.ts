import { getStore } from '@netlify/blobs'
import { rowRange, snapshotKey, stale, totalFrom } from './backup.ts'

/**
 * The backup itself, shared by the nightly schedule and the on-demand trigger.
 *
 * The risk it covers is losing the Supabase project: the free tier pauses after
 * seven days idle, has no point-in-time recovery, and a manual export only
 * exists on days someone remembers. The copy therefore goes to Netlify Blobs —
 * a dump written back into Supabase would share the fate of what it backs up.
 *
 * Soft-deleted rows are included. A backup that has already applied your
 * deletions cannot undo them.
 */

const PAGE = 1000
const KEEP = 30
/** A stop, so a server answering oddly cannot spin this loop for ever. */
const MAX_PAGES = 1000

type Row = Record<string, unknown>

export type BackupResult = { snapshot: string; rows: number; pruned: number }

/**
 * Every row in the table, or an error — never a short answer that looks whole.
 *
 * This loop carried both halves of the defect that was found and fixed on the
 * client, and here the consequence is worse: a truncated read is written to the
 * store as a successful snapshot, reported as `{ rows: 500 }`, and the prune
 * then rolls a *good* snapshot off the end. Thirty days of that and every
 * intact copy is gone.
 *
 * - **A short page was treated as the end.** The count was requested, computed,
 *   and then OR-ed away: `batch.length < PAGE` returned regardless of it. The
 *   cap is a server setting (Supabase's "Max rows"), and below 1000 *every*
 *   page is short — so one dashboard toggle, with no code change, silently
 *   reduced every future backup to its first page.
 * - **The offset counted pages, not rows.** `page * PAGE` assumes each page
 *   returned exactly what was asked for. It skips whatever the gap is.
 *
 * So: advance by what actually arrived, stop only when the data runs out or the
 * count says it is all here, and refuse to guess in between.
 */
export async function everyRow(url: string, key: string, get = fetch): Promise<Row[]> {
  const rows: Row[] = []
  /** What the server says matches, which is the only proof of completeness. */
  let total: number | null = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await get(
      // `id` breaks ties. `created_at` alone is not unique and is not indexed,
      // and an unstable sort under OFFSET paging can repeat one row across a
      // page boundary and drop another.
      `${url}/rest/v1/entries?select=*&order=created_at.asc,id.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          // Ask for the total, and then actually use it below.
          Prefer: 'count=exact',
          Range: rowRange(rows.length, PAGE),
        },
      },
    )

    // An unsatisfiable range is PostgREST saying there is nothing past here,
    // which is an answer and not a failure. Asking for one page past the end is
    // exactly what a loop that stops on an empty page does when the row count
    // is an exact multiple of the page size.
    if (response.status === 416) return rows

    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status}: ${await response.text()}`)
    }

    const batch = (await response.json()) as Row[]
    rows.push(...batch)
    total = totalFrom(response.headers.get('content-range')) ?? total

    // Empty means the data ran out. A *short* page means only that the server
    // would not send more in one go.
    if (batch.length === 0) return rows
    if (total !== null && rows.length >= total) return rows
  }

  throw new Error(
    `Gave up after ${MAX_PAGES} pages with ${rows.length} rows and no end in sight. ` +
      'Refusing to store a snapshot that cannot be shown to be complete.',
  )
}

export async function runBackup(now: Date, get = fetch): Promise<BackupResult> {
  // The project URL is not a secret — it ships inside the client bundle — so
  // the client's own variable is an acceptable fallback, and one fewer thing to
  // configure twice. The service-role key gets no such fallback: a VITE_ prefix
  // would inline it into the browser bundle, which is exactly the disaster to
  // avoid.
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  // Loudly, not silently: a backup that quietly does nothing is worse than none.
  if (url === undefined || url === '') {
    throw new Error('Set SUPABASE_URL (or VITE_SUPABASE_URL) in the site environment')
  }
  if (key === undefined || key === '') {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in the site environment, then redeploy')
  }

  const rows = await everyRow(url, key, get)
  const store = getStore('backups')
  const snapshot = snapshotKey(now)

  await store.set(snapshot, JSON.stringify({ takenAt: now.toISOString(), rows }))

  const { blobs } = await store.list()
  const old = stale(
    blobs.map((blob) => blob.key),
    KEEP,
  )
  await Promise.all(old.map((name) => store.delete(name)))

  return { snapshot, rows: rows.length, pruned: old.length }
}
