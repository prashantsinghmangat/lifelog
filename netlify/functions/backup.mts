import type { Config } from '@netlify/functions'
import { healthcheckPing } from '../lib/backup.ts'
import { runBackup } from '../lib/run.ts'

/** The nightly copy. The work itself lives in `run.ts`, shared with the trigger. */
export default async (): Promise<Response> => {
  const result = await runBackup(new Date())
  // After the snapshot write, never before and never on failure: a failed run
  // pings nothing, and that absence is what the dead-man's switch turns into
  // an email. Nightly only — the manual trigger proving a backup *can* run
  // must not reset the timer watching whether the schedule *does*.
  await healthcheckPing(process.env['BACKUP_HEALTHCHECK_URL'])
  return Response.json(result)
}

export const config: Config = {
  // Netlify runs schedules in UTC.
  schedule: '@daily',
}
