import { runBackup } from '../lib/run.ts'

/**
 * Runs the backup on demand:
 *
 *   /.netlify/functions/backup-run?token=…
 *
 * A scheduled function cannot be invoked over HTTP, so without this the only
 * way to learn that a key is wrong is to wait for midnight and find no
 * snapshot. Guarded by the same token, and it reports the failure rather than
 * swallowing it — the whole point is to see the error now.
 */
export default async (request: Request): Promise<Response> => {
  const secret = process.env['BACKUP_TOKEN']
  if (secret === undefined || secret === '') {
    return new Response('BACKUP_TOKEN is not set', { status: 503 })
  }
  if (new URL(request.url).searchParams.get('token') !== secret) {
    return new Response('Not found', { status: 404 })
  }

  try {
    return Response.json(await runBackup(new Date()))
  } catch (failure) {
    return new Response(failure instanceof Error ? failure.message : String(failure), {
      status: 500,
    })
  }
}
