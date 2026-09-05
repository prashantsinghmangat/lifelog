import { addDays, format, parseISO, startOfDay, subDays } from 'date-fns'
import type { Kind } from '../types'
import { categoryForWord } from './merchants'

export type ParsedEntry = {
  kind: Kind
  occurredOn: string // yyyy-MM-dd
  occurredAt?: string // ISO with offset, only when a clock time was given
  title: string
  amountPaise?: number
  durationMinutes?: number
  category?: string
  data: Record<string, unknown>
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  weds: 3,
  wed: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
}

// Longest alternatives first so `monday` never matches as `mon` + leftovers.
const WEEKDAY = Object.keys(WEEKDAYS).join('|')
const MONTH = Object.keys(MONTHS).join('|')

const FILLER = new Set(['spent', 'paid', 'bought', 'for', 'on', 'at', 'worked', 'did'])

const DEFAULT_TITLE: Record<Kind, string> = {
  expense: 'Expense',
  time: 'Time log',
  event: 'Event',
  note: 'Note',
}

type Cut<T> = { value: T; rest: string }

function cut<T>(input: string, re: RegExp, read: (m: RegExpMatchArray) => T | null): Cut<T> | null {
  const m = input.match(re)
  if (!m) return null
  const value = read(m)
  if (value === null) return null
  return { value, rest: input.slice(0, m.index) + ' ' + input.slice((m.index ?? 0) + m[0].length) }
}

function int(raw: string | undefined): number {
  return raw === undefined ? 0 : Number.parseInt(raw, 10)
}

function takeDate(input: string, now: Date): Cut<Date> | null {
  const today = startOfDay(now)

  const relative =
    cut(input, /\btoday\b/i, () => today) ??
    cut(input, /\byesterday\b/i, () => subDays(today, 1)) ??
    cut(input, /\btomorrow\b/i, () => addDays(today, 1)) ??
    cut(input, /\b(\d+)\s*(?:days?|d)\s+ago\b/i, (m) => subDays(today, int(m[1])))
  if (relative) return relative

  const nextWeekday = cut(input, new RegExp(`\\bnext\\s+(${WEEKDAY})\\b`, 'i'), (m) => {
    const target = WEEKDAYS[(m[1] ?? '').toLowerCase()]
    if (target === undefined) return null
    return addDays(today, ((target - today.getDay() + 7) % 7) || 7)
  })
  if (nextWeekday) return nextWeekday

  // Slash dates only: `9-6` is a time range, not the 9th of June.
  const numeric =
    cut(input, /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) =>
      makeDate(int(m[1]), int(m[2]) - 1, int(m[3])),
    ) ??
    cut(input, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) =>
      makeDate(fullYear(m[3], now), int(m[2]) - 1, int(m[1])),
    )
  if (numeric) return numeric

  const named =
    cut(input, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\b`, 'i'), (m) =>
      makeDate(now.getFullYear(), MONTHS[(m[2] ?? '').toLowerCase()] ?? -1, int(m[1])),
    ) ??
    cut(input, new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m) =>
      makeDate(now.getFullYear(), MONTHS[(m[1] ?? '').toLowerCase()] ?? -1, int(m[2])),
    )
  if (named) return named

  return cut(input, new RegExp(`\\b(${WEEKDAY})\\b`, 'i'), (m) => {
    const target = WEEKDAYS[(m[1] ?? '').toLowerCase()]
    if (target === undefined) return null
    return subDays(today, (today.getDay() - target + 7) % 7)
  })
}

function makeDate(year: number, monthIndex: number, day: number): Date | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null
  const d = new Date(year, monthIndex, day)
  return d.getMonth() === monthIndex && d.getDate() === day ? d : null
}

function fullYear(raw: string | undefined, now: Date): number {
  if (raw === undefined) return now.getFullYear()
  const n = int(raw)
  return n < 100 ? 2000 + n : n
}

function takeTime(input: string): Cut<{ hours: number; minutes: number }> | null {
  return (
    // `5pm`, `5 pm`, `4:00 p.m.`, `9 A.M.` — the dotted forms matter because a
    // phone keyboard autocorrects "pm" to "p.m.", and without them `4:00 p.m.`
    // falls through to the 24-hour branch and becomes 4am. A trailing \b cannot
    // be used: after the final dot there is no word boundary.
    cut(input, /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/i, (m) => {
      const hour = int(m[1])
      const minutes = m[2] === undefined ? 0 : int(m[2])
      if (hour < 1 || hour > 12 || minutes > 59) return null
      const pm = (m[3] ?? '').toLowerCase() === 'p'
      return { hours: (hour % 12) + (pm ? 12 : 0), minutes }
    }) ??
    cut(input, /\b(\d{1,2}):(\d{2})\b/, (m) => {
      const hours = int(m[1])
      const minutes = int(m[2])
      return hours > 23 || minutes > 59 ? null : { hours, minutes }
    })
  )
}

const HOURS = '(?:hours?|hrs?|h)'
const MINUTES = '(?:minutes?|mins?|m)'

function takeDuration(input: string): Cut<number> | null {
  return (
    cut(input, new RegExp(`\\b(\\d+)\\s*${HOURS}\\s*(\\d+)\\s*${MINUTES}\\b`, 'i'), (m) =>
      int(m[1]) * 60 + int(m[2]),
    ) ??
    // `2h30`, with the m dropped. The space is forbidden on purpose: in
    // `2h 500 client work` the 500 is an amount, not thirty-plus hours of minutes.
    cut(input, /\b(\d+)h([0-5]?\d)\b/i, (m) => int(m[1]) * 60 + int(m[2])) ??
    cut(input, new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${HOURS}\\b`, 'i'), (m) =>
      Math.round(Number(m[1]) * 60),
    ) ??
    cut(input, new RegExp(`\\b(\\d+)\\s*${MINUTES}\\b`, 'i'), (m) => int(m[1]))
  )
}

/**
 * `in 5 minutes`, `after 2 hours`, `10 mins from now` — a moment, not a length.
 *
 * Must be read before the duration, or `in 5 minutes` is eaten as a five-minute
 * time log. The `in`/`after`/`from now` wrapper is what separates the two: a
 * bare `45 min gym` is still a duration.
 */
function takeRelative(input: string, now: Date): Cut<Date> | null {
  const ahead = (raw: string | undefined, perUnit: number): Date | null => {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return null
    return new Date(now.getTime() + Math.round(value * perUnit * 60_000))
  }

  return (
    cut(input, new RegExp(`\\b(?:in|after)\\s+(\\d+(?:\\.\\d+)?)\\s*${HOURS}\\b`, 'i'), (m) =>
      ahead(m[1], 60),
    ) ??
    cut(input, new RegExp(`\\b(?:in|after)\\s+(\\d+)\\s*${MINUTES}\\b`, 'i'), (m) =>
      ahead(m[1], 1),
    ) ??
    cut(input, new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${HOURS}\\s+from\\s+now\\b`, 'i'), (m) =>
      ahead(m[1], 60),
    ) ??
    cut(input, new RegExp(`\\b(\\d+)\\s*${MINUTES}\\s+from\\s+now\\b`, 'i'), (m) => ahead(m[1], 1))
  )
}

/** Words that make an entry an anniversary, whatever year its date falls in. */
const RECURRING = /\b(bdays?|birthdays?|anniversary|anniversaries)\b/i

const AMOUNT = '(\\d[\\d,]*(?:\\.\\d{1,2})?)'

function takeAmount(input: string, currencyOnly: boolean): Cut<number> | null {
  const marked =
    cut(input, new RegExp(`(?:₹|\\brs\\.?|\\binr\\.?)\\s*${AMOUNT}`, 'i'), toPaise) ??
    // Suffixed, as in `350rs` or `100 rupees`. No \b before `rs`: there is no word
    // boundary between `0` and `r`, which is exactly the case this has to catch.
    cut(input, new RegExp(`\\b${AMOUNT}\\s*(?:₹|rs\\.?|inr\\.?|rupees?)\\b`, 'i'), toPaise)
  if (marked || currencyOnly) return marked
  return cut(input, new RegExp(`\\b${AMOUNT}\\b`), toPaise)
}

function toPaise(m: RegExpMatchArray): number | null {
  const raw = Number((m[1] ?? '').replace(/,/g, ''))
  return Number.isFinite(raw) ? Math.round(raw * 100) : null
}

function collapse(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,.;:\-–]+|[,.;:\-–]+$/g, '')
    .trim()
}

/**
 * `defaultDay` is the day the entry lands on when the text carries no date token.
 * It exists so that arrowing back a day and typing `500 groceries` files the entry
 * on the day being viewed instead of silently jumping to today. Relative words are
 * still resolved against `now`, so `yesterday` always means yesterday.
 */
export function parse(input: string, now: Date, defaultDay?: string): ParsedEntry | null {
  const original = input.trim()
  if (!original) return null

  let rest = original
  let kind: Kind | undefined
  let matched = false

  if (rest.startsWith('+')) {
    kind = 'event'
    rest = rest.slice(1)
    matched = true
  }

  const date = takeDate(rest, now)
  if (date) {
    rest = date.rest
    matched = true
  }
  // Before duration, or `in 5 minutes` becomes a five-minute time log.
  const relative = takeRelative(rest, now)
  if (relative) {
    rest = relative.rest
    matched = true
  }

  const fallback = defaultDay === undefined ? startOfDay(now) : startOfDay(parseISO(defaultDay))
  // A relative offset can roll past midnight, so it decides the day too.
  const occurredOn =
    date?.value ?? (relative ? startOfDay(relative.value) : fallback)

  const time = takeTime(rest)
  if (time) {
    rest = time.rest
    matched = true
  }

  const duration = takeDuration(rest)
  if (duration) {
    rest = duration.rest
    matched = true
    kind ??= 'time'
  }

  // A bare number is part of the title once a duration has fixed the kind.
  const amount = takeAmount(rest, duration !== null)
  if (amount) {
    rest = amount.rest
    matched = true
    kind ??= 'expense'
  }

  // A clock time is only meaningful as a moment once the day is fixed. A
  // relative offset is already a moment, and wins if both somehow appear.
  let at: Date | null = relative?.value ?? null
  if (at === null && time) {
    at = new Date(occurredOn)
    at.setHours(time.value.hours, time.value.minutes, 0, 0)
  }

  // A birthday is recurring by its nature, so this year's date having passed
  // does not make it a note. Without this, "deepak birthday 13 feb" typed in
  // September becomes a note, gets no yearly rule, and can never answer the
  // question it exists for: when is it next.
  // Only with a date: an anniversary needs a day to recur on, and without one
  // "birthday ideas for riya" is a note about planning, not an event.
  const recurring = RECURRING.test(rest)
  if (!kind && recurring && date !== null) kind = 'event'

  // You cannot have already spent money tomorrow, nor done something at 8:15pm
  // while it is 8:10pm — so anything still ahead is an event. The clock half of
  // this is what lets `ping 8:15pm` work without a leading `+`.
  if (!kind && (occurredOn > startOfDay(now) || (at !== null && at > now))) kind = 'event'

  const day = format(occurredOn, 'yyyy-MM-dd')
  const resolved: Kind = kind ?? 'note'

  // Nothing was recognised, so the input stands untouched as the title.
  let title = original
  if (matched) {
    const words = collapse(rest).split(' ').filter(Boolean)
    const kept = words.filter((w) => !FILLER.has(w.toLowerCase()))
    title = collapse((kept.length > 0 ? kept : words).join(' ')) || DEFAULT_TITLE[resolved]
  }

  const entry: ParsedEntry = { kind: resolved, occurredOn: day, title, data: {} }

  if (at !== null) entry.occurredAt = format(at, "yyyy-MM-dd'T'HH:mm:ssXXX")
  if (duration) entry.durationMinutes = duration.value
  if (amount) entry.amountPaise = amount.value

  if (resolved === 'expense') {
    for (const word of title.split(/[^a-z0-9]+/i)) {
      const category = categoryForWord(word)
      if (category) {
        entry.category = category
        break
      }
    }
  }

  if (resolved === 'event' && recurring) entry.data.rrule = 'FREQ=YEARLY'

  return entry
}
