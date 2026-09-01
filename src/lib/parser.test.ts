import { describe, expect, it } from 'vitest'
import { parse } from './parser'

// Tuesday, 1 September 2026, 10:00 local.
const NOW = new Date(2026, 8, 1, 10, 0, 0)

const TODAY = '2026-09-01'
const YESTERDAY = '2026-08-31'
const TOMORROW = '2026-09-02'
const TWO_DAYS_AGO = '2026-08-30'
const LAST_SATURDAY = '2026-08-29'
const LAST_FRIDAY = '2026-08-28'
const NEXT_FRIDAY = '2026-09-04'
const NOV_14 = '2026-11-14'

const p = (input: string) => parse(input, NOW)

describe('empty input', () => {
  it('returns null for an empty string', () => {
    expect(p('')).toBeNull()
  })

  it('returns null for whitespace only', () => {
    expect(p('   ')).toBeNull()
  })
})

describe('expenses', () => {
  it('parses "350 lunch swiggy"', () => {
    const r = p('350 lunch swiggy')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(35000)
    expect(r?.title).toBe('lunch swiggy')
    expect(r?.category).toBe('food')
    expect(r?.occurredOn).toBe(TODAY)
    expect(r?.occurredAt).toBeUndefined()
  })

  it('parses a rupee sign and thousands separator', () => {
    const r = p('₹2,499 shoes')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(249900)
    expect(r?.title).toBe('shoes')
    expect(r?.category).toBe('shopping')
  })

  it('parses "rs 20 chai"', () => {
    const r = p('rs 20 chai')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(2000)
    expect(r?.title).toBe('chai')
    expect(r?.category).toBe('food')
  })

  it('parses "Rs.350 dinner"', () => {
    const r = p('Rs.350 dinner')
    expect(r?.amountPaise).toBe(35000)
    expect(r?.title).toBe('dinner')
    expect(r?.category).toBe('food')
  })

  it('strips the filler words "spent" and "on"', () => {
    const r = p('spent 350 on lunch')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(35000)
    expect(r?.title).toBe('lunch')
    expect(r?.category).toBe('food')
  })

  it('parses "paid rent 18000"', () => {
    const r = p('paid rent 18000')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(1800000)
    expect(r?.title).toBe('rent')
    expect(r?.category).toBe('bills')
  })

  it('parses "bought shoes 2499"', () => {
    const r = p('bought shoes 2499')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(249900)
    expect(r?.title).toBe('shoes')
    expect(r?.category).toBe('shopping')
  })

  it('keeps paise as an integer for decimal input', () => {
    const r = p('350.50 groceries')
    expect(r?.amountPaise).toBe(35050)
    expect(Number.isInteger(r?.amountPaise)).toBe(true)
  })

  it('matches categories case-insensitively', () => {
    const r = p('350 Lunch at Swiggy')
    expect(r?.category).toBe('food')
    expect(r?.title).toBe('Lunch Swiggy')
  })

  it('falls back to a default title', () => {
    const r = p('500')
    expect(r?.kind).toBe('expense')
    expect(r?.title).toBe('Expense')
    expect(r?.category).toBeUndefined()
  })
})

describe('time logs', () => {
  it('parses "2h client work"', () => {
    const r = p('2h client work')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(120)
    expect(r?.title).toBe('client work')
    expect(r?.amountPaise).toBeUndefined()
  })

  it('parses "1h30m acme redesign"', () => {
    const r = p('1h30m acme redesign')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(90)
    expect(r?.title).toBe('acme redesign')
  })

  it('parses "45 min gym" without a category', () => {
    const r = p('45 min gym')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(45)
    expect(r?.title).toBe('gym')
    expect(r?.category).toBeUndefined()
  })

  it('parses fractional hours', () => {
    const r = p('2.5h writing')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(150)
    expect(r?.title).toBe('writing')
  })

  it('parses "worked 3h on dtx"', () => {
    const r = p('worked 3h on dtx')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(180)
    expect(r?.title).toBe('dtx')
  })

  it('parses "2 hrs reading"', () => {
    const r = p('2 hrs reading')
    expect(r?.durationMinutes).toBe(120)
    expect(r?.title).toBe('reading')
  })

  it('parses "90m standup notes"', () => {
    const r = p('90m standup notes')
    expect(r?.durationMinutes).toBe(90)
    expect(r?.title).toBe('standup notes')
  })

  it('reads duration before amount', () => {
    const r = p('2h 500 client work')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(120)
  })
})

describe('events', () => {
  it('infers an event from a future date and keeps the clock time', () => {
    const r = p('dentist tomorrow 5pm')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('dentist')
    expect(r?.occurredOn).toBe(TOMORROW)
    expect(r?.occurredAt?.startsWith('2026-09-02T17:00:00')).toBe(true)
    expect(r?.category).toBeUndefined()
  })

  it('parses "9am gym tomorrow"', () => {
    const r = p('9am gym tomorrow')
    expect(r?.kind).toBe('event')
    expect(r?.occurredOn).toBe(TOMORROW)
    expect(r?.occurredAt?.startsWith('2026-09-02T09:00:00')).toBe(true)
    expect(r?.title).toBe('gym')
  })

  it('parses "Riya birthday 14 nov" with a yearly rrule', () => {
    const r = p('Riya birthday 14 nov')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('Riya birthday')
    expect(r?.occurredOn).toBe(NOV_14)
    expect(r?.data.rrule).toBe('FREQ=YEARLY')
  })

  it('parses "nov 14" in either order', () => {
    const r = p('nov 14 Riya birthday')
    expect(r?.occurredOn).toBe(NOV_14)
  })

  it('treats a leading + as an event override', () => {
    const r = p('+ standup')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('standup')
    expect(r?.occurredOn).toBe(TODAY)
    expect(r?.data.rrule).toBeUndefined()
  })

  it('parses "+ Riya bday 14 nov"', () => {
    const r = p('+ Riya bday 14 nov')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('Riya bday')
    expect(r?.occurredOn).toBe(NOV_14)
    expect(r?.data.rrule).toBe('FREQ=YEARLY')
  })

  it('flags anniversaries as yearly', () => {
    const r = p('anniversary 20 dec')
    expect(r?.kind).toBe('event')
    expect(r?.data.rrule).toBe('FREQ=YEARLY')
    expect(r?.occurredOn).toBe('2026-12-20')
  })

  it('falls back to a default event title', () => {
    const r = p('+')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('Event')
  })
})

describe('dates', () => {
  it('parses a trailing "yesterday"', () => {
    const r = p('320 lunch yesterday')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(32000)
    expect(r?.title).toBe('lunch')
    expect(r?.occurredOn).toBe(YESTERDAY)
  })

  it('parses a leading "yesterday"', () => {
    const r = p('yesterday 500 groceries')
    expect(r?.amountPaise).toBe(50000)
    expect(r?.title).toBe('groceries')
    expect(r?.category).toBe('food')
    expect(r?.occurredOn).toBe(YESTERDAY)
  })

  it('parses "N days ago"', () => {
    const r = p('180 auto 2 days ago')
    expect(r?.amountPaise).toBe(18000)
    expect(r?.title).toBe('auto')
    expect(r?.category).toBe('transport')
    expect(r?.occurredOn).toBe(TWO_DAYS_AGO)
  })

  it('parses the "Nd ago" shorthand', () => {
    const r = p('3d ago 200 chai')
    expect(r?.occurredOn).toBe(LAST_SATURDAY)
    expect(r?.amountPaise).toBe(20000)
  })

  it('parses "today"', () => {
    const r = p('today 100 chai')
    expect(r?.occurredOn).toBe(TODAY)
    expect(r?.title).toBe('chai')
  })

  it('resolves a bare weekday backwards', () => {
    const r = p('400 dinner sat')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(40000)
    expect(r?.title).toBe('dinner')
    expect(r?.occurredOn).toBe(LAST_SATURDAY)
  })

  it('resolves a full weekday name backwards', () => {
    const r = p('meeting friday')
    expect(r?.occurredOn).toBe(LAST_FRIDAY)
    expect(r?.title).toBe('meeting')
  })

  it('resolves "next <weekday>" forwards', () => {
    const r = p('team lunch next friday')
    expect(r?.kind).toBe('event')
    expect(r?.occurredOn).toBe(NEXT_FRIDAY)
    expect(r?.title).toBe('team lunch')
  })

  it('does not read a slash date as an amount', () => {
    const r = p('14/11 dentist')
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.occurredOn).toBe(NOV_14)
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('dentist')
  })

  it('parses a two-digit year', () => {
    const r = p('250 books 14/11/26')
    expect(r?.occurredOn).toBe(NOV_14)
    expect(r?.amountPaise).toBe(25000)
  })

  it('keeps a future date on an explicit expense', () => {
    const r = p('500 dinner next friday')
    expect(r?.kind).toBe('expense')
    expect(r?.occurredOn).toBe(NEXT_FRIDAY)
  })
})

describe('notes', () => {
  it('keeps the untouched input as the title', () => {
    const r = p('met rahul about the dtx')
    expect(r?.kind).toBe('note')
    expect(r?.title).toBe('met rahul about the dtx')
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.durationMinutes).toBeUndefined()
    expect(r?.occurredOn).toBe(TODAY)
  })

  it('parses "call mum"', () => {
    const r = p('call mum')
    expect(r?.kind).toBe('note')
    expect(r?.title).toBe('call mum')
  })

  it('is a note when only a past date matched', () => {
    const r = p('shipped the build yesterday')
    expect(r?.kind).toBe('note')
    expect(r?.occurredOn).toBe(YESTERDAY)
    expect(r?.title).toBe('shipped the build')
  })
})

describe('edge cases', () => {
  it('leaves a trailing number in the title of a time log', () => {
    const r = p('2h call with agency 99')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(120)
    expect(r?.title).toBe('call with agency 99')
    expect(r?.amountPaise).toBeUndefined()
  })

  it('still reads a currency-marked amount on a time log', () => {
    const r = p('2h consulting ₹500')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(120)
    expect(r?.amountPaise).toBe(50000)
    expect(r?.title).toBe('consulting')
  })

  it('parses a 24-hour clock time', () => {
    const r = p('+ standup 17:30')
    expect(r?.kind).toBe('event')
    expect(r?.occurredAt?.startsWith('2026-09-01T17:30:00')).toBe(true)
    expect(r?.title).toBe('standup')
  })

  it('parses "5:30pm"', () => {
    const r = p('+ dentist 5:30pm')
    expect(r?.occurredAt?.startsWith('2026-09-01T17:30:00')).toBe(true)
  })

  it('does not treat a word starting with a duration unit as a duration', () => {
    const r = p('3 mangoes 120')
    expect(r?.durationMinutes).toBeUndefined()
    expect(r?.kind).toBe('expense')
  })

  it('always returns a data object', () => {
    const r = p('350 lunch swiggy')
    expect(r?.data).toEqual({})
  })

  it('is deterministic for a given now', () => {
    const a = parse('350 lunch', NOW)
    const b = parse('350 lunch', NOW)
    expect(a).toEqual(b)
  })
})
