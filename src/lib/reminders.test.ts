import { describe, expect, it } from 'vitest'
import { alarms, fireAt, notificationId } from './reminders'
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

describe('a reminder that has been ticked off', () => {
  it('does not fire', () => {
    // Otherwise "call mom" rings at five to remind you of something you did at
    // three, which is worse than no reminder: it teaches you to ignore them.
    const row = entry({
      id: 'ticked',
      occurred_on: '2026-09-20',
      occurred_at: '2026-09-20T17:00:00+05:30',
      data: { done: true },
    })
    expect(fireAt(row)).toBeNull()
  })

  it('still fires while it is not', () => {
    const row = entry({
      id: 'live',
      occurred_on: '2026-09-20',
      occurred_at: '2026-09-20T17:00:00+05:30',
    })
    expect(fireAt(row)).not.toBeNull()
  })
})

describe('the ids the daily prompts own', () => {
  it('are never produced for a row', () => {
    // The two prompts hold ids 1 and 2. If a row could hash onto one, logging
    // an entry would silently replace a prompt, or the prompt would replace it.
    const ids = new Set<number>()
    for (let n = 0; n < 20_000; n += 1) {
      ids.add(notificationId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`))
    }
    expect([...ids].every((id) => id >= 8)).toBe(true)
  })

  it('still hashes the same uuid to the same id', () => {
    // Or a reminder could never be cancelled again.
    expect(notificationId('abc')).toBe(notificationId('abc'))
    expect(notificationId('abc')).not.toBe(notificationId('abd'))
  })
})

describe('when a weekly repeat has not begun yet', () => {
  // Thursday 10 September 2026, twenty past ten at night.
  const NOW = new Date(2026, 8, 10, 22, 20, 0)
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }
  const ten = (day: string) => `${day}T10:00:00+05:30`

  /** The weekdays armed as a standing cron, as `Date.getDay()` numbers. */
  const crons = (armed: ReturnType<typeof alarms>) =>
    armed.filter((a) => a.on !== undefined).map((a) => (a.on?.weekday ?? 0) - 1)

  const oneOffs = (armed: ReturnType<typeof alarms>) =>
    armed.filter((a) => a.at !== undefined).map((a) => a.at?.toDateString())

  it('holds back only the weekdays whose cron would fire before the start', () => {
    // Set up on Thursday to start on Monday the 14th. A bare weekday cron
    // fires on the next matching day, so Friday's would have gone off on the
    // 11th — three days before the standup begins.
    const row = entry({
      id: 'r1',
      occurred_on: '2026-09-14',
      occurred_at: ten('2026-09-14'),
      data: weekdays,
    })
    const armed = alarms(row, NOW)

    expect(armed).toHaveLength(5)
    expect(crons(armed).sort()).toEqual([1, 2, 3, 4])
    expect(oneOffs(armed)).toEqual(['Fri Sep 18 2026'])
  })

  it('leaves the ordinary case as five standing crons', () => {
    // Typed today, landing on tomorrow: nothing would fire early, so nothing
    // is held back. Turning these into one-offs would stop the repeat after a
    // week for anyone who did not reopen the app.
    const row = entry({
      id: 'r2',
      occurred_on: '2026-09-11',
      occurred_at: ten('2026-09-11'),
      data: weekdays,
    })
    const armed = alarms(row, NOW)

    expect(crons(armed).sort()).toEqual([1, 2, 3, 4, 5])
    expect(oneOffs(armed)).toEqual([])
  })

  it('keeps the same ids either way, so a later launch can swap them over', () => {
    const early = entry({ id: 'r3', occurred_on: '2026-09-21', data: weekdays })
    const begun = entry({ id: 'r3', occurred_on: '2026-09-01', data: weekdays })
    expect(alarms(early, NOW).map((a) => a.id)).toEqual(alarms(begun, NOW).map((a) => a.id))
  })

  it('starts a whole future week as one-offs, since every cron would be early', () => {
    const row = entry({ id: 'r4', occurred_on: '2026-09-21', data: weekdays })
    const armed = alarms(row, NOW)
    expect(crons(armed)).toEqual([])
    expect(oneOffs(armed)).toHaveLength(5)
  })
})
