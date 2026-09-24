import { getStore } from '@netlify/blobs'
import { authorised, isSnapshotKey } from '../lib/backup.ts'

/**
 * Reading the backups back out. A copy that cannot be retrieved is not a
 * backup, it is a habit.
 *
 *   /.netlify/functions/backups?token=…                  list snapshots
 *   /.netlify/functions/backups?token=…&key=entries-….json   download one
 *
 * `Authorization: Bearer …` works in place of the query token, and is what a
 * script should use — a URL carrying the secret ends up in access logs and in
 * browser history. See `authorised`.
 *
 * Guarded by a shared token because this returns every row in the database,
 * bypassing RLS. Without BACKUP_TOKEN set the endpoint refuses to work at all,
 * rather than defaulting to open.
 */
export default async (request: Request): Promise<Response> => {
  const secret = process.env['BACKUP_TOKEN']
  if (secret === undefined || secret === '') {
    return new Response('BACKUP_TOKEN is not set', { status: 503 })
  }

  if (!authorised(request, secret)) {
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(request.url)

  const store = getStore('backups')
  const wanted = url.searchParams.get('key')

  if (wanted === null) {
    const { blobs } = await store.list()
    return Response.json(blobs.map((blob) => blob.key).sort().reverse())
  }

  // Only a name this function could itself have written. Checked before the
  // store is touched, so nothing path-like ever reaches it and nothing
  // caller-supplied ever reaches the header below.
  if (!isSnapshotKey(wanted)) {
    return new Response('Not a snapshot name', { status: 400 })
  }

  const snapshot = await store.get(wanted)
  if (snapshot === null) return new Response('No such snapshot', { status: 404 })

  return new Response(snapshot, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${wanted}"`,
    },
  })
}
