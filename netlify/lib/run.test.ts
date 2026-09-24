import { describe, expect, it } from 'vitest'
import { everyRow } from './run.ts'

/**
 * The loop that can lose the only off-site copy of the log, which until now had
 * no test at all.
 *
 * What is pinned here is completeness. A backup that silently holds the first
 * page is worse than one that fails, because it is written to the store as a
 * success, reported with a plausible row count, and the prune then rolls a good
 * snapshot off the end — thirty days of that and every intact copy is gone.
 */

const URL_BASE = 'https://project.supabase.co'
const KEY = 'service-role-key'

/**
 * A PostgREST that caps every response at `cap` rows, whatever was asked for.
 * `cap` is a server setting, and below the page size *every* page comes back
 * short — which is the case that used to end the loop after one request.
 */
function server(total: number, cap = 1000) {
  const asked: string[] = []

  const get = async (_url: string, init?: { headers?: Record<string, string> }) => {
    const range = init?.headers?.['Range'] ?? '0-999'
    asked.push(range)
    const [rawFrom, rawTo] = range.split('-')
    const from = Number(rawFrom)
    const to = Number(rawTo)

    if (from >= total && total > 0) {
      return { ok: false, status: 416, json: async () => [], headers: { get: () => null } }
    }

    const rows: { id: string; title: string }[] = []
    for (let at = from; at <= Math.min(to, total - 1) && rows.length < cap; at += 1) {
      rows.push({ id: `row-${at}`, title: `entry ${at}` })
    }

    return {
      ok: true,
      status: 200,
      json: async () => rows,
      headers: { get: () => `${from}-${from + rows.length - 1}/${total}` },
    }
  }

  return { get: get as unknown as typeof fetch, asked }
}

describe('reading every row for the backup', () => {
  it('returns the whole table when the cap and the page size agree', async () => {
    const { get, asked } = server(2431)
    const rows = await everyRow(URL_BASE, KEY, get)

    expect(rows).toHaveLength(2431)
    expect(asked).toEqual(['0-999', '1000-1999', '2000-2999'])
  })

  it('returns the whole table when the server caps below the page size', async () => {
    // The bug: every page is short, and a short page was taken for the end —
    // so the snapshot held 500 of 2431 rows and said so as though that were
    // the whole log. The cap is a dashboard setting; no code has to change for
    // this to start happening.
    const { get } = server(2431, 500)
    const rows = await everyRow(URL_BASE, KEY, get)

    expect(rows).toHaveLength(2431)
  })

  it('leaves no hole in the middle when pages come back short', async () => {
    // The second half of the same bug: offsetting by page index rather than by
    // rows received skipped whatever the cap withheld, and the row count gave
    // no sign of it.
    const { get } = server(1200, 400)
    const rows = await everyRow(URL_BASE, KEY, get)

    expect(rows.map((row) => (row as { id: string }).id)).toEqual(
      Array.from({ length: 1200 }, (_, at) => `row-${at}`),
    )
  })

  it('asks for the next rows it does not have, not for the next page', async () => {
    const { get, asked } = server(1200, 400)
    await everyRow(URL_BASE, KEY, get)

    expect(asked.slice(0, 3)).toEqual(['0-999', '400-1399', '800-1799'])
  })

  it('stops cleanly when the row count is an exact multiple of the page', async () => {
    // Asking one page past the end is what a loop that stops on an empty page
    // does. PostgREST answers 416, which is an answer and not a failure.
    const { get } = server(2000)
    await expect(everyRow(URL_BASE, KEY, get)).resolves.toHaveLength(2000)
  })

  it('handles an empty table', async () => {
    const { get } = server(0)
    await expect(everyRow(URL_BASE, KEY, get)).resolves.toEqual([])
  })

  it('throws rather than returning a partial read the server refused', async () => {
    const get = (async () => ({
      ok: false,
      status: 500,
      text: async () => 'upstream exploded',
      json: async () => [],
      headers: { get: () => null },
    })) as unknown as typeof fetch

    await expect(everyRow(URL_BASE, KEY, get)).rejects.toThrow(/500/)
  })

  it('refuses to finish quietly when the end never arrives', async () => {
    // A server that ignores Range and never reports a total would otherwise
    // accumulate for ever. Failing is right: a snapshot that cannot be shown to
    // be complete must not be stored as though it were.
    const get = (async () => ({
      ok: true,
      status: 200,
      json: async () => Array.from({ length: 1000 }, (_, at) => ({ id: `x-${at}` })),
      headers: { get: () => null },
    })) as unknown as typeof fetch

    await expect(everyRow(URL_BASE, KEY, get)).rejects.toThrow(/cannot be shown to be complete/)
  })
})
