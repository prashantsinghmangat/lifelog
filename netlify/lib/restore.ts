/**
 * Pure helpers for the restore endpoint, kept apart from the function the same
 * way `backup.ts` is: everything that can be wrong with a snapshot is decided
 * here, testable without a Netlify runtime, before anything touches the
 * network.
 */

type Row = Record<string, unknown>

/** The columns `entries` cannot hold null in — a snapshot row missing one was never written by the backup. */
const REQUIRED = ['id', 'user_id', 'kind', 'occurred_on', 'title', 'created_at', 'updated_at'] as const

export type Parsed = { rows: Row[] } | { error: string }

/**
 * A snapshot's body, validated into rows — or one plain sentence about why
 * not. Every refusal happens before any network call, so a damaged snapshot
 * can never reach `restore_entries` partway parseable: the RPC receives the
 * whole array or nothing.
 */
export function parseSnapshot(body: string): Parsed {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { error: 'snapshot is not JSON' }
  }

  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { rows?: unknown }).rows)) {
    return { error: 'snapshot has no rows array' }
  }

  const rows = (parsed as { rows: unknown[] }).rows
  if (rows.length === 0) return { error: 'snapshot holds zero rows — refusing a restore that restores nothing' }

  for (let at = 0; at < rows.length; at += 1) {
    const row = rows[at]
    if (typeof row !== 'object' || row === null) return { error: `row ${at} is not an object` }
    for (const column of REQUIRED) {
      const value = (row as Row)[column]
      if (typeof value !== 'string' || value === '') {
        return { error: `row ${at} is missing ${column}` }
      }
    }
  }

  return { rows: rows as Row[] }
}

/** The one RPC call, built but not sent — the function supplies the fetch. */
export function rpcRequest(url: string, serviceKey: string, rows: Row[]): { url: string; init: RequestInit } {
  return {
    url: `${url}/rest/v1/rpc/restore_entries`,
    init: {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ payload: rows }),
    },
  }
}
