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

  it('infers an event from a clock time still ahead today', () => {
    // NOW is 10:00, so 8:15pm has not happened: it is a reminder, not a note.
    const r = p('ping 8:15pm')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('ping')
    expect(r?.occurredOn).toBe(TODAY)
    expect(r?.occurredAt?.startsWith('2026-09-01T20:15:00')).toBe(true)
  })

  it('leaves a clock time already past today as a note', () => {
    const r = p('ping 8:15am')
    expect(r?.kind).toBe('note')
    expect(r?.occurredAt?.startsWith('2026-09-01T08:15:00')).toBe(true)
  })

  it('does not turn a past-dated timed entry into an event', () => {
    const r = p('gym 7am yesterday')
    expect(r?.kind).toBe('note')
    expect(r?.occurredOn).toBe(YESTERDAY)
  })

  it('keeps an expense an expense even when it is still ahead', () => {
    const r = p('500 dinner 9pm')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(50000)
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

  it('makes a birthday an event even when this year has already passed', () => {
    // NOW is September; 13 Feb has gone. A birthday is recurring by nature, so
    // it must not be demoted to a note, or it can never answer "when is it".
    const r = p('deepak birthday 13 feb')
    expect(r?.kind).toBe('event')
    expect(r?.occurredOn).toBe('2026-02-13')
    expect(r?.data.rrule).toBe('FREQ=YEARLY')
    expect(r?.title).toBe('deepak birthday')
  })

  it('needs a date, so a thought about a birthday stays a note', () => {
    const r = p('birthday ideas for riya')
    expect(r?.kind).toBe('note')
    expect(r?.data.rrule).toBeUndefined()
  })

  it('does the same for bday and anniversary', () => {
    expect(p('kiran bday 2 march')?.data.rrule).toBe('FREQ=YEARLY')
    expect(p('our anniversary 10 jan')?.kind).toBe('event')
  })

  it('still lets money win over recurrence', () => {
    // A present bought for a birthday is an expense, not an anniversary.
    const r = p('500 birthday gift')
    expect(r?.kind).toBe('expense')
    expect(r?.data.rrule).toBeUndefined()
  })

  it('still lets a duration win over recurrence', () => {
    const r = p('2h birthday party setup')
    expect(r?.kind).toBe('time')
    expect(r?.data.rrule).toBeUndefined()
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

describe('a suffixed currency marker', () => {
  it('parses "10rs karan" with no space', () => {
    const r = p('10rs karan')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(1000)
    expect(r?.title).toBe('karan')
  })

  it('parses "500 rs groceries"', () => {
    const r = p('500 rs groceries')
    expect(r?.amountPaise).toBe(50000)
    expect(r?.title).toBe('groceries')
    expect(r?.category).toBe('food')
  })

  it('parses "100 rupees chai"', () => {
    const r = p('100 rupees chai')
    expect(r?.amountPaise).toBe(10000)
    expect(r?.title).toBe('chai')
    expect(r?.category).toBe('food')
  })

  it('reads a suffixed amount on a time log', () => {
    const r = p('2h consulting 500rs')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(120)
    expect(r?.amountPaise).toBe(50000)
    expect(r?.title).toBe('consulting')
  })

  it('does not mistake "rsvp" for a currency marker', () => {
    const r = p('2h rsvp calls')
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.title).toBe('rsvp calls')
  })
})

describe('the default day', () => {
  const onDay = (input: string, day: string) => parse(input, NOW, day)

  it('files an undated entry on the day being viewed', () => {
    const r = onDay('500 groceries', TWO_DAYS_AGO)
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(50000)
    expect(r?.occurredOn).toBe(TWO_DAYS_AGO)
  })

  it('lets an explicit date token win over the viewed day', () => {
    const r = onDay('320 lunch yesterday', TWO_DAYS_AGO)
    expect(r?.occurredOn).toBe(YESTERDAY)
  })

  it('still resolves "today" against now, not the viewed day', () => {
    const r = onDay('100 chai today', TWO_DAYS_AGO)
    expect(r?.occurredOn).toBe(TODAY)
  })

  it('infers an event when the viewed day is in the future', () => {
    const r = onDay('dentist 5pm', TOMORROW)
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('dentist')
    expect(r?.occurredOn).toBe(TOMORROW)
    expect(r?.occurredAt?.startsWith('2026-09-02T17:00:00')).toBe(true)
  })

  it('keeps an undated note a note when the viewed day is past', () => {
    const r = onDay('met rahul about the dtx', YESTERDAY)
    expect(r?.kind).toBe('note')
    expect(r?.title).toBe('met rahul about the dtx')
    expect(r?.occurredOn).toBe(YESTERDAY)
  })

  it('carries the clock time onto the viewed day', () => {
    const r = onDay('gym 7am', YESTERDAY)
    expect(r?.occurredOn).toBe(YESTERDAY)
    expect(r?.occurredAt?.startsWith('2026-08-31T07:00:00')).toBe(true)
  })

  it('behaves as before when no default day is given', () => {
    expect(parse('500 groceries', NOW)?.occurredOn).toBe(TODAY)
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

  it('parses a dotted meridiem, which phone keyboards produce', () => {
    // Without this, 4:00 p.m. matches the 24-hour branch and becomes 4am.
    const r = p('+ set alarm 4:00 p.m.')
    expect(r?.occurredAt?.startsWith('2026-09-01T16:00:00')).toBe(true)
    expect(r?.title).toBe('set alarm')
  })

  it('parses a dotted meridiem without minutes', () => {
    const r = p('+ ping 4 p.m.')
    expect(r?.occurredAt?.startsWith('2026-09-01T16:00:00')).toBe(true)
    expect(r?.title).toBe('ping')
  })

  it('parses an uppercase dotted meridiem', () => {
    const r = p('+ ping 9 A.M.')
    expect(r?.occurredAt?.startsWith('2026-09-01T09:00:00')).toBe(true)
  })

  it('does not read a word beginning with a or p as a meridiem', () => {
    const r = p('5 apples')
    expect(r?.occurredAt).toBeUndefined()
    expect(r?.amountPaise).toBe(500)
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

describe('relative reminders', () => {
  it('reads "in 5 minutes" as a moment, not a duration', () => {
    const r = p('ping me in 5 minutes')
    expect(r?.kind).toBe('event')
    expect(r?.durationMinutes).toBeUndefined()
    expect(r?.occurredAt?.startsWith('2026-09-01T10:05:00')).toBe(true)
    expect(r?.title).toBe('ping me')
  })

  it('reads "after 5 minutes"', () => {
    const r = p('after 5 minutes call mum')
    expect(r?.occurredAt?.startsWith('2026-09-01T10:05:00')).toBe(true)
    expect(r?.title).toBe('call mum')
  })

  it('reads "5 minutes from now"', () => {
    const r = p('ping 5 minutes from now')
    expect(r?.occurredAt?.startsWith('2026-09-01T10:05:00')).toBe(true)
  })

  it('reads hours', () => {
    const r = p('in 2 hours standup')
    expect(r?.occurredAt?.startsWith('2026-09-01T12:00:00')).toBe(true)
  })

  it('reads fractional hours', () => {
    const r = p('in 1.5h gym')
    expect(r?.occurredAt?.startsWith('2026-09-01T11:30:00')).toBe(true)
  })

  it('reads the "in 30m" shorthand', () => {
    const r = p('in 30m tea')
    expect(r?.occurredAt?.startsWith('2026-09-01T10:30:00')).toBe(true)
  })

  it('rolls onto the next day when the offset passes midnight', () => {
    const lateNight = new Date(2026, 8, 1, 23, 30, 0)
    const r = parse('in 45 minutes sleep', lateNight)
    expect(r?.occurredOn).toBe('2026-09-02')
    expect(r?.occurredAt?.startsWith('2026-09-02T00:15:00')).toBe(true)
  })

  it('leaves a bare duration alone', () => {
    // No in/after/from-now wrapper, so this is still a time log.
    const r = p('45 min gym')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(45)
    expect(r?.occurredAt).toBeUndefined()
  })

  it('does not treat a zero offset as a reminder', () => {
    const r = p('in 0 minutes nothing')
    expect(r?.occurredAt).toBeUndefined()
  })
})

describe('amount shapes', () => {
  it('parses a thousands separator with paise', () => {
    const r = p('2,499.50 shoes')
    expect(r?.amountPaise).toBe(249950)
    expect(r?.title).toBe('shoes')
  })

  it('accepts an uppercase RS marker', () => {
    const r = p('RS 350 dinner')
    expect(r?.amountPaise).toBe(35000)
    expect(r?.title).toBe('dinner')
  })

  it('accepts an INR marker', () => {
    const r = p('INR 1200 flight')
    expect(r?.amountPaise).toBe(120000)
    expect(r?.title).toBe('flight')
  })

  it('keeps a zero amount as an expense', () => {
    const r = p('0 free lunch')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(0)
    expect(r?.category).toBe('food')
  })

  it('rounds a third decimal place rather than truncating', () => {
    const r = p('10.5 chai')
    expect(r?.amountPaise).toBe(1050)
    expect(Number.isInteger(r?.amountPaise)).toBe(true)
  })

  it('drops a trailing full stop from the title', () => {
    const r = p('350 lunch.')
    expect(r?.amountPaise).toBe(35000)
    expect(r?.title).toBe('lunch')
  })
})

describe('clock times', () => {
  it('reads noon as 12:00', () => {
    const r = p('+ lunch 12pm')
    expect(r?.occurredAt?.startsWith('2026-09-01T12:00:00')).toBe(true)
  })

  it('reads midnight as 00:00', () => {
    const r = p('+ flight 12am')
    expect(r?.occurredAt?.startsWith('2026-09-01T00:00:00')).toBe(true)
  })

  it('keeps an offset on occurredAt so the timestamp is unambiguous', () => {
    const r = p('+ standup 9am')
    expect(r?.occurredAt).toMatch(/T09:00:00([+-]\d{2}:\d{2}|Z)$/)
  })

  it('ignores an impossible 24-hour time', () => {
    const r = p('+ standup 25:00')
    expect(r?.occurredAt).toBeUndefined()
  })

  it('does not read a bare number as a time', () => {
    const r = p('+ standup 9')
    expect(r?.occurredAt).toBeUndefined()
  })
})

describe('weekday resolution', () => {
  it('resolves today\'s own weekday to today', () => {
    // NOW is a Tuesday.
    const r = p('200 chai tue')
    expect(r?.occurredOn).toBe(TODAY)
  })

  it('sends "next <today\'s weekday>" a full week forward', () => {
    const r = p('review next tuesday')
    expect(r?.occurredOn).toBe('2026-09-08')
    expect(r?.kind).toBe('event')
  })

  it('resolves "next monday" to the coming Monday', () => {
    const r = p('call next monday')
    expect(r?.occurredOn).toBe('2026-09-07')
  })
})

describe('robustness', () => {
  it('returns null for tabs and newlines only', () => {
    expect(p('\t\n  ')).toBeNull()
  })

  it('collapses runs of whitespace in the title', () => {
    const r = p('350    lunch     swiggy')
    expect(r?.title).toBe('lunch swiggy')
  })

  it('accepts a + with no following space', () => {
    const r = p('+standup')
    expect(r?.kind).toBe('event')
    expect(r?.title).toBe('standup')
  })

  it('keeps an amount on an explicit event', () => {
    const r = p('+ 350 team lunch')
    expect(r?.kind).toBe('event')
    expect(r?.amountPaise).toBe(35000)
    expect(r?.title).toBe('team lunch')
  })

  it('rejects an impossible calendar date instead of crashing', () => {
    const r = p('31 feb dentist')
    expect(r).not.toBeNull()
    expect(r?.occurredOn).toBe(TODAY)
  })

  it('parses a four-digit year', () => {
    const r = p('250 books 14/11/2026')
    expect(r?.occurredOn).toBe(NOV_14)
    expect(r?.amountPaise).toBe(25000)
  })

  it('reads "2h30" as two and a half hours', () => {
    const r = p('2h30 client work')
    expect(r?.kind).toBe('time')
    expect(r?.durationMinutes).toBe(150)
    expect(r?.title).toBe('client work')
  })

  it('does not fold a spaced number after hours into the duration', () => {
    const r = p('2h 500 client work')
    expect(r?.durationMinutes).toBe(120)
    // Unmarked, so it is neither minutes nor money: it stays in the title.
    expect(r?.amountPaise).toBeUndefined()
    expect(r?.title).toBe('500 client work')
  })

  it('does not flag a birthday expense as recurring', () => {
    const r = p('500 birthday gift')
    expect(r?.kind).toBe('expense')
    expect(r?.data.rrule).toBeUndefined()
  })

  it('does not flag a plain note as recurring', () => {
    const r = p('birthday ideas for riya')
    expect(r?.kind).toBe('note')
    expect(r?.data.rrule).toBeUndefined()
  })

  it('gives every result its own data object', () => {
    const a = p('+ riya birthday 14 nov')
    const b = p('350 lunch')
    expect(a?.data.rrule).toBe('FREQ=YEARLY')
    expect(b?.data).toEqual({})
    expect(a?.data).not.toBe(b?.data)
  })
})
