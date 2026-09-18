// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Stats } from './Stats'
import type { Entry, Kind } from '../types'

/**
 * Journeys, not rendering: what a finger does to the chart and what the header
 * and figures say back. The arithmetic itself is pinned exactly in
 * stats.test.ts — these tests are about the wiring, which is where every
 * recent bug in this app has lived.
 */

// A Thursday, mid-afternoon. Injected; nothing reads the real clock.
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

const ROWS: Entry[] = [
  row({ kind: 'expense', occurred_on: '2026-09-14', amount_paise: 35000, category: 'food' }),
  row({ kind: 'expense', occurred_on: '2026-06-10', amount_paise: 70000, category: 'travel' }),
  row({ kind: 'time', occurred_on: '2026-09-15', duration_minutes: 150 }),
  row({
    kind: 'event',
    occurred_on: '2026-09-14',
    occurred_at: '2026-09-14T10:00:00+05:30',
  }),
]

afterEach(cleanup)

function open(day = '2026-09-17') {
  render(<Stats all={ROWS} now={NOW} day={day} />)
}

/** The period label — the accessible heading of the screen. */
function heading(): string {
  return screen.getByRole('heading', { level: 3 }).textContent ?? ''
}

/** The lead figure alone — ₹350 also appears in the blocks below it. */
function lead(): string {
  return document.querySelector('.text-3xl')?.textContent ?? ''
}

describe('drilling', () => {
  it('lands in a month from a year bar, and the figures follow', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Year' }))
    expect(heading()).toBe('2026')
    // The whole year: both expenses.
    expect(lead()).toBe('₹1,050')

    await userEvent.click(screen.getByRole('button', { name: /^June/ }))
    expect(heading()).toBe('June 2026')
    expect(lead()).toBe('₹700')
  })

  it('lands in a day from a month bar', async () => {
    open()
    expect(heading()).toBe('September 2026')

    await userEvent.click(screen.getByRole('button', { name: /^14 September/ }))
    expect(heading()).toBe('Mon 14 Sep')
    expect(lead()).toBe('₹350')
  })

  it('selects an hour at the bottom rather than drilling into nothing', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: /^14 September/ }))

    // The 10am standup sits in the 10a bar.
    const bar = screen.getByRole('button', { name: /^10a, 1 entry/ })
    await userEvent.click(bar)
    expect(heading()).toBe('Mon 14 Sep')
    expect(bar.getAttribute('aria-pressed')).toBe('true')
    // Named in the hint line with its numbers — the axis also says 10a, so
    // the assertion reads the status line rather than the first match.
    const hints = screen.getAllByRole('status')
    expect(hints.some((line) => line.textContent?.startsWith('10a'))).toBe(true)

    // Tapping again clears the selection.
    await userEvent.click(bar)
    expect(bar.getAttribute('aria-pressed')).toBe('false')
  })

  it('says how many entries stand in no hourly bar', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: /^14 September/ }))
    // One of the 14th's two entries has no clock.
    expect(screen.getByText('1 entry has no time and is not in the bars')).toBeTruthy()
  })
})

describe('the arrows', () => {
  it('step a period and stop at today', async () => {
    open()
    const forward = screen.getByRole('button', { name: 'Next period' })
    // September holds today: forward is disabled, not scrolling into an
    // October a reader would take for data loss.
    expect(forward.hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(heading()).toBe('August 2026')
    expect(forward.hasAttribute('disabled')).toBe(false)
  })

  it('stop at the log’s first day going back', async () => {
    open()
    const backward = screen.getByRole('button', { name: 'Previous period' })
    // The oldest row is June: August, July, June, and no further.
    await userEvent.click(backward)
    await userEvent.click(backward)
    await userEvent.click(backward)
    expect(heading()).toBe('June 2026')
    expect(backward.hasAttribute('disabled')).toBe(true)
  })
})

describe('switching scale', () => {
  it('keeps the anchor day inside every period', async () => {
    open()
    // Drill to the 14th so the anchor is a known day.
    await userEvent.click(screen.getByRole('button', { name: /^14 September/ }))
    expect(heading()).toBe('Mon 14 Sep')

    await userEvent.click(screen.getByRole('button', { name: 'Week' }))
    // The week holding the 14th, not this week by accident — though this week
    // it is, Monday first.
    expect(heading()).toBe('14 – 20 Sep')

    await userEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(heading()).toBe('September 2026')

    await userEvent.click(screen.getByRole('button', { name: 'Year' }))
    expect(heading()).toBe('2026')

    await userEvent.click(screen.getByRole('button', { name: 'Day' }))
    expect(heading()).toBe('Mon 14 Sep')
  })
})

describe('measures', () => {
  it('keeps the lead figure while the bars change to one colour', async () => {
    open()
    expect(lead()).toBe('₹350')

    await userEvent.click(screen.getByRole('button', { name: 'Spent' }))
    // The measure changes the picture, never the headline.
    expect(lead()).toBe('₹350')

    // One solid segment in the expense colour, where Entries stacked two kinds
    // on the 14th.
    const chart = screen.getByRole('group', { name: /Entries by day/ })
    const day14 = within(chart).getByRole('button', { name: /^14 September/ })
    expect(day14.querySelectorAll('.bg-expense').length).toBe(1)
    expect(day14.querySelectorAll('.bg-event').length).toBe(0)
  })
})

describe('an empty period', () => {
  it('shows zeros and one quiet line, and does not throw', async () => {
    open()
    // July holds nothing at all.
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(heading()).toBe('July 2026')
    expect(screen.getByText('Nothing was logged.')).toBeTruthy()
    expect(lead()).toBe('₹0')
  })
})
