import { describe, expect, it } from 'vitest'
import { nextOccurrence, passed } from './events'
import type { Entry, Kind } from '../types'

// Saturday, 5 September 2026, half past two in the afternoon.
const NOW = new Date(2026, 8, 5, 14, 30, 0)

let seq = 0
function entry(over: Partial<Entry> & { occurred_on: string }): Entry {
  seq += 1
  return {
    id: `id-${seq}`,
    kind: 'event' as Kind,
    occurred_at: null,
    title: 'something',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
    ...over,
  }
}

const at = (day: string, time: string) => `${day}T${time}+05:30`

describe('whether an event has gone by', () => {
  it('is true once its time today has passed', () => {
    const row = entry({ occurred_on: '2026-09-05', occurred_at: at('2026-09-05', '09:00:00') })
    expect(passed(row, NOW)).toBe(true)
  })

  it('is false while its time today is still ahead', () => {
    const row = entry({ occurred_on: '2026-09-05', occurred_at: at('2026-09-05', '17:00:00') })
    expect(passed(row, NOW)).toBe(false)
  })

  it('waits for the day to end when there is no time', () => {
    // A birthday today must not read as done from nine in the morning, which is
    // when its reminder happens to fire.
    expect(passed(entry({ occurred_on: '2026-09-05' }), NOW)).toBe(false)
    expect(passed(entry({ occurred_on: '2026-09-04' }), NOW)).toBe(true)
    expect(passed(entry({ occurred_on: '2026-09-06' }), NOW)).toBe(false)
  })

  it('is never true of something that recurs', () => {
    // A birthday is not a thing you finish. Struck through, it would read as
    // cancelled rather than annual.
    const birthday = entry({
      occurred_on: '2026-02-13',
      title: 'deepak birthday',
      data: { rrule: 'FREQ=YEARLY' },
    })
    expect(passed(birthday, NOW)).toBe(false)
    expect(nextOccurrence(birthday, NOW)).not.toBeNull()
  })

  it('is only ever about events', () => {
    // An expense from last week did not "pass"; it happened, which is the point.
    for (const kind of ['expense', 'time', 'note'] as Kind[]) {
      expect(passed(entry({ occurred_on: '2026-08-01', kind }), NOW)).toBe(false)
    }
  })
})

describe('when an event happens next', () => {
  it('rolls a past anniversary forward a year', () => {
    const birthday = entry({ occurred_on: '2026-02-13', data: { rrule: 'FREQ=YEARLY' } })
    expect(nextOccurrence(birthday, NOW)?.getFullYear()).toBe(2027)
  })

  it('keeps this year when the date is still ahead', () => {
    const birthday = entry({ occurred_on: '2026-11-14', data: { rrule: 'FREQ=YEARLY' } })
    expect(nextOccurrence(birthday, NOW)?.getFullYear()).toBe(2026)
  })

  it('has no next for a one-off that has gone', () => {
    expect(nextOccurrence(entry({ occurred_on: '2026-07-01' }), NOW)).toBeNull()
  })

  it('has no next for something that is not an event', () => {
    expect(nextOccurrence(entry({ occurred_on: '2026-12-01', kind: 'expense' }), NOW)).toBeNull()
  })
})
