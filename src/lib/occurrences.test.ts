import { describe, expect, it } from 'vitest'
import { isOccurrence, occurrencesOn } from './occurrences'
import type { Entry, Kind } from '../types'

let seq = 0
function entry(over: Partial<Entry> & { occurred_on: string }): Entry {
  seq += 1
  return {
    id: `id-${seq}`,
    kind: 'event' as Kind,
    occurred_at: null,
    title: 'standup',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
    ...over,
  }
}

const WEEKDAYS = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }

describe('drawing a repeat on the days it lands on', () => {
  // Monday 14 September 2026 at ten, repeating on weekdays.
  const standup = () =>
    entry({ occurred_on: '2026-09-14', occurred_at: '2026-09-14T10:00:00+05:30', data: WEEKDAYS })

  it('appears on a later weekday it is not stored under', () => {
    // Tuesday read as an empty day while an alarm was armed for ten o'clock,
    // which is what made a working repeat look broken.
    const found = occurrencesOn([standup()], '2026-09-15')
    expect(found).toHaveLength(1)
    expect(found[0]?.occurred_on).toBe('2026-09-15')
    expect(found[0]?.title).toBe('standup')
  })

  it('keeps the clock while moving the date', () => {
    const found = occurrencesOn([standup()], '2026-09-16')
    const at = found[0]?.occurred_at
    expect(at).not.toBeNull()
    expect(new Date(at ?? '').getHours()).toBe(10)
    expect(new Date(at ?? '').getDate()).toBe(16)
  })

  it('is not drawn twice on its own start date', () => {
    // The stored row is already on screen there.
    expect(occurrencesOn([standup()], '2026-09-14')).toEqual([])
  })

  it('never appears before the day it starts', () => {
    // Friday the 11th is a weekday, but the standup begins on the 14th — the
    // same bound the alarms use, so the row and the phone agree.
    expect(occurrencesOn([standup()], '2026-09-11')).toEqual([])
  })

  it('skips the days the rule does not list', () => {
    expect(occurrencesOn([standup()], '2026-09-19')).toEqual([]) // Saturday
    expect(occurrencesOn([standup()], '2026-09-20')).toEqual([]) // Sunday
  })

  it('carries on into later weeks', () => {
    expect(occurrencesOn([standup()], '2026-10-06')).toHaveLength(1)
  })

  it('marks what it derived, so nothing totals it', () => {
    const found = occurrencesOn([standup()], '2026-09-15')
    expect(isOccurrence(found[0] as Entry)).toBe(true)
    expect(isOccurrence(standup())).toBe(false)
  })
})

describe('a yearly repeat', () => {
  it('appears on the date in a later year', () => {
    // A birthday logged in 2010 was drawn in 2010 and nowhere else, so the day
    // itself showed nothing while the reminder fired.
    const birthday = entry({
      occurred_on: '2010-02-13',
      title: 'deepak birthday',
      data: { rrule: 'FREQ=YEARLY' },
    })
    expect(occurrencesOn([birthday], '2027-02-13')).toHaveLength(1)
    expect(occurrencesOn([birthday], '2027-02-14')).toEqual([])
  })

  it('only ever recalls the same calendar day', () => {
    // 29 February must not answer with the 28th, matching `onThisDay`.
    const leap = entry({ occurred_on: '2024-02-29', data: { rrule: 'FREQ=YEARLY' } })
    expect(occurrencesOn([leap], '2028-02-29')).toHaveLength(1)
    expect(occurrencesOn([leap], '2027-02-28')).toEqual([])
  })
})

describe('what is left alone', () => {
  it('ignores a one-off', () => {
    expect(occurrencesOn([entry({ occurred_on: '2026-09-14' })], '2026-09-15')).toEqual([])
  })

  it('ignores anything that is not an event', () => {
    for (const kind of ['expense', 'time', 'note'] as Kind[]) {
      const row = entry({ occurred_on: '2026-09-14', kind, data: WEEKDAYS })
      expect(occurrencesOn([row], '2026-09-15')).toEqual([])
    }
  })

  it('draws an all-day repeat with no clock at all', () => {
    const row = entry({ occurred_on: '2026-09-14', data: WEEKDAYS })
    const found = occurrencesOn([row], '2026-09-15')
    expect(found).toHaveLength(1)
    expect(found[0]?.occurred_at).toBeNull()
  })
})
