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

  it('is pulled back by a lead — the day becomes a moment here, and the shift happens in the same place', () => {
    const timed = fireAt(
      entry({ id: 'a', occurred_at: '2026-09-02T17:00:00+05:30', data: { lead: 30 } }),
    )
    expect(timed?.getHours()).toBe(16)
    expect(timed?.getMinutes()).toBe(30)

    const allDay = fireAt(entry({ id: 'a', occurred_on: '2026-11-14', data: { lead: 60 * 24 } }))
    expect(allDay?.getDate()).toBe(13)
    expect(allDay?.getHours()).toBe(9)
  })
})

describe('a lead landing in the past', () => {
  it('schedules nothing — the caller compares against the shifted moment, not the stored one', () => {
    // The event is tomorrow morning; a two-day lead has already gone by.
    const now = new Date(2026, 8, 1, 10, 0)
    const row = entry({
      id: 'a',
      occurred_at: '2026-09-02T09:00:00+05:30',
      data: { lead: 60 * 24 * 2 },
    })
    expect(alarms(row, now)).toEqual([])
  })

  it('still arms once the shifted moment is far enough ahead', () => {
    const now = new Date(2026, 8, 1, 10, 0)
    const row = entry({ id: 'a', occurred_at: '2026-09-05T09:00:00+05:30', data: { lead: 60 * 24 } })
    const due = alarms(row, now)
    expect(due).toHaveLength(1)
    expect(due[0]?.at?.getDate()).toBe(4)
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

describe('a yearly repeat', () => {
  const birthday = (on: string) =>
    entry({ id: 'bday', occurred_on: on, title: 'deepak birthday', data: { rrule: 'FREQ=YEARLY' } })

  it('is armed for next year once this year has gone by', () => {
    // The bell, the day it lands on and the .ics all say a birthday recurs.
    // The alarm did not: `fireAt` returns the date on the row, so a birthday
    // logged in February was simply in the past by March and nothing was ever
    // scheduled again — the one part of a recurring reminder that has to work.
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(birthday('2010-02-13'), now)

    expect(due).toHaveLength(1)
    expect(due[0]?.at?.getFullYear()).toBe(2027)
    expect(due[0]?.at?.getMonth()).toBe(1)
    expect(due[0]?.at?.getDate()).toBe(13)
    expect(due[0]?.at?.getHours()).toBe(9)
  })

  it('keeps this year while the day is still ahead', () => {
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(birthday('2010-11-14'), now)

    expect(due[0]?.at?.getFullYear()).toBe(2026)
    expect(due[0]?.at?.getMonth()).toBe(10)
  })

  it('keeps the id it always had, so the launch re-arm replaces rather than doubles', () => {
    const now = new Date(2026, 8, 11, 14, 30)
    expect(alarms(birthday('2010-02-13'), now)[0]?.id).toBe(notificationId('bday'))
  })

  it('stays silent once it is ticked off', () => {
    const now = new Date(2026, 8, 11, 14, 30)
    const finished = entry({
      id: 'bday',
      occurred_on: '2010-02-13',
      data: { rrule: 'FREQ=YEARLY', done: true },
    })
    expect(alarms(finished, now)).toEqual([])
  })

  it('applies a lead to the next occurrence, not the stored date', () => {
    // A birthday's own date is nearly always in the past — shifting that would
    // answer with a moment from a year no reminder should fire in.
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(
      entry({
        id: 'bday',
        occurred_on: '2010-02-13',
        data: { rrule: 'FREQ=YEARLY', lead: 60 * 24 },
      }),
      now,
    )
    expect(due).toHaveLength(1)
    expect(due[0]?.at?.getFullYear()).toBe(2027)
    expect(due[0]?.at?.getDate()).toBe(12)
  })

  it('drops a yearly lead once the shifted moment, not just the occurrence, has gone by', () => {
    // Nine days out; a two-week lead has already passed even though the
    // birthday itself has not.
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(
      entry({
        id: 'bday',
        occurred_on: '2010-09-20',
        data: { rrule: 'FREQ=YEARLY', lead: 60 * 24 * 14 },
      }),
      now,
    )
    expect(due).toEqual([])
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

  /**
   * A two-day repeat rings twice a week, not once.
   *
   * The parser could not express `every tuesday and thursday` until now — it
   * kept one day and dropped the other — so this scheduling path had never been
   * exercised with anything but a five-day rule or a single day. It arms one
   * cron per named weekday, which is the whole reason the fix was a parser
   * change and nothing more.
   */
  it('arms one alarm for each named weekday, not one for the entry', () => {
    const row = entry({
      id: 'r-two-day',
      occurred_on: '2026-09-15',
      occurred_at: ten('2026-09-15'),
      data: { rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' },
    })
    const armed = alarms(row, NOW)

    expect(armed).toHaveLength(2)
    // Tuesday and Thursday, as `Date.getDay()` numbers.
    expect(crons(armed).sort()).toEqual([2, 4])
    expect(oneOffs(armed)).toEqual([])
    // Distinct ids, or the second weekday would replace the first.
    expect(new Set(armed.map((a) => a.id)).size).toBe(2)
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
