import { describe, expect, it } from 'vitest'
import { parseSnapshot, rpcRequest } from './restore.ts'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd8f9e44f-fd15-480b-8f7b-5815d44e6b15',
  user_id: '0f0e2b5c-8c3a-4a51-9f2e-9a1b7c6d5e4f',
  kind: 'note',
  occurred_on: '2026-10-02',
  title: 'something',
  created_at: '2026-10-02T10:00:00+05:30',
  updated_at: '2026-10-02T10:00:00+05:30',
  ...over,
})

describe('parsing a snapshot body', () => {
  it('accepts what the backup writes', () => {
    const body = JSON.stringify({ takenAt: '2026-10-02T00:00:00Z', rows: [row(), row({ deleted_at: '2026-10-01T00:00:00Z' })] })
    const parsed = parseSnapshot(body)
    expect('rows' in parsed && parsed.rows).toHaveLength(2)
  })

  it('refuses a body that is not JSON, in one sentence', () => {
    expect(parseSnapshot('<!doctype html>')).toEqual({ error: 'snapshot is not JSON' })
  })

  it('refuses JSON with no rows array', () => {
    expect(parseSnapshot('{"rows": "plenty"}')).toEqual({ error: 'snapshot has no rows array' })
    expect(parseSnapshot('[]')).toEqual({ error: 'snapshot has no rows array' })
  })

  it('refuses an empty snapshot rather than restoring nothing', () => {
    const parsed = parseSnapshot('{"rows": []}')
    expect('error' in parsed && parsed.error).toContain('zero rows')
  })

  it('names the row and column a damaged snapshot is missing, before any network call', () => {
    const body = JSON.stringify({ rows: [row(), row({ updated_at: undefined })] })
    expect(parseSnapshot(body)).toEqual({ error: 'row 1 is missing updated_at' })
  })
})

describe('the restore RPC request', () => {
  it('posts the rows as the payload argument with the service key in both headers', () => {
    const rpc = rpcRequest('https://db.example', 'service-key', [row()])
    expect(rpc.url).toBe('https://db.example/rest/v1/rpc/restore_entries')
    expect(rpc.init.method).toBe('POST')
    const headers = rpc.init.headers as Record<string, string>
    expect(headers['apikey']).toBe('service-key')
    expect(headers['Authorization']).toBe('Bearer service-key')
    expect(JSON.parse(String(rpc.init.body))).toEqual({ payload: [row()] })
  })
})
