import { describe, expect, it } from 'vitest'
import { GENERIC, recapBody } from './recap'
import type { Upcoming } from './ahead'
import type { Totals } from './stats'
import type { Entry } from '../types'

const NOW = new Date(2026, 9, 4, 20, 30, 0)

function totals(over: Partial<Totals> = {}): Totals {
  return {
    paise: 0,
    minutes: 0,
    counts: { expense: 0, time: 0, event: 0, note: 0 },
    activeDays: 0,
    byCategory: [],
    ...over,
  }
}

function coming(title: string, at: Date): Upcoming {
  const entry: Entry = {
    id: `up-${title}`,
    kind: 'event',
    occurred_on: '2026-10-05',
    occurred_at: at.toISOString(),
    title,
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-10-01T10:00:00+05:30',
  }
  return { entry, at }
}

describe('the figure line', () => {
  it('reads spend, focus and count back in that order', () => {
    const recap = recapBody(
      totals({ paise: 68_000, minutes: 380, counts: { expense: 3, time: 1, event: 2, note: 2 } }),
      [],
      NOW,
      true,
    )
    expect(recap.title).toBe('₹680 · 6h 20m · 8 logged')
  })

  it('omits spend on a day nothing was spent', () => {
    const recap = recapBody(totals({ minutes: 60, counts: { ...totals().counts, time: 1 } }), [], NOW, true)
    expect(recap.title).toBe('1h · 1 logged')
  })

  it('omits focus on a day nothing was worked', () => {
    const recap = recapBody(
      totals({ paise: 45_000, counts: { ...totals().counts, expense: 1 } }),
      [],
      NOW,
      true,
    )
    expect(recap.title).toBe('₹450 · 1 logged')
  })

  it('keeps a refund-only day, which totals below zero and is still worth reading', () => {
    const recap = recapBody(
      totals({ paise: -20_000, counts: { ...totals().counts, expense: 1 } }),
      [],
      NOW,
      true,
    )
    expect(recap.title).toBe('-₹200 · 1 logged')
  })
})

describe('tomorrow', () => {
  it("names tomorrow's first moment, and only tomorrow's", () => {
    const recap = recapBody(
      totals({ paise: 10_000, counts: { ...totals().counts, expense: 1 } }),
      [
        coming('gym', new Date(2026, 9, 5, 19, 0, 0)),
        coming('standup', new Date(2026, 9, 6, 9, 30, 0)),
      ],
      NOW,
      true,
    )
    expect(recap.body).toBe('Tomorrow: gym · 7:00 pm')
  })

  it('says nothing about tomorrow when nothing is coming then', () => {
    const recap = recapBody(
      totals({ paise: 10_000, counts: { ...totals().counts, expense: 1 } }),
      [coming('standup', new Date(2026, 9, 9, 9, 30, 0))],
      NOW,
      true,
    )
    expect(recap.body).toBe('Anything else to add?')
  })

  it('leads with the figures even so, because a collapsed notification shows the title', () => {
    const recap = recapBody(totals(), [coming('gym', new Date(2026, 9, 5, 19, 0, 0))], NOW, true)
    expect(recap.title).toBe(GENERIC.title)
    expect(recap.body).toBe('Tomorrow: gym · 7:00 pm')
  })
})

describe('the fallbacks', () => {
  it('asks rather than reporting zeroes on an empty day with nothing coming', () => {
    expect(recapBody(totals(), [], NOW, true)).toEqual(GENERIC)
  })

  it('prints no figures and no entry title once figures are off, however full the day', () => {
    const recap = recapBody(
      totals({ paise: 68_000, minutes: 380, counts: { expense: 3, time: 1, event: 2, note: 2 } }),
      [coming('therapy', new Date(2026, 9, 5, 19, 0, 0))],
      NOW,
      false,
    )
    expect(recap).toEqual(GENERIC)
  })
})
