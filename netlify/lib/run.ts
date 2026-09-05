import { getStore } from '@netlify/blobs'
import { pageRange, snapshotKey, stale, totalFrom } from './backup.ts'

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

type Row = Record<string, unknown>

export type BackupResult = { snapshot: string; rows: number; pruned: number }

async function everyRow(url: string, key: string): Promise<Row[]> {
  const rows: Row[] = []

  for (let page = 0; ; page += 1) {
    const response = await fetch(`${url}/rest/v1/entries?select=*&order=created_at.asc`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        // Ask for the total, so a short page can be told from a finished one.
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

export async function runBackup(now: Date): Promise<BackupResult> {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']

  // Loudly, not silently: a backup that quietly does nothing is worse than none.
  if (url === undefined || url === '') throw new Error('SUPABASE_URL is not set')
  if (key === undefined || key === '') throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  const rows = await everyRow(url, key)
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
