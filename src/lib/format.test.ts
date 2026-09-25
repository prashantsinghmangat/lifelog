import { describe, expect, it } from 'vitest'
import {
  atTime,
  dayEyebrow,
  dayKey,
  dayLabel,
  daySpan,
  minutes,
  paiseFrom,
  relativeDay,
  rupees,
  timeValue,
  until,
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

describe('the day header eyebrow', () => {
  const NOW = new Date(2026, 8, 8, 10, 0, 0) // a Tuesday

  it('names the weekday beside today, yesterday and tomorrow', () => {
    expect(dayEyebrow('2026-09-08', NOW)).toBe('Today · Tuesday')
    expect(dayEyebrow('2026-09-07', NOW)).toBe('Yesterday · Monday')
    expect(dayEyebrow('2026-09-09', NOW)).toBe('Tomorrow · Wednesday')
  })

  it('is the weekday alone once neither word applies — it already says which day', () => {
    expect(dayEyebrow('2026-09-12', NOW)).toBe('Saturday')
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

describe('how long until something today', () => {
  // Monday 14 September 2026, nine in the morning.
  const now = new Date(2026, 8, 14, 9, 0, 0)
  const at = (h: number, m = 0) => new Date(2026, 8, 14, h, m, 0)

  it('counts the minutes, then the hours', () => {
    expect(until(at(9, 47), now)).toBe('in 47m')
    expect(until(at(10, 30), now)).toBe('in 1h 30m')
    expect(until(at(11), now)).toBe('in 2h')
  })

  it('rounds up, so the last minute never reads "in 0m"', () => {
    expect(until(new Date(2026, 8, 14, 9, 0, 30), now)).toBe('in 1m')
  })

  it('has nothing to say once the moment has gone', () => {
    expect(until(at(8, 59), now)).toBeNull()
    expect(until(now, now)).toBeNull()
  })

  it('leaves another day to `relativeDay`, which words it better', () => {
    // "in 19h 20m" is arithmetic nobody asked for; "tomorrow" is the answer.
    expect(until(new Date(2026, 8, 15, 4, 20, 0), now)).toBeNull()
    expect(until(new Date(2026, 8, 13, 23, 59, 0), now)).toBeNull()
  })
})
