import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { pageRange, snapshotKey, stale, totalFrom } from '../lib/backup.ts'

/**
 * A nightly copy of every row, kept somewhere that is not Supabase.
 *
 * The risk this covers is losing the project itself: the free tier pauses after
 * seven days idle, has no point-in-time recovery, and a manual JSON export only
 * exists on days someone remembers. A dump written back into Supabase would
 * share the fate of the thing it is backing up, so it goes to Netlify Blobs.
 *
 * Soft-deleted rows are included. A backup that has already applied your
 * deletions cannot undo them.
 */

const PAGE = 1000
const KEEP = 30

type Row = Record<string, unknown>

async function everyRow(url: string, key: string): Promise<Row[]> {
  const rows: Row[] = []

  for (let page = 0; ; page += 1) {
    const response = await fetch(`${url}/rest/v1/entries?select=*&order=created_at.asc`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        // Ask for the total so a short page can be told from a finished one.
        Prefer: 'count=exact',
        Range: pageRange(page, PAGE),
      },
    })

    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status}: ${await response.text()}`)
    }

    const batch = (await response.json()) as Row[]
    rows.push(...batch)

    const total = totalFrom(response.headers.get('content-range'))
    if (batch.length < PAGE || (total !== null && rows.length >= total)) return rows
  }
}

export default async (): Promise<Response> => {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (url === undefined || key === undefined) {
    // Loudly, not silently: a backup that quietly does nothing is worse than none.
    return new Response('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set', { status: 500 })
  }

  const rows = await everyRow(url, key)
  const store = getStore('backups')
  const key_ = snapshotKey(new Date())

  await store.set(key_, JSON.stringify({ takenAt: new Date().toISOString(), rows }))

  const { blobs } = await store.list()
  const old = stale(
    blobs.map((blob) => blob.key),
    KEEP,
  )
  await Promise.all(old.map((name) => store.delete(name)))

  return Response.json({ snapshot: key_, rows: rows.length, pruned: old.length })
}

export const config: Config = {
  // Nightly. Netlify runs schedules in UTC.
  schedule: '@daily',
}
