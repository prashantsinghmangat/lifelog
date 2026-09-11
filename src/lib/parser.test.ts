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

describe('a year on a written date', () => {
  it('takes the year when it is given', () => {
    // Without this the year was ignored *and* left behind: "anniversary 12 sep
    // 2025" filed to this September and read the 2025 as ₹2,025.
    expect(p('500 anniversary dinner 12 sep 2025')?.occurredOn).toBe('2025-09-12')
    expect(p('500 anniversary dinner 12 sep 2025')?.title).toBe('anniversary dinner')
  })

  it('takes it in either word order', () => {
    expect(p('sep 12 2025 anniversary')?.occurredOn).toBe('2025-09-12')
    expect(p('12 september 2025 anniversary')?.occurredOn).toBe('2025-09-12')
  })

  it('still means this year when no year is written', () => {
    expect(p('500 dinner 12 sep')?.occurredOn).toBe('2026-09-12')
  })

  it('does not mistake an amount for a year', () => {
    // A year has to begin 19 or 20. An unrestricted four digits would read the
    // 1200 here as the year 1200 rather than the number it plainly is.
    const r = p('2h call 12 sep 1200')
    expect(r?.occurredOn).toBe('2026-09-12')
    expect(r?.title).toContain('1200')
  })

  it('reads a slash date with a year, which already worked', () => {
    expect(p('500 anniversary dinner 12/9/2025')?.occurredOn).toBe('2025-09-12')
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

  it('reads "in an hour", which is how people actually say it', () => {
    // This used to fall through to a note: a reminder that silently was not
    // one, which is the worst outcome this parser can produce.
    const r = p('ping me in an hour')
    expect(r?.kind).toBe('event')
    expect(r?.occurredAt?.startsWith('2026-09-01T11:00:00')).toBe(true)
    expect(r?.title).toBe('ping me')
  })

  it('reads "in half an hour", and "half hour" without the article', () => {
    expect(p('ping me in half an hour')?.occurredAt?.startsWith('2026-09-01T10:30:00')).toBe(true)
    expect(p('ping me in half hour')?.occurredAt?.startsWith('2026-09-01T10:30:00')).toBe(true)
  })

  it('tries "half an hour" before "an hour", or half lands in the title', () => {
    const r = p('ping me in half an hour')
    expect(r?.title).toBe('ping me')
  })

  it('reads "in a minute" and "an hour from now"', () => {
    expect(p('ping me in a minute')?.occurredAt?.startsWith('2026-09-01T10:01:00')).toBe(true)

    const later = p('an hour from now standup')
    expect(later?.occurredAt?.startsWith('2026-09-01T11:00:00')).toBe(true)
    expect(later?.title).toBe('standup')
  })

  it('does not read an article followed by an ordinary word as a time', () => {
    // The unit letters are single characters — `h` and `m` — so without a word
    // boundary after them these would all become reminders.
    for (const text of ['in a house', 'after a hard day', 'meeting in a moment']) {
      const r = p(text)
      expect(r?.kind).toBe('note')
      expect(r?.occurredAt).toBeUndefined()
    }
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

describe('the ways people misspell tomorrow', () => {
  // A typo here cost a real reminder: "send proposal to amit tommorow" saved as
  // a note with no date, so nothing was ahead, so nothing was ever scheduled —
  // and the row looked exactly like one that had worked.
  for (const word of ['tomorrow', 'tommorow', 'tommorrow', 'tomorow', 'tmrw']) {
    it(`reads "${word}" as tomorrow, which makes it an event`, () => {
      const r = p(`send proposal to amit ${word}`)
      expect(r?.occurredOn).toBe(TOMORROW)
      expect(r?.kind).toBe('event')
      expect(r?.title).toBe('send proposal to amit')
    })
  }

  it('reads "yesturday" as yesterday, so the expense lands on the right day', () => {
    const r = p('320 lunch yesturday')
    expect(r?.occurredOn).toBe(YESTERDAY)
    expect(r?.amountPaise).toBe(32000)
  })
})

describe('a time range, read for its start', () => {
  it('takes the whole span out rather than half of it', () => {
    // The bug: the first time was kept and "to 9 am" was swept into the title,
    // which read as gibberish that had nonetheless saved.
    const r = p('+ set reminder morning 8 am to 9 am yoga')
    expect(r?.kind).toBe('event')
    expect(r?.occurredAt).toBe('2026-09-01T08:00:00+05:30')
    expect(r?.title).toBe('set reminder morning yoga')
  })

  it('applies the one meridiem given to both ends', () => {
    const r = p('yoga 8 to 9 am tomorrow')
    expect(r?.occurredOn).toBe(TOMORROW)
    expect(r?.occurredAt).toBe('2026-09-02T08:00:00+05:30')
    expect(r?.title).toBe('yoga')
  })

  it('reads a 24-hour span', () => {
    const r = p('+ standup 10:00 to 11:00')
    expect(r?.occurredAt).toBe('2026-09-01T10:00:00+05:30')
    expect(r?.title).toBe('standup')
  })

  it('accepts until and till as the join', () => {
    expect(p('+ fast 8 am until 6 pm')?.occurredAt).toBe('2026-09-01T08:00:00+05:30')
    expect(p('+ fast 8 am till 6 pm')?.occurredAt).toBe('2026-09-01T08:00:00+05:30')
  })

  it('leaves two bare numbers alone, so 9-6 is still not a time range', () => {
    // Hyphens are not a join here at all, and a bare "10 to 6" carries no clock
    // marker — both stay out, as the parser has always had them.
    expect(p('9-6 worked')?.occurredAt).toBeUndefined()
    expect(p('10 to 6 worked')?.occurredAt).toBeUndefined()
  })

  it('does not turn a counted title into a clock', () => {
    const r = p('2 to 3 apples')
    expect(r?.occurredAt).toBeUndefined()
  })

  it('leaves a payment to someone alone', () => {
    const r = p('20000 to neha')
    expect(r?.kind).toBe('expense')
    expect(r?.amountPaise).toBe(2000000)
    expect(r?.occurredAt).toBeUndefined()
  })
})

describe('a reminder that comes round again', () => {
  // Saturday 12 September 2026, nine in the morning.
  const SAT = new Date(2026, 8, 12, 9, 0, 0)
  const on = (text: string) => parse(text, SAT)

  it('reads "weekdays" as a rule, not a date', () => {
    const r = on('standup 10am weekdays')
    expect(r?.kind).toBe('event')
    expect(r?.data.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(r?.title).toBe('standup')
  })

  it('lands the row on the next matching weekday', () => {
    // Typed on a Saturday, so the standup it refers to is Monday's.
    expect(on('standup 10am weekdays')?.occurredOn).toBe('2026-09-14')
    expect(on('standup 10am weekdays')?.occurredAt?.startsWith('2026-09-14T10:00')).toBe(true)
  })

  it('takes the keyword anywhere in the line', () => {
    expect(on('standup weekdays 10am')?.data.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
  })

  it('reads a single day from "every monday"', () => {
    const r = on('gym 7am every monday')
    expect(r?.data.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r?.title).toBe('gym')
    // Read before the date, or the weekday matcher files this on *last* Monday
    // and leaves "every" in the title.
    expect(r?.occurredOn).toBe('2026-09-14')
  })

  it('accepts "every weekday" without a time, where "weekdays" alone would not', () => {
    expect(on('standup every weekday')?.data.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
  })

  it('does not turn prose about weekdays into a reminder', () => {
    // The word is ordinary English. Unanchored it made "weekdays are busy" ring
    // five times a week under the title "are busy".
    for (const text of ['weekdays are busy', 'i hate weekdays', 'meetings are on weekdays']) {
      const r = on(text)
      expect(r?.kind).toBe('note')
      expect(r?.data.rrule).toBeUndefined()
      expect(r?.title).toBe(text)
    }
  })

  it('skips today once its time has gone', () => {
    // Eight in the evening on a Thursday: `standup 10am weekdays` means
    // Friday's standup, not one that finished ten hours ago. The row used to
    // sit on today while `nextOccurrence` answered with tomorrow.
    const thursdayEvening = new Date(2026, 8, 10, 20, 7, 0)
    expect(parse('standup 10am weekdays', thursdayEvening)?.occurredOn).toBe('2026-09-11')

    // The same line in the morning still means today.
    const thursdayMorning = new Date(2026, 8, 10, 8, 0, 0)
    expect(parse('standup 10am weekdays', thursdayMorning)?.occurredOn).toBe('2026-09-10')
  })

  it('starts from the day being viewed, like every other entry', () => {
    // Arrow forward to Monday the 21st and set up a standup: it begins that
    // week, not this one. Counted from today regardless, a repeat was the one
    // entry `defaultDay` did not apply to — it landed on the 14th, and the
    // phone rang a week before the row said anything was happening.
    const thursday = new Date(2026, 8, 10, 22, 20, 0)
    expect(parse('standup 10am weekdays', thursday, '2026-09-21')?.occurredOn).toBe('2026-09-21')

    // A date typed in the line still wins over the day being viewed.
    expect(parse('standup 14 sep 10am weekdays', thursday, '2026-09-21')?.occurredOn).toBe(
      '2026-09-14',
    )
  })

  it('rolls forward to a listed weekday when the viewed day is not one', () => {
    // Viewing Saturday the 19th: the first standup is Monday the 21st.
    const thursday = new Date(2026, 8, 10, 22, 20, 0)
    expect(parse('standup 10am weekdays', thursday, '2026-09-19')?.occurredOn).toBe('2026-09-21')
  })

  it('leaves a one-off reminder alone', () => {
    const r = on('dentist tomorrow 5pm')
    expect(r?.data.rrule).toBeUndefined()
    expect(r?.occurredOn).toBe('2026-09-13')
  })

  it('still reads a birthday as yearly', () => {
    expect(on('riya birthday 14 nov')?.data.rrule).toBe('FREQ=YEARLY')
  })
})
