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

/**
 * Spec 039 — the corpus. Lines users naturally type, organised by what they
 * are, each pinned to its honest reading today. The principle every block
 * enforces: the parser may decline to parse, but may never silently invent an
 * amount, a date, a clock time or a repeat.
 */
describe('corpus: expenses', () => {
  it.each([
    ['350 lunch', 35000, 'lunch'],
    ['swiggy 450', 45000, 'swiggy'],
    ['₹850 dinner', 85000, 'dinner'],
    ['bought headphones 2400', 240000, 'headphones'],
    ['paid electricity 1800', 180000, 'electricity'],
    ['150 chai', 15000, 'chai'],
  ])('%s -> %i paise', (line, paise, title) => {
    const r = p(line)
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(paise)
    expect(r?.title).toBe(title)
  })
})

describe('corpus: work', () => {
  it.each([
    ['2h client work', 120, 'client work'],
    ['worked 3 hours on project', 180, 'project'],
    ['1.5h meeting', 90, 'meeting'],
    ['worked on PwC for 2 hours', 120, 'PwC'],
  ])('%s -> %i minutes', (line, mins, title) => {
    const r = p(line)
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(mins)
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.title).toBe(title)
  })
})

describe('corpus: events and people', () => {
  it('keeps a dateless meeting as a note on today', () => {
    const r = p('met Rahul')
    expect(r?.kind).toBe('note')
    expect(r?.occurredOn).toBe('2026-09-01')
    expect(r?.title).toBe('met Rahul')
  })

  it('files tomorrow as an event, with the clock time when given', () => {
    expect(p('meeting with Amit tomorrow')).toMatchObject({ kind: 'event', occurredOn: '2026-09-02' })
    const dentist = p('dentist tomorrow 10am')
    expect(dentist?.kind).toBe('event')
    expect(dentist?.occurredAt).toContain('10:00:00')
  })

  /**
   * A bare weekday means the day just past — `next` is the forward word.
   * Logging after the fact is this app's common case, so `call mom friday`
   * typed on a Tuesday lands on last Friday as a note rather than becoming a
   * reminder. Pinned so a change to that bias is made on purpose.
   */
  it('reads a bare weekday as the most recent one, filing a past note', () => {
    const r = p('call mom friday')
    expect(r?.kind).toBe('note')
    expect(r?.occurredOn).toBe('2026-08-28')
    expect(r?.title).toBe('call mom')
  })
})

describe('corpus: repeats', () => {
  it('keeps every named day and the clock time, starting today while it is still ahead', () => {
    const r = p('gym every tuesday and thursday 7pm')
    expect(r?.data.rrule).toBe('FREQ=WEEKLY;BYDAY=TU,TH')
    expect(r?.occurredOn).toBe('2026-09-01')
    expect(r?.occurredAt).toContain('19:00:00')
  })

  it('reads a monthly bill as one repeating row', () => {
    const r = p('electricity bill every month')
    expect(r?.kind).toBe('event')
    expect(r?.data.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=1')
    expect(r?.title).toBe('electricity bill')
    expect(r?.amountPaise).toBeUndefined()
  })

  // An untimed occurrence today is not still ahead, so the row starts at the
  // next listed day instead — NOW is a Tuesday and `every tuesday` lands a
  // week out, while `every weekday` lands tomorrow.
  it('starts an untimed repeat on its next occurrence', () => {
    expect(p('gym every tuesday')).toMatchObject({
      occurredOn: '2026-09-08',
      data: { rrule: 'FREQ=WEEKLY;BYDAY=TU' },
    })
    expect(p('gym every weekday')).toMatchObject({
      occurredOn: '2026-09-02',
      data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    })
  })
})

describe('corpus: date words resolve against now, exactly', () => {
  // NOW is Tuesday 1 September 2026; a resolved past day files as a note.
  it.each([
    ['dinner yesterday', '2026-08-31', 'note', 'dinner'],
    ['review tomorrow', '2026-09-02', 'event', 'review'],
    ['haircut last monday', '2026-08-31', 'note', 'haircut'],
    ['trip next friday', '2026-09-04', 'event', 'trip'],
    ['flight aug 20', '2026-08-20', 'note', 'flight'],
  ])('%s -> %s', (line, on, kind, title) => {
    const r = p(line)
    expect(r?.occurredOn).toBe(on)
    expect(r?.kind).toBe(kind)
    expect(r?.title).toBe(title)
    expect(r?.amountPaise).toBeUndefined()
  })

  it('keeps the clock time on a past date', () => {
    expect(p('flight aug 20 at 7pm')?.occurredAt).toContain('19:00:00')
  })
})

describe('corpus: ambiguity degrades honestly, never to invented structure', () => {
  // `tonight`, `morning` and `sometime` are not grammar: the day is read where
  // one is named, and no clock hour is invented for the vague word.
  it('reads the day and refuses to invent an hour for a vague time of day', () => {
    const tonight = p('party tonight')
    expect(tonight?.occurredOn).toBe('2026-09-01')
    expect(tonight?.occurredAt).toBeUndefined()
    const standup = p('standup tomorrow morning')
    expect(standup?.occurredOn).toBe('2026-09-02')
    expect(standup?.occurredAt).toBeUndefined()
    const sometime = p('meeting sometime tomorrow')
    expect(sometime?.occurredOn).toBe('2026-09-02')
    expect(sometime?.occurredAt).toBeUndefined()
  })

  // The repeat grammar knows weekly and yearly; a monthly bill is honestly a
  // whole note until monthly earns its place (ROADMAP, "Held behind the
  // freeze") — and a plain phrase stays a plain note.
  it.each([['pay electricity next month'], ['evening walk']])('%s stays a whole note', (line) => {
    const r = p(line)
    expect(r?.kind).toBe('note')
    expect(r?.title).toBe(line)
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.data.rrule).toBeUndefined()
  })
})
