import { describe, expect, it } from 'vitest'
import {
  atTime,
  dayKey,
  dayLabel,
  daySpan,
  minutes,
  paiseFrom,
  relativeDay,
  rupees,
  timeValue,
} from './format'

describe('rupees', () => {
  it('shows paise only when there are any', () => {
    expect(rupees(35000)).toBe('₹350')
    expect(rupees(34750)).toBe('₹347.50')
    expect(rupees(5)).toBe('₹0.05')
  })

  it('groups thousands the Indian way', () => {
    expect(rupees(120000000)).toBe('₹12,00,000')
  })

  it('keeps a negative readable', () => {
    expect(rupees(-2500)).toBe('-₹25')
  })
})

describe('paiseFrom', () => {
  it('is the inverse of rupees for the editor', () => {
    expect(paiseFrom('347.5')).toBe(34750)
    expect(paiseFrom('350')).toBe(35000)
    expect(paiseFrom('₹2,499')).toBe(249900)
  })

  it('returns null for nothing usable', () => {
    expect(paiseFrom('')).toBeNull()
    expect(paiseFrom('   ')).toBeNull()
    expect(paiseFrom('abc')).toBeNull()
  })
})

describe('minutes', () => {
  it('reads as a person would say it', () => {
    expect(minutes(45)).toBe('45m')
    expect(minutes(120)).toBe('2h')
    expect(minutes(90)).toBe('1h 30m')
  })
})

describe('timeValue', () => {
  it('gives a native time input what it expects', () => {
    expect(timeValue('2026-09-05T17:05:00+05:30')).toBe('17:05')
  })

  it('pads the hour', () => {
    expect(timeValue('2026-09-05T09:00:00+05:30')).toBe('09:00')
  })
})

describe('atTime', () => {
  it('rebuilds a timestamp from the two edited fields', () => {
    const at = atTime('2026-11-14', '16:30')
    expect(at?.startsWith('2026-11-14T16:30:00')).toBe(true)
  })

  it('keeps an offset, so the moment is unambiguous', () => {
    expect(atTime('2026-11-14', '16:30')).toMatch(/T16:30:00([+-]\d{2}:\d{2}|Z)$/)
  })

  it('handles midnight rather than treating it as empty', () => {
    expect(atTime('2026-11-14', '00:00')?.startsWith('2026-11-14T00:00:00')).toBe(true)
  })

  it('returns null for an unusable time', () => {
    expect(atTime('2026-11-14', '')).toBeNull()
    expect(atTime('2026-11-14', 'nonsense')).toBeNull()
  })

  it('round-trips through timeValue', () => {
    const at = atTime('2026-09-05', '08:15')
    expect(at).not.toBeNull()
    expect(timeValue(at ?? '')).toBe('08:15')
  })
})

describe('dayKey', () => {
  it('uses the local date, not UTC', () => {
    // Late evening in IST is already the next day in UTC; the local date wins.
    expect(dayKey(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05')
  })
})

describe('naming a day', () => {
  const NOW = new Date(2026, 8, 8, 10, 0, 0)

  it('says Today for today, and a weekday and date otherwise', () => {
    expect(dayLabel('2026-09-08', NOW)).toBe('Today')
    expect(dayLabel('2026-09-12', NOW)).toBe('Sat, 12 Sep')
  })

  it('names the year when it is not this one', () => {
    // Browsing back a year, the header read "Fri, 12 Sep" and nothing on screen
    // said which September it was.
    expect(dayLabel('2025-09-12', NOW)).toBe('Fri, 12 Sep 2025')
  })

  it('keeps the near days as words', () => {
    expect(relativeDay('2026-09-08', NOW)).toBe('today')
    expect(relativeDay('2026-09-07', NOW)).toBe('yesterday')
    expect(relativeDay('2026-09-09', NOW)).toBe('tomorrow')
    expect(relativeDay('2026-09-12', NOW)).toBe('12 Sep')
  })

  it('names the year in "saving to X", the only warning of a distant backfill', () => {
    // Without it, `12 sep 2025` previewed as "saving to 12 Sep" — the same
    // thing a date in this September shows, and wrong by twelve months.
    expect(relativeDay('2025-09-12', NOW)).toBe('12 Sep 2025')
  })
})

describe('the span an answer covers', () => {
  const NOW = new Date(2026, 8, 8, 10, 0, 0)

  it('prints the month once when both ends share it', () => {
    // "1 Sep — 7 Sep" spends half the line repeating itself.
    expect(daySpan('2026-09-01', '2026-09-07', NOW)).toBe('1 — 7 Sep')
  })

  it('prints both months when they differ', () => {
    expect(daySpan('2026-08-28', '2026-09-03', NOW)).toBe('28 Aug — 3 Sep')
  })

  it('names the years when either falls outside this one', () => {
    expect(daySpan('2025-12-30', '2026-01-02', NOW)).toBe('30 Dec 2025 — 2 Jan 2026')
  })
})
