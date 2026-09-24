import { describe, expect, it } from 'vitest'
import { parse } from './parser'

// Tuesday, 1 September 2026, 10:00 local — the same clock parser.test.ts uses.
const NOW = new Date(2026, 8, 1, 10, 0, 0)
const p = (s: string) => parse(s, NOW)

describe('release gate: numeric fragments that must never become money', () => {
  it('reads the standalone price, never the fragment welded to a word', () => {
    expect(p('covid-19 test 500')?.amountPaise).toBe(50000)
    expect(p('2kg rice 300')?.amountPaise).toBe(30000)
    expect(p('flight 6E-233 4500')?.amountPaise).toBe(450000)
  })

  it('reads nothing at all where every number is welded to something', () => {
    for (const line of ['9-6 work', 'covid-19', '6E-233', '9-6']) {
      const r = p(line)
      expect(r?.amountPaise).toBeUndefined()
      expect(r?.kind).toBe('note')
      expect(r?.title).toBe(line)
    }
  })

  /**
   * The line this deliberately does not cross.
   *
   * `version 19` is a standalone number after a word, and so is `lunch 350` —
   * nothing in the text tells them apart, and telling them apart would take a
   * vocabulary this parser does not have and is not getting. It reads as ₹19,
   * it read as ₹19 before any of this, and the digits are still visible on the
   * row. Pinned here so that a future change to the amount rule has to decide
   * about it on purpose rather than by accident.
   */
  it('still reads a standalone number after a word as money, as it always has', () => {
    expect(p('version 19')?.amountPaise).toBe(1900)
    expect(p('room 101 booking 2000')?.amountPaise).toBe(10100)
  })
})

describe('release gate: legitimate expenses still read', () => {
  it.each([
    ['350 lunch', 35000],
    ['Lunch, 350.', 35000],
    ['₹350 lunch', 35000],
    ['350', 35000],
    ['350.50 coffee', 35050],
    ['-347.50 refund', -34750],
    ['1,250 groceries', 125000],
    ['350rs lunch', 35000],
  ])('%s -> %i paise', (line, paise) => {
    expect(p(line)?.amountPaise).toBe(paise)
  })
})

describe('release gate: dates and repeats', () => {
  it('reads a leap day with no year as the soonest February that has one', () => {
    const r = p('anniversary 29 feb')
    expect(r?.kind).toBe('event')
    expect(r?.occurredOn).toBe('2028-02-29')
    expect(r?.amountPaise).toBeUndefined()
  })

  it('refuses an impossible date without inventing money', () => {
    for (const line of ['anniversary 31 feb', 'anniversary 29 feb 2026']) {
      const r = p(line)
      expect(r?.kind).toBe('note')
      expect(r?.amountPaise).toBeUndefined()
      expect(r?.title).toBe(line)
    }
  })

  it('keeps every weekday a repeat names', () => {
    const r = p('gym every Tuesday and Thursday 7pm')
    expect(r?.data.rrule).toBe('FREQ=WEEKLY;BYDAY=TU,TH')
  })

  it('does not turn an interval it cannot express into money', () => {
    const r = p('gym every 2 weeks')
    expect(r?.kind).toBe('note')
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.title).toBe('gym every 2 weeks')
  })

  it('reads a bare clock as a time, not an amount', () => {
    const r = p('9 pm')
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.occurredAt).toContain('21:00:00')
  })
})
