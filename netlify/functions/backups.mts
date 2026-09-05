import { getStore } from '@netlify/blobs'

/**
 * Reading the backups back out. A copy that cannot be retrieved is not a
 * backup, it is a habit.
 *
 *   /.netlify/functions/backups?token=…                  list snapshots
 *   /.netlify/functions/backups?token=…&key=entries-….json   download one
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

  const url = new URL(request.url)
  if (url.searchParams.get('token') !== secret) {
    return new Response('Not found', { status: 404 })
  }

  const store = getStore('backups')
  const wanted = url.searchParams.get('key')

  if (wanted === null) {
    const { blobs } = await store.list()
    return Response.json(blobs.map((blob) => blob.key).sort().reverse())
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
