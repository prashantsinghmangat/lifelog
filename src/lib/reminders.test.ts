import { describe, expect, it } from 'vitest'
import { fireAt, notificationId } from './reminders'
import type { Entry } from '../types'

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'event',
    occurred_on: '2026-09-02',
    occurred_at: null,
    title: 'ping',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
    ...over,
  }
}

describe('notificationId', () => {
  it('is stable for the same uuid, or a reminder could never be cancelled', () => {
    const uuid = 'd8f9e44f-fd15-480b-8f7b-5815d44e6b15'
    expect(notificationId(uuid)).toBe(notificationId(uuid))
  })

  it('differs between uuids', () => {
    expect(notificationId('a1b2c3d4-0000-0000-0000-000000000001')).not.toBe(
      notificationId('a1b2c3d4-0000-0000-0000-000000000002'),
    )
  })

  it('stays a positive 32-bit integer, which is what the plugin accepts', () => {
    for (const uuid of [
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '00000000-0000-0000-0000-000000000000',
      'd8f9e44f-fd15-480b-8f7b-5815d44e6b15',
      '85e0055d-4ee2-487f-9920-f45ed0ee6e5e',
    ]) {
      const id = notificationId(uuid)
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThan(0)
      expect(id).toBeLessThan(2_147_483_648)
    }
  })
})

describe('fireAt', () => {
  it('uses the clock time when there is one', () => {
    const at = fireAt(entry({ id: 'a', occurred_at: '2026-09-02T17:00:00+05:30' }))
    expect(at?.getHours()).toBe(17)
    expect(at?.getMinutes()).toBe(0)
  })

  it('falls back to 9am local for an all-day event', () => {
    const at = fireAt(entry({ id: 'a', occurred_on: '2026-11-14' }))
    expect(at?.getFullYear()).toBe(2026)
    expect(at?.getMonth()).toBe(10)
    expect(at?.getDate()).toBe(14)
    expect(at?.getHours()).toBe(9)
  })

  it('ignores anything that is not an event', () => {
    for (const kind of ['expense', 'time', 'note'] as const) {
      expect(fireAt(entry({ id: 'a', kind, occurred_at: '2026-09-02T17:00:00+05:30' }))).toBeNull()
    }
  })
})
