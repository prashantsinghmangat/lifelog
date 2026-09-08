import { describe, expect, it } from 'vitest'
import { onThisDay } from './history'
import type { Entry, Kind } from '../types'

let seq = 0
function entry(over: Partial<Entry> & { occurred_on: string }): Entry {
  seq += 1
  return {
    id: `id-${seq}`,
    kind: 'note' as Kind,
    occurred_at: null,
    title: 'something',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2020-01-01T10:00:00+05:30',
    ...over,
  }
}

describe('on this day', () => {
  const LOG: Entry[] = [
    entry({ occurred_on: '2026-09-07', title: 'today itself' }),
    entry({ occurred_on: '2025-09-07', title: 'met rahul' }),
    entry({ occurred_on: '2025-09-07', title: 'headphones', amount_paise: 240000 }),
    entry({ occurred_on: '2024-09-07', title: 'started new project' }),
    entry({ occurred_on: '2025-09-06', title: 'the day before, a year ago' }),
    entry({ occurred_on: '2025-10-07', title: 'same date, wrong month' }),
  ]

  const of = (day: string) => onThisDay(LOG, day)

  it('recalls the same calendar day in earlier years', () => {
    expect(of('2026-09-07').map((year) => year.year)).toEqual(['2025', '2024'])
  })

  it('keeps every entry from that day together', () => {
    expect(of('2026-09-07')[0]?.entries.map((row) => row.title)).toEqual([
      'met rahul',
      'headphones',
    ])
  })

  it('leaves the day you are looking at out of its own memories', () => {
    const titles = of('2026-09-07').flatMap((year) => year.entries.map((row) => row.title))
    expect(titles).not.toContain('today itself')
  })

  it('does not wander to a neighbouring day or the same date in another month', () => {
    const titles = of('2026-09-07').flatMap((year) => year.entries.map((row) => row.title))
    expect(titles).not.toContain('the day before, a year ago')
    expect(titles).not.toContain('same date, wrong month')
  })

  it('carries the full date, so tapping through lands on the right day', () => {
    expect(of('2026-09-07')[0]?.day).toBe('2025-09-07')
  })

  it('says nothing when there is nothing to say', () => {
    expect(of('2026-03-15')).toEqual([])
  })

  it('never remembers the future', () => {
    // An event dated next year is something ahead of you. Filed under "on this
    // day" it would make the log look like it remembers what has not happened.
    const ahead = [entry({ occurred_on: '2027-09-07', title: 'next year' })]
    expect(onThisDay(ahead, '2026-09-07')).toEqual([])
  })

  it('only ever recalls a 29 February from another leap year', () => {
    // Matched as text rather than by subtracting a year, which would quietly
    // answer with the 28th or the 1st.
    const leap = [
      entry({ occurred_on: '2020-02-29', title: 'leap day' }),
      entry({ occurred_on: '2023-02-28', title: 'not a leap day' }),
    ]
    const found = onThisDay(leap, '2024-02-29')
    expect(found.map((year) => year.year)).toEqual(['2020'])
  })

  it('orders a recalled day the way the timeline would', () => {
    const mixed = [
      entry({ occurred_on: '2025-09-07', title: 'untimed', created_at: '2025-09-07T08:00:00+05:30' }),
      entry({ occurred_on: '2025-09-07', title: 'evening', occurred_at: '2025-09-07T19:00:00+05:30' }),
      entry({ occurred_on: '2025-09-07', title: 'morning', occurred_at: '2025-09-07T09:00:00+05:30' }),
    ]
    expect(onThisDay(mixed, '2026-09-07')[0]?.entries.map((row) => row.title)).toEqual([
      'morning',
      'evening',
      'untimed',
    ])
  })
})
