import { getStore } from '@netlify/blobs'
import { authorised, isSnapshotKey, usableSecret } from '../lib/backup.ts'
import { parseSnapshot, rpcRequest } from '../lib/restore.ts'

/**
 * Reading a snapshot back into the table. The counterpart of `backups.mts`,
 * and the proof that the nightly copies are backups rather than a habit:
 *
 *   /.netlify/functions/backup-restore?token=…&key=entries-….json
 *
 * Reads Blobs, never writes it — after an incident the snapshots are the only
 * good copies, and `backup-run` is the thing that can overwrite today's.
 * All-or-nothing by construction: the RPC is one PostgREST transaction, so a
 * failure partway rolls the whole restore back and the error below is the
 * entire outcome. Guarded by the same token as the other two endpoints; the
 * service-role key never leaves the function.
 */
export default async (request: Request): Promise<Response> => {
  const secret = process.env['BACKUP_TOKEN']
  if (!usableSecret(secret)) {
    return new Response('BACKUP_TOKEN is not set, or shorter than 32 characters', { status: 503 })
  }
  if (!authorised(request, secret)) {
    return new Response('Not found', { status: 404 })
  }

  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (url === undefined || url === '') {
    return new Response('Set SUPABASE_URL (or VITE_SUPABASE_URL) in the site environment', { status: 503 })
  }
  if (serviceKey === undefined || serviceKey === '') {
    return new Response('Set SUPABASE_SERVICE_ROLE_KEY in the site environment', { status: 503 })
  }

  const wanted = new URL(request.url).searchParams.get('key')
  if (wanted === null) {
    return new Response('Name the snapshot to restore: ?key=entries-YYYY-MM-DD.json', { status: 400 })
  }
  if (!isSnapshotKey(wanted)) {
    return new Response('Not a snapshot name', { status: 400 })
  }

  const snapshot = await getStore('backups').get(wanted, { type: 'text' })
  if (snapshot === null) return new Response(`No such snapshot: ${wanted}`, { status: 404 })

  const parsed = parseSnapshot(snapshot)
  if ('error' in parsed) {
    return new Response(`Snapshot ${wanted} is unreadable: ${parsed.error}`, { status: 404 })
  }

  const rpc = rpcRequest(url, serviceKey, parsed.rows)
  const response = await fetch(rpc.url, rpc.init)
  if (!response.ok) {
    return new Response(
      `restore_entries failed, nothing restored (${response.status}): ${await response.text()}`,
      { status: 502 },
    )
  }

  const restored = (await response.json()) as number
  return Response.json({ snapshot: wanted, restored })
}
