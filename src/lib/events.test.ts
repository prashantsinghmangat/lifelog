import { describe, expect, it } from 'vitest'
import {
  behindYou,
  done,
  leadWords,
  nextFireAt,
  nextOccurrence,
  passed,
  reminderAt,
  recurring,
  repeatLabel,
  weeklyDays,
  withLead,
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

describe('an anniversary on 29 February', () => {
  const leapDay = () =>
    entry({ occurred_on: '2008-02-29', title: 'riya birthday', data: { rrule: 'FREQ=YEARLY' } })

  it('falls on the next leap year, not on 1 March', () => {
    // `new Date(2027, 1, 29)` silently rolls to 1 March, which is how the bell
    // and the alarm came to name a day the timeline draws nothing on:
    // `occurrencesOn` and `onThisDay` both match the month and day as text, so
    // a leap-day anniversary is only ever drawn on a real 29 February.
    const at = nextOccurrence(leapDay(), new Date(2026, 8, 5))
    expect(at?.getFullYear()).toBe(2028)
    expect(at?.getMonth()).toBe(1)
    expect(at?.getDate()).toBe(29)
  })

  it('is today when today is the leap day', () => {
    const at = nextOccurrence(leapDay(), new Date(2028, 1, 29, 8, 0))
    expect(at?.getDate()).toBe(29)
    expect(at?.getFullYear()).toBe(2028)
  })

  it('moves on to the following leap year once it has gone', () => {
    const at = nextOccurrence(leapDay(), new Date(2028, 2, 1))
    expect(at?.getFullYear()).toBe(2032)
  })

  it('leaves an ordinary yearly date exactly as it was', () => {
    const birthday = entry({ occurred_on: '2010-02-13', data: { rrule: 'FREQ=YEARLY' } })
    const at = nextOccurrence(birthday, NOW)
    expect(at?.getFullYear()).toBe(2027)
    expect(at?.getMonth()).toBe(1)
    expect(at?.getDate()).toBe(13)
  })

  it('keeps this year when the date is still ahead', () => {
    const birthday = entry({ occurred_on: '2010-11-14', data: { rrule: 'FREQ=YEARLY' } })
    expect(nextOccurrence(birthday, NOW)?.getFullYear()).toBe(2026)
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

  it('names a one-off’s lead on its own, since it repeats nothing', () => {
    const row = entry({ occurred_on: '2027-03-12', data: { lead: 60 * 24 * 7 } })
    expect(repeatLabel(row)).toBe('reminder 1 week before')
  })

  it('combines a yearly rule and a lead, the rule first', () => {
    const row = entry({ occurred_on: '2010-02-13', data: { rrule: 'FREQ=YEARLY', lead: 60 * 24 } })
    expect(repeatLabel(row)).toBe('every year · reminder 1 day before')
  })

  it('says nothing about an absent, zero or unset lead', () => {
    expect(repeatLabel(entry({ occurred_on: '2026-09-14', data: { lead: 0 } }))).toBeNull()
    expect(repeatLabel(entry({ occurred_on: '2026-09-14' }))).toBeNull()
  })
})

describe('the words for a lead', () => {
  it('picks the largest unit a lead divides into exactly', () => {
    expect(leadWords(15)).toBe('15 minutes')
    expect(leadWords(60)).toBe('1 hour')
    expect(leadWords(120)).toBe('2 hours')
    expect(leadWords(60 * 24)).toBe('1 day')
    expect(leadWords(60 * 24 * 7)).toBe('1 week')
    expect(leadWords(60 * 24 * 30)).toBe('1 month')
  })

  it('falls back to minutes when nothing larger divides it exactly', () => {
    expect(leadWords(90)).toBe('90 minutes')
  })
})

describe('pulling a moment back by a lead', () => {
  it('leaves a moment untouched with no lead, or a zero or invalid one', () => {
    const at = new Date(2026, 8, 14, 9, 0, 0)
    expect(withLead(entry({ occurred_on: '2026-09-14' }), at)).toEqual(at)
    expect(withLead(entry({ occurred_on: '2026-09-14', data: { lead: 0 } }), at)).toEqual(at)
    expect(withLead(entry({ occurred_on: '2026-09-14', data: { lead: -5 } }), at)).toEqual(at)
  })

  it('subtracts the lead in minutes', () => {
    const at = new Date(2026, 8, 14, 9, 0, 0)
    const shifted = withLead(entry({ occurred_on: '2026-09-14', data: { lead: 90 } }), at)
    expect(shifted.getTime()).toBe(at.getTime() - 90 * 60_000)
  })
})

describe('the moment a reminder actually fires', () => {
  it('is the event’s own moment pulled back by the lead', () => {
    const row = entry({
      occurred_on: '2026-09-07',
      occurred_at: at('2026-09-07', '10:00:00'),
      data: { lead: 60 },
    })
    const fires = reminderAt(row, NOW)
    expect(fires?.getDate()).toBe(7)
    expect(fires?.getHours()).toBe(9)
  })

  it('disagrees with `passed`, on purpose', () => {
    // A warranty due tomorrow with a two-day lead has already had its
    // reminder moment go by — the reminder fires, the warranty has not.
    const row = entry({ occurred_on: '2026-09-06', data: { lead: 60 * 24 * 2 } })
    expect(reminderAt(row, NOW)).toBeNull()
    expect(passed(row, NOW)).toBe(false)
  })

  it('has no answer once the shifted moment, not just the stored one, has gone', () => {
    // The event itself is still hours away; the lead alone has already passed.
    const row = entry({
      occurred_on: '2026-09-05',
      occurred_at: at('2026-09-05', '15:00:00'),
      data: { lead: 60 },
    })
    expect(reminderAt(row, NOW)).toBeNull()
  })

  it('applies a yearly lead to the next occurrence, not the stored date', () => {
    const row = entry({
      occurred_on: '2010-02-13',
      occurred_at: at('2010-02-13', '18:00:00'),
      data: { rrule: 'FREQ=YEARLY', lead: 60 * 24 },
    })
    const fires = reminderAt(row, NOW)
    expect(fires?.getFullYear()).toBe(2027)
    expect(fires?.getMonth()).toBe(1)
    expect(fires?.getDate()).toBe(12)
    expect(fires?.getHours()).toBe(18)
  })
})

describe('the moment an entry next happens', () => {
  /**
   * `nextOccurrence` answers with a day, and the time had to be glued on
   * separately in `ahead`, in the yearly branch of `alarms` and in the editor.
   * Three readings of "what does an entry with no clock mean" is two too many:
   * the one that disagreed would have been a reminder ringing at an hour the
   * app had never shown anybody.
   */
  it('keeps the entry’s own clock', () => {
    const row = entry({ occurred_on: '2026-09-07', occurred_at: '2026-09-07T10:30:00+05:30' })
    const at = nextFireAt(row, NOW)
    expect(at?.getDate()).toBe(7)
    expect(at?.getHours()).toBe(10)
    expect(at?.getMinutes()).toBe(30)
  })

  it('reads 9am when it carries none, which is when the alarm is set for', () => {
    const at = nextFireAt(entry({ occurred_on: '2026-09-07' }), NOW)
    expect(at?.getHours()).toBe(9)
    expect(at?.getMinutes()).toBe(0)
  })

  it('puts a yearly repeat’s clock on its next occurrence, not on the stored year', () => {
    const row = entry({
      occurred_on: '2010-02-13',
      occurred_at: '2010-02-13T18:00:00+05:30',
      data: { rrule: 'FREQ=YEARLY' },
    })
    const at = nextFireAt(row, NOW)
    expect(at?.getFullYear()).toBe(2027)
    expect(at?.getMonth()).toBe(1)
    expect(at?.getDate()).toBe(13)
    expect(at?.getHours()).toBe(18)
  })

  it('answers for a repeat from the day it starts, never before', () => {
    // Monday the 7th, asked on Saturday the 5th: Friday the 4th is a listed
    // weekday and nearer, and answering with it is what rang before the entry
    // had begun.
    const row = entry({
      occurred_on: '2026-09-07',
      occurred_at: '2026-09-07T10:00:00+05:30',
      data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    })
    expect(nextFireAt(row, NOW)?.getDate()).toBe(7)
  })

  it('has no answer for a one-off that has gone, or for anything that is not an event', () => {
    expect(nextFireAt(entry({ occurred_on: '2026-09-01' }), NOW)).toBeNull()
    expect(nextFireAt(entry({ occurred_on: '2026-09-07', kind: 'note' }), NOW)).toBeNull()
  })

  it('has no answer for a moment earlier today, which a *day* still counts as next', () => {
    // The difference between the two functions, and the reason the rule lives
    // here: 5 September is today either way, and nine o'clock this morning is
    // not something that is about to happen.
    const gone = entry({ occurred_on: '2026-09-05', occurred_at: at('2026-09-05', '09:00:00') })
    expect(nextOccurrence(gone, NOW)?.getDate()).toBe(5)
    expect(nextFireAt(gone, NOW)).toBeNull()

    const still = entry({ occurred_on: '2026-09-05', occurred_at: at('2026-09-05', '17:00:00') })
    expect(nextFireAt(still, NOW)?.getHours()).toBe(17)
  })

  it('still answers for a done entry — silence is `fireAt`’s decision, not this one', () => {
    // Kept deliberately separate: one choke point decides whether a reminder is
    // armed, and it is not this function. The editor says "done" in its own words.
    const row = entry({ occurred_on: '2026-09-07', data: { done: true } })
    expect(nextFireAt(row, NOW)?.getDate()).toBe(7)
  })
})
