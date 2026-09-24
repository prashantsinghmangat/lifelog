import { describe, expect, it } from 'vitest'
import { ahead } from './ahead'
import type { Entry, Kind } from '../types'

// Thursday, 10 September 2026, eight in the evening.
const NOW = new Date(2026, 8, 10, 20, 0, 0)

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

describe('what is coming', () => {
  it('is soonest first', () => {
    const found = ahead(
      [
        entry({ occurred_on: '2026-09-14', occurred_at: at('2026-09-14', '09:00:00'), title: 'later' }),
        entry({ occurred_on: '2026-09-11', occurred_at: at('2026-09-11', '09:00:00'), title: 'sooner' }),
      ],
      NOW,
    )
    expect(found.map((row) => row.entry.title)).toEqual(['sooner', 'later'])
  })

  it('leaves out what has already gone by', () => {
    const found = ahead(
      [entry({ occurred_on: '2026-09-10', occurred_at: at('2026-09-10', '10:00:00') })],
      NOW,
    )
    expect(found).toEqual([])
  })

  it('leaves out anything ticked off', () => {
    const found = ahead(
      [
        entry({
          occurred_on: '2026-09-11',
          occurred_at: at('2026-09-11', '09:00:00'),
          data: { done: true },
        }),
      ],
      NOW,
    )
    expect(found).toEqual([])
  })

  it('leaves out what is not a reminder at all', () => {
    const found = ahead(
      [entry({ occurred_on: '2026-09-11', kind: 'expense', amount_paise: 35000 })],
      NOW,
    )
    expect(found).toEqual([])
  })

  it('gives a weekly repeat one line, not one per weekday', () => {
    // No expansion: the whole point of storing a rule rather than five rows is
    // that it stays one thing to look at.
    const found = ahead(
      [
        entry({
          occurred_on: '2026-09-11',
          occurred_at: at('2026-09-11', '10:00:00'),
          title: 'standup',
          data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
        }),
      ],
      NOW,
    )
    expect(found).toHaveLength(1)
    // Thursday evening, so the next standup is Friday morning.
    expect(found[0]?.at.getDate()).toBe(11)
  })

  it('stops at the horizon, so a birthday in March is not "coming up"', () => {
    const found = ahead([entry({ occurred_on: '2027-03-04' })], NOW)
    expect(found).toEqual([])
  })

  it('reads a timeless event as its 9am alarm, the same as the reminder does', () => {
    const found = ahead([entry({ occurred_on: '2026-09-12' })], NOW)
    expect(found[0]?.at.getHours()).toBe(9)
  })
})
