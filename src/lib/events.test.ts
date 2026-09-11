import { describe, expect, it } from 'vitest'
import {
  behindYou,
  done,
  nextOccurrence,
  passed,
  recurring,
  repeatLabel,
  weeklyDays,
} from './events'
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

describe('ticking something off by hand', () => {
  it('is false until it is set', () => {
    expect(done(entry({ occurred_on: '2026-09-05' }))).toBe(false)
  })

  it('applies to any kind, not just a reminder', () => {
    // `passed` is about a clock. A note saying "send the revised scope" is done
    // when you decide it is, and nothing about the time of day can know that.
    const note = entry({ occurred_on: '2026-09-05', kind: 'note', data: { done: true } })
    expect(passed(note, NOW)).toBe(false)
    expect(done(note)).toBe(true)
    expect(behindYou(note, NOW)).toBe(true)
  })

  it('strikes a row either way — the moment went by, or you said so', () => {
    const gone = entry({ occurred_on: '2026-09-05', occurred_at: at('2026-09-05', '09:00:00') })
    const ticked = entry({ occurred_on: '2026-09-30', data: { done: true } })
    const neither = entry({ occurred_on: '2026-09-30' })

    expect(behindYou(gone, NOW)).toBe(true)
    expect(behindYou(ticked, NOW)).toBe(true)
    expect(behindYou(neither, NOW)).toBe(false)
  })
})

describe('a weekly rule', () => {
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }

  it('reads its days out of the rule', () => {
    expect(weeklyDays(entry({ occurred_on: '2026-09-14', data: weekdays }))).toEqual([1, 2, 3, 4, 5])
    expect(weeklyDays(entry({ occurred_on: '2026-09-14' }))).toBeNull()
    expect(weeklyDays(entry({ occurred_on: '2026-09-14', data: { rrule: 'FREQ=YEARLY' } }))).toBeNull()
  })

  it('counts as recurring', () => {
    expect(recurring(entry({ occurred_on: '2026-09-14', data: weekdays }))).toBe(true)
  })

  it('is never behind you, however old its date', () => {
    // NOW is Saturday 5 September. A standup dated last January still rings on
    // Monday, so striking it through would be a lie.
    const row = entry({
      occurred_on: '2026-01-05',
      occurred_at: at('2026-01-05', '10:00:00'),
      data: weekdays,
    })
    expect(passed(row, NOW)).toBe(false)
    expect(behindYou(row, NOW)).toBe(false)
  })

  it('answers with the soonest listed weekday', () => {
    // Saturday, so the next weekday is Monday the 7th.
    const row = entry({ occurred_on: '2026-01-05', occurred_at: at('2026-01-05', '10:00:00'), data: weekdays })
    expect(nextOccurrence(row, NOW)?.getDate()).toBe(7)
  })

  it('does not start before the day it is set up for', () => {
    // Set up on Saturday the 5th to begin on Monday the 14th. Scanning from
    // today alone answered Monday the 7th — a week early, and the phone rang
    // to match while the row plainly said the 14th.
    const row = entry({
      occurred_on: '2026-09-14',
      occurred_at: at('2026-09-14', '10:00:00'),
      data: weekdays,
    })
    expect(nextOccurrence(row, NOW)?.toDateString()).toBe('Mon Sep 14 2026')
  })

  it('picks the first listed weekday on or after a future start', () => {
    // Starting Saturday the 12th, which is not a weekday: Monday the 14th.
    const row = entry({ occurred_on: '2026-09-12', data: weekdays })
    expect(nextOccurrence(row, NOW)?.toDateString()).toBe('Mon Sep 14 2026')
  })

  it('counts today while its time has not gone by', () => {
    const monday = new Date(2026, 8, 7, 8, 0, 0)
    const row = entry({ occurred_on: '2026-01-05', occurred_at: at('2026-01-05', '10:00:00'), data: weekdays })
    // Eight in the morning: today's ten o'clock standup is still ahead.
    expect(nextOccurrence(row, monday)?.getDate()).toBe(7)

    const afterwards = new Date(2026, 8, 7, 11, 0, 0)
    expect(nextOccurrence(row, afterwards)?.getDate()).toBe(8)
  })
})

describe('saying a repeat in words', () => {
  // The row is the only evidence a repeat worked, since nothing expands it.
  it('calls Monday to Friday weekdays', () => {
    const row = entry({ occurred_on: '2026-09-14', data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } })
    expect(repeatLabel(row)).toBe('weekdays')
  })

  it('lists the days of any other weekly rule, in week order', () => {
    const row = entry({ occurred_on: '2026-09-14', data: { rrule: 'FREQ=WEEKLY;BYDAY=WE,MO' } })
    expect(repeatLabel(row)).toBe('every Mon, Wed')
  })

  it('names a yearly rule and says nothing about a one-off', () => {
    expect(repeatLabel(entry({ occurred_on: '2026-11-14', data: { rrule: 'FREQ=YEARLY' } }))).toBe(
      'every year',
    )
    expect(repeatLabel(entry({ occurred_on: '2026-11-14' }))).toBeNull()
  })

  it('does not call a single weekday "weekdays"', () => {
    const row = entry({ occurred_on: '2026-09-14', data: { rrule: 'FREQ=WEEKLY;BYDAY=MO' } })
    expect(repeatLabel(row)).toBe('every Mon')
  })
})
