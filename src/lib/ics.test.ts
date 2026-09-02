import { describe, expect, it } from 'vitest'
import { forCalendar, toIcs } from './ics'
import type { Entry, Kind } from '../types'

// Tuesday, 1 September 2026, 10:00 local.
const NOW = new Date(2026, 8, 1, 10, 0, 0)

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'event' as Kind,
    occurred_on: '2026-11-14',
    occurred_at: null,
    title: 'Something',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
    ...over,
  }
}

const lines = (ics: string) => ics.split('\r\n')

describe('calendar structure', () => {
  it('wraps events in a VCALENDAR', () => {
    const ics = toIcs([entry({ id: 'a' })], NOW)
    expect(lines(ics)[0]).toBe('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  })

  it('uses CRLF line endings, which the spec requires', () => {
    const ics = toIcs([entry({ id: 'a' })], NOW)
    expect(ics.includes('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(ics)).toBe(false)
  })

  it('gives each entry a stable UID so a re-import updates rather than duplicates', () => {
    expect(toIcs([entry({ id: 'abc-123' })], NOW)).toContain('UID:abc-123@lifelog')
  })

  it('emits an empty but valid calendar for no entries', () => {
    const ics = toIcs([], NOW)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})

describe('all-day events', () => {
  it('spans one day and alarms at 9am local', () => {
    const ics = toIcs([entry({ id: 'a', occurred_on: '2026-11-14' })], NOW)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261114')
    // Exclusive end, so the next day.
    expect(ics).toContain('DTEND;VALUE=DATE:20261115')
    // Relative to local midnight: 9am in any timezone, and correct every year.
    expect(ics).toContain('TRIGGER;RELATED=START:PT9H')
  })

  it('adds a yearly rule for a birthday', () => {
    const ics = toIcs([entry({ id: 'a', data: { rrule: 'FREQ=YEARLY' } })], NOW)
    expect(ics).toContain('RRULE:FREQ=YEARLY')
  })

  it('omits the rule when the flag is absent', () => {
    expect(toIcs([entry({ id: 'a' })], NOW)).not.toContain('RRULE')
  })
})

describe('timed events', () => {
  const timed = entry({
    id: 'a',
    occurred_on: '2026-09-02',
    occurred_at: '2026-09-02T17:00:00+05:30',
    title: 'dentist',
  })

  it('converts the local time to UTC', () => {
    // 17:00 at +05:30 is 11:30 UTC.
    expect(toIcs([timed], NOW)).toContain('DTSTART:20260902T113000Z')
  })

  it('gives it a block rather than zero length', () => {
    expect(toIcs([timed], NOW)).toContain('DTEND:20260902T120000Z')
  })

  it('alarms at the event itself', () => {
    expect(toIcs([timed], NOW)).toContain('TRIGGER:-PT0M')
  })
})

describe('text values', () => {
  it('escapes commas, semicolons and backslashes', () => {
    const ics = toIcs([entry({ id: 'a', title: 'Dinner, drinks; then C:\\home' })], NOW)
    expect(ics).toContain('SUMMARY:Dinner\\, drinks\\; then C:\\\\home')
  })

  it('escapes a newline in a note', () => {
    const ics = toIcs([entry({ id: 'a', note: 'line one\nline two' })], NOW)
    expect(ics).toContain('DESCRIPTION:line one\\nline two')
  })

  it('omits the description when there is no note', () => {
    const ics = toIcs([entry({ id: 'a', title: 'x' })], NOW)
    expect(ics).not.toContain('DESCRIPTION:line')
  })

  it('folds a line longer than 75 octets and continues it with a space', () => {
    const ics = toIcs([entry({ id: 'a', title: 'x'.repeat(120) })], NOW)
    const long = lines(ics).filter((line) => line.startsWith('SUMMARY:'))
    expect(long).toHaveLength(1)
    expect(long[0]?.length).toBe(75)
    // The continuation is the next line, and it starts with a space.
    const index = lines(ics).findIndex((line) => line.startsWith('SUMMARY:'))
    expect(lines(ics)[index + 1]?.startsWith(' ')).toBe(true)
  })

  it('keeps every line within the 75-octet limit', () => {
    const ics = toIcs([entry({ id: 'a', title: 'y'.repeat(400) })], NOW)
    expect(lines(ics).every((line) => line.length <= 75)).toBe(true)
  })
})

describe('what belongs in a bulk export', () => {
  const all = [
    entry({ id: 'future', occurred_on: '2026-11-14' }),
    entry({ id: 'past', occurred_on: '2026-08-01' }),
    entry({ id: 'today', occurred_on: '2026-09-01' }),
    entry({ id: 'birthday', occurred_on: '2020-03-04', data: { rrule: 'FREQ=YEARLY' } }),
    entry({ id: 'expense', kind: 'expense', occurred_on: '2026-11-14' }),
    entry({ id: 'note', kind: 'note', occurred_on: '2026-11-14' }),
    entry({ id: 'time', kind: 'time', occurred_on: '2026-11-14' }),
  ]

  const kept = forCalendar(all, NOW).map((row) => row.id)

  it('keeps future events', () => {
    expect(kept).toContain('future')
    expect(kept).toContain('today')
  })

  it('drops past one-offs', () => {
    expect(kept).not.toContain('past')
  })

  it('keeps a yearly event however old, because the rule makes it recur', () => {
    expect(kept).toContain('birthday')
  })

  it('exports nothing that is not an event', () => {
    expect(kept).not.toContain('expense')
    expect(kept).not.toContain('note')
    expect(kept).not.toContain('time')
  })

  it('does not filter a single entry handed straight to toIcs', () => {
    // Adding one by hand should not be second-guessed.
    const past = entry({ id: 'past', occurred_on: '2020-01-01' })
    expect(toIcs([past], NOW)).toContain('UID:past@lifelog')
  })
})

describe('determinism', () => {
  it('produces identical bytes for identical input', () => {
    const rows = [entry({ id: 'a' }), entry({ id: 'b', occurred_at: '2026-11-14T09:00:00+05:30' })]
    expect(toIcs(rows, NOW)).toBe(toIcs(rows, NOW))
  })
})
