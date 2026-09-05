import type { Config } from '@netlify/functions'
import { runBackup } from '../lib/run.ts'

/** The nightly copy. The work itself lives in `run.ts`, shared with the trigger. */
export default async (): Promise<Response> => {
  const result = await runBackup(new Date())
  return Response.json(result)
}

export const config: Config = {
  // Netlify runs schedules in UTC.
  schedule: '@daily',
}
