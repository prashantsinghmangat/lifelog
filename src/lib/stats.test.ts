import { describe, expect, it } from 'vitest'
import {
  columnsFor,
  peak,
  periodLabel,
  spanOf,
  stepAnchor,
  totalsFor,
  valueOf,
} from './stats'
import SOURCE from './stats.ts?raw'
import type { Entry, Kind } from '../types'

/**
 * Exact arithmetic, against a fixture with known totals. If these are right
 * the screen is a rendering problem; if they are wrong, every bar is a
 * confident lie that no screenshot would catch.
 */

// A Thursday. Injected everywhere — nothing here reads the clock.
const NOW = new Date(2026, 8, 17, 14, 30, 0)

let ids = 0
function row(over: Partial<Entry> & { kind: Kind; occurred_on: string }): Entry {
  return {
    id: `row-${++ids}`,
    occurred_at: null,
    title: 'fixture',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T09:00:00+05:30',
    ...over,
  }
}

/** September 2026 as a small log: money, time, a repeat, a refund. */
const ROWS: Entry[] = [
  row({ kind: 'expense', occurred_on: '2026-09-14', amount_paise: 35000, category: 'food' }),
  row({ kind: 'expense', occurred_on: '2026-09-14', amount_paise: 4000, category: 'food' }),
  row({ kind: 'expense', occurred_on: '2026-09-15', amount_paise: 120000, category: 'travel' }),
  // A refund: signed, and it must survive into the category as-is.
  row({ kind: 'expense', occurred_on: '2026-09-16', amount_paise: -5000, category: 'food' }),
  // Money with no category — the absence bucket.
  row({ kind: 'expense', occurred_on: '2026-09-16', amount_paise: 900000 }),
  row({ kind: 'time', occurred_on: '2026-09-15', duration_minutes: 120 }),
  row({ kind: 'time', occurred_on: '2026-09-17', duration_minutes: 45 }),
  // A weekday repeat, stored once on the 14th. It rings five days a week; it
  // counts once, on the day it is stored.
  row({
    kind: 'event',
    occurred_on: '2026-09-14',
    occurred_at: '2026-09-14T10:00:00+05:30',
    data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  }),
  row({ kind: 'note', occurred_on: '2026-09-16' }),
]

describe('spanOf', () => {
  it('is the day itself at day scale', () => {
    expect(spanOf('day', '2026-09-17')).toEqual({ from: '2026-09-17', to: '2026-09-17' })
  })

  it('starts the week on Monday, because WEEK_STARTS says so', () => {
    // 2026-09-17 is a Thursday; its week is Mon 14 – Sun 20.
    expect(spanOf('week', '2026-09-17')).toEqual({ from: '2026-09-14', to: '2026-09-20' })
    // A Monday anchors its own week, not the one before.
    expect(spanOf('week', '2026-09-14').from).toBe('2026-09-14')
  })

  it('covers 28, 30 and 31 day months exactly', () => {
    expect(spanOf('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(spanOf('month', '2026-09-17')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(spanOf('month', '2026-08-31')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('covers the year', () => {
    expect(spanOf('year', '2026-09-17')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})

describe('stepAnchor', () => {
  it('steps one period at the scale', () => {
    expect(stepAnchor('day', '2026-09-16', 1, NOW)).toBe('2026-09-17')
    expect(stepAnchor('week', '2026-09-17', -1, NOW)).toBe('2026-09-10')
    expect(stepAnchor('month', '2026-09-17', -1, NOW)).toBe('2026-08-17')
    expect(stepAnchor('year', '2026-09-17', -1, NOW, '2025-01-01')).toBe('2025-09-17')
  })

  it('never produces a period starting after now', () => {
    expect(stepAnchor('day', '2026-09-17', 1, NOW)).toBeNull()
    // The week containing NOW is the last reachable week.
    expect(stepAnchor('week', '2026-09-17', 1, NOW)).toBeNull()
    expect(stepAnchor('month', '2026-09-17', 1, NOW)).toBeNull()
    expect(stepAnchor('year', '2026-09-17', 1, NOW)).toBeNull()
  })

  it('still steps into the current period from behind', () => {
    // Stepping into a period that contains today is fine; only one that
    // *starts* after today is not.
    expect(stepAnchor('week', '2026-09-10', 1, NOW)).toBe('2026-09-17')
    expect(stepAnchor('month', '2026-08-17', 1, NOW)).toBe('2026-09-17')
  })

  it('stops at the floor', () => {
    expect(stepAnchor('day', '2026-01-01', -1, NOW)).toBeNull()
    expect(stepAnchor('month', '2026-01-15', -1, NOW)).toBeNull()
    // A floor from older data keeps older periods reachable.
    expect(stepAnchor('month', '2026-01-15', -1, NOW, '2025-06-01')).toBe('2025-12-15')
    expect(stepAnchor('month', '2025-06-15', -1, NOW, '2025-06-01')).toBeNull()
    // The week straddling the floor is reachable; the one before it is not.
    expect(stepAnchor('week', '2026-01-05', -1, NOW)).toBe('2025-12-29')
    expect(stepAnchor('week', '2025-12-29', -1, NOW)).toBeNull()
  })
})

describe('totalsFor', () => {
  const september = { from: '2026-09-01', to: '2026-09-30' }

  it('sums paise as integers and minutes separately', () => {
    const totals = totalsFor(ROWS, september)
    expect(totals.paise).toBe(35000 + 4000 + 120000 - 5000 + 900000)
    expect(totals.minutes).toBe(165)
    expect(Number.isInteger(totals.paise)).toBe(true)
  })

  it('counts per kind and the days that held anything', () => {
    const totals = totalsFor(ROWS, september)
    expect(totals.counts).toEqual({ expense: 5, time: 2, event: 1, note: 1 })
    expect(totals.activeDays).toBe(4)
  })

  it('counts a repeat once, on the day it is stored', () => {
    // The standup rings Monday to Friday; the log holds one row on the 14th.
    // Any other day of its week reports nothing — the same rule the day
    // screen's totals follow, or a standup costs five times what it did.
    expect(totalsFor(ROWS, { from: '2026-09-14', to: '2026-09-14' }).counts.event).toBe(1)
    expect(totalsFor(ROWS, { from: '2026-09-15', to: '2026-09-15' }).counts.event).toBe(0)
    expect(totalsFor(ROWS, september).counts.event).toBe(1)
  })

  it('lets a refund reduce the total and survive into its category', () => {
    const totals = totalsFor(ROWS, september)
    const food = totals.byCategory.find((entry) => entry.name === 'food')
    expect(food?.paise).toBe(35000 + 4000 - 5000)
    // A day that is only a refund sums below zero, unclamped.
    expect(totalsFor(ROWS, { from: '2026-09-16', to: '2026-09-16' }).paise).toBe(-5000 + 900000)
  })

  it('sorts categories by spend and keeps the absence bucket last even when largest', () => {
    const names = totalsFor(ROWS, september).byCategory.map((entry) => entry.name)
    // The uncategorised ₹9,000 dwarfs everything and still comes last.
    expect(names).toEqual(['travel', 'food', null])
  })

  it('returns zeros for an empty span, never NaN', () => {
    const totals = totalsFor(ROWS, { from: '2026-03-01', to: '2026-03-31' })
    expect(totals).toEqual({
      paise: 0,
      minutes: 0,
      counts: { expense: 0, time: 0, event: 0, note: 0 },
      activeDays: 0,
      byCategory: [],
    })
  })

  it('gives a soft-deleted row nothing to say', () => {
    const deleted = [
      { ...row({ kind: 'expense', occurred_on: '2026-09-14', amount_paise: 99900 }), deleted_at: '2026-09-15T00:00:00Z' },
    ] as unknown as Entry[]
    expect(totalsFor(deleted, september).paise).toBe(0)
    expect(totalsFor(deleted, september).counts.expense).toBe(0)
  })

  it('spans a month boundary and 1 January', () => {
    const straddling = [
      row({ kind: 'expense', occurred_on: '2025-12-31', amount_paise: 100 }),
      row({ kind: 'expense', occurred_on: '2026-01-01', amount_paise: 200 }),
    ]
    expect(totalsFor(straddling, { from: '2025-12-29', to: '2026-01-04' }).paise).toBe(300)
    expect(totalsFor(straddling, { from: '2026-01-01', to: '2026-01-04' }).paise).toBe(200)
  })
})

describe('columnsFor', () => {
  it('draws seven Monday-first columns for a week, even a partial one', () => {
    // The week holding 1 January 2026 runs Mon 29 Dec – Sun 4 Jan. Seven
    // columns regardless, so the axis never shifts.
    const columns = columnsFor([], 'week', '2026-01-01', NOW)
    expect(columns).toHaveLength(7)
    expect(columns[0]?.key).toBe('2025-12-29')
    expect(columns[6]?.key).toBe('2026-01-04')
    expect(columns.map((column) => column.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it('draws every day of the month', () => {
    expect(columnsFor([], 'month', '2026-02-10', NOW)).toHaveLength(28)
    expect(columnsFor([], 'month', '2026-09-17', NOW)).toHaveLength(30)
    const august = columnsFor(ROWS, 'month', '2026-08-01', NOW)
    expect(august).toHaveLength(31)
  })

  it('marks today and only today', () => {
    const columns = columnsFor(ROWS, 'month', '2026-09-17', NOW)
    expect(columns.filter((column) => column.isNow).map((column) => column.key)).toEqual([
      '2026-09-17',
    ])
  })

  it('drills a day bar to that day, and no bar to the future', () => {
    const columns = columnsFor(ROWS, 'month', '2026-09-17', NOW)
    expect(columns[13]?.drillTo).toEqual({ scale: 'day', anchor: '2026-09-14' })
    // The 18th onwards is after NOW: baseline only, nowhere to go.
    expect(columns[17]?.drillTo).toBeNull()
  })

  it('draws twelve months for a year, the future ones bare', () => {
    const columns = columnsFor(ROWS, 'year', '2026-09-17', NOW)
    expect(columns).toHaveLength(12)
    expect(columns[8]?.totals.paise).toBe(totalsFor(ROWS, spanOf('month', '2026-09-01')).paise)
    expect(columns[8]?.isNow).toBe(true)
    expect(columns[8]?.drillTo).toEqual({ scale: 'month', anchor: '2026-09-01' })
    expect(columns[9]?.drillTo).toBeNull()
    expect(columns[9]?.totals.paise).toBe(0)
  })

  it('buckets the day by clock and leaves untimed rows to the caller to count', () => {
    const timed = [
      row({
        kind: 'expense',
        occurred_on: '2026-09-14',
        occurred_at: '2026-09-14T13:15:00+05:30',
        amount_paise: 5000,
      }),
      ...ROWS,
    ]
    const columns = columnsFor(timed, 'day', '2026-09-14', NOW)
    expect(columns).toHaveLength(16)
    expect(columns[0]?.label).toBe('6a')
    expect(columns[15]?.label).toBe('9p')
    // The 10am standup and the 1:15pm expense land on their hours.
    expect(columns[4]?.totals.counts.event).toBe(1)
    expect(columns[7]?.totals.paise).toBe(5000)
    // The two untimed expenses of the 14th are in no bar; the caller compares
    // bar counts against the day total to say how many were left out.
    const barred = columns.reduce((sum, column) => sum + valueOf(column.totals, 'entries'), 0)
    const total = valueOf(totalsFor(timed, { from: '2026-09-14', to: '2026-09-14' }), 'entries')
    expect(total - barred).toBe(2)
    // And an hour never travels anywhere.
    expect(columns.every((column) => column.drillTo === null)).toBe(true)
  })
})

describe('bar heights', () => {
  it('never divides by zero on an empty period', () => {
    expect(peak(columnsFor([], 'month', '2026-04-15', NOW), 'spent')).toBe(1)
    expect(peak([], 'entries')).toBe(1)
  })

  it('measures a refund by its size, keeping the sign out of the pixels', () => {
    expect(valueOf({ ...totalsFor([], { from: 'x', to: 'x' }), paise: -5000 }, 'spent')).toBe(5000)
  })
})

describe('periodLabel', () => {
  it('names each scale the way the header reads', () => {
    expect(periodLabel('day', '2026-09-16')).toBe('Wed 16 Sep')
    expect(periodLabel('week', '2026-09-17')).toBe('14 – 20 Sep')
    expect(periodLabel('week', '2026-09-01')).toBe('31 Aug – 6 Sep')
    expect(periodLabel('month', '2026-09-17')).toBe('September 2026')
    expect(periodLabel('year', '2026-09-17')).toBe('2026')
  })
})

describe('purity', () => {
  it('never calls new Date()', () => {
    // The whole contract: `now` is injected, so the tests above pin real
    // dates. A bare `new Date()` anywhere in the module would quietly break
    // that on some future edit.
    const source = SOURCE
    expect(source).not.toMatch(/new Date\(\)/)
    expect(source).not.toMatch(/toISOString/)
    expect(source).not.toMatch(/from 'react'|supabase/)
  })
})
