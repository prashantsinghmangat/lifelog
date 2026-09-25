import { addDays, format, parseISO, startOfDay, subDays } from 'date-fns'
import type { Kind } from '../types'
import { amountFits, minutesFit } from './format'
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

/**
 * The two date words people misspell, spelled the ways they actually type them.
 *
 * Not indulgence — a typo here costs a reminder and says nothing. "send proposal
 * to amit tommorow" parsed as a note: no date, so nothing ahead, so no event and
 * no alarm, and the row looked exactly like one that had worked. The doubled `m`
 * and dropped `r` are the common slips, and `tmrw` is how a phone gets typed.
 */
const TOMORROW = /\b(?:tom+or+ow|tmrw|tmrow)\b/i
/** `yesturday` files an expense on the wrong day, which is quieter but still wrong. */
const YESTERDAY = /\byest[eu]rday\b/i

const DEFAULT_TITLE: Record<Kind, string> = {
  expense: 'Expense',
  time: 'Time log',
  event: 'Event',
  note: 'Note',
}

type Cut<T> = { value: T; rest: string }

/**
 * `scan` is matched against, `input` is what gets cut.
 *
 * They are the same string everywhere but the bare-amount branch, which scans a
 * copy with every date-shaped phrase's digits blanked out. The mask replaces
 * digits one for one, so a match found in it sits at the same offsets — and its
 * captures are the original characters, because a masked digit can never be
 * part of a match that requires digits.
 */
function cut<T>(
  input: string,
  re: RegExp,
  read: (m: RegExpMatchArray) => T | null,
  scan: string = input,
): Cut<T> | null {
  const m = scan.match(re)
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
    cut(input, YESTERDAY, () => subDays(today, 1)) ??
    cut(input, TOMORROW, () => addDays(today, 1)) ??
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

  // The year is optional and must be four digits beginning 19 or 20. Bare, so
  // that `12 sep` still means this year — but taken when it is there, because
  // without it `anniversary 12 sep 2025` filed to *this* September and left the
  // year behind to be read as ₹2,025. Narrow on purpose: an unrestricted
  // `\d{4}` would turn the 1200 in `12 sep 1200` into the year 1200 rather than
  // the amount it plainly is.
  const YEAR = '(?:\\s+((?:19|20)\\d{2}))?'
  const named =
    cut(input, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})${YEAR}\\b`, 'i'), (m) =>
      namedDate(m[3], MONTHS[(m[2] ?? '').toLowerCase()] ?? -1, int(m[1]), now),
    ) ??
    cut(input, new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${YEAR}\\b`, 'i'), (m) =>
      namedDate(m[3], MONTHS[(m[1] ?? '').toLowerCase()] ?? -1, int(m[2]), now),
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

/**
 * A written date with no year means the soonest year it is actually valid in.
 *
 * Only 29 February is ever rescued by this. Every other impossible day — 31
 * Feb, 31 Apr — is impossible in every year and still refuses, so the reading
 * of an ordinary `12 sep` is untouched: this year is valid, and the loop stops
 * on its first try.
 *
 * Without it, `anniversary 29 feb` typed in a non-leap year matched no date at
 * all, and the 29 left behind was then read as **₹29**: an expense, on today,
 * titled "anniversary feb". A leap-day anniversary is a documented thing this
 * app supports, and it could only be typed one year in four.
 */
function namedDate(
  rawYear: string | undefined,
  monthIndex: number,
  day: number,
  now: Date,
): Date | null {
  if (rawYear !== undefined) return makeDate(fullYear(rawYear, now), monthIndex, day)

  const from = now.getFullYear()
  for (let year = from; year <= from + 4; year += 1) {
    const found = makeDate(year, monthIndex, day)
    if (found !== null) return found
  }
  return null
}

function fullYear(raw: string | undefined, now: Date): number {
  if (raw === undefined) return now.getFullYear()
  const n = int(raw)
  return n < 100 ? 2000 + n : n
}

type Clock = { hours: number; minutes: number }

function clockFrom(rawHour: string | undefined, rawMinutes: string | undefined, meridiem: string): Clock | null {
  const hours = int(rawHour)
  const minutes = rawMinutes === undefined ? 0 : int(rawMinutes)
  if (minutes > 59) return null
  if (meridiem === '') return hours > 23 ? null : { hours, minutes }
  if (hours < 1 || hours > 12) return null
  return { hours: (hours % 12) + (meridiem === 'p' ? 12 : 0), minutes }
}

const CLOCK = '(\\d{1,2})(?::(\\d{2}))?(?:\\s*([ap])\\.?\\s?m\\.?)?'
/** Only the spelled-out joins: `-` stays out, so `9-6` is still not a time range. */
const SPAN = new RegExp(`\\b${CLOCK}\\s*(?:to|till|until)\\s+${CLOCK}(?![a-z])`, 'i')

/**
 * `8 am to 9 am`, `8 to 9 am`, `10:00 to 11:00` — a window, read for its start.
 *
 * There is no column for an end time and there is deliberately not going to be
 * one, but half-reading a window was worse than either understanding or refusing
 * it: `set reminder morning 8 am to 9 am yoga` kept the first time and swept
 * `to 9 am` into the title, which then read as gibberish that had nonetheless
 * saved. The whole span comes out in one piece and the start becomes the moment,
 * which is the part a reminder needs. The preview shows that single time before
 * anything is saved, so nothing about it is silent.
 *
 * Both sides bare is not a clock range — `9-6` is the syntax this parser does
 * not read, and `2 to 3 apples` is a title. A colon or a meridiem somewhere is
 * what tells the two apart.
 */
function takeRange(input: string): Cut<Clock> | null {
  return cut(input, SPAN, (m) => {
    const marked = [m[2], m[3], m[5], m[6]].some((part) => part !== undefined)
    if (!marked) return null
    // `8 to 9 am` means both are am: the one meridiem given covers the start.
    return clockFrom(m[1], m[2], (m[3] ?? m[6] ?? '').toLowerCase())
  })
}

function takeTime(input: string): Cut<Clock> | null {
  return (
    // Ahead of the single-time patterns, or a range loses its end into the title.
    takeRange(input) ??
    // `5pm`, `5 pm`, `4:00 p.m.`, `9 A.M.` — the dotted forms matter because a
    // phone keyboard autocorrects "pm" to "p.m.", and without them `4:00 p.m.`
    // falls through to the 24-hour branch and becomes 4am. A trailing \b cannot
    // be used: after the final dot there is no word boundary.
    cut(input, /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])/i, (m) =>
      clockFrom(m[1], m[2], (m[3] ?? '').toLowerCase()),
    ) ??
    cut(input, /\b(\d{1,2}):(\d{2})\b/, (m) => clockFrom(m[1], m[2], ''))
  )
}

const HOURS = '(?:hours?|hrs?|h)'
const MINUTES = '(?:minutes?|mins?|m)'

/**
 * `scan` defaults to `input`, exactly like `cut` itself — the override exists
 * for `parse`, which must keep a lead phrase's own digit out of reach here.
 * See `takeLead`: `remind 2 hours before` is a lead, not a two-hour time log.
 */
function takeDuration(input: string, scan: string = input): Cut<number> | null {
  return (
    cut(
      input,
      new RegExp(`\\b(\\d+)\\s*${HOURS}\\s*(\\d+)\\s*${MINUTES}\\b`, 'i'),
      (m) => asMinutes(int(m[1]) * 60 + int(m[2])),
      scan,
    ) ??
    // `2h30`, with the m dropped. The space is forbidden on purpose: in
    // `2h 500 client work` the 500 is an amount, not thirty-plus hours of minutes.
    cut(input, /\b(\d+)h([0-5]?\d)\b/i, (m) => asMinutes(int(m[1]) * 60 + int(m[2])), scan) ??
    cut(
      input,
      new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${HOURS}\\b`, 'i'),
      (m) => asMinutes(Number(m[1]) * 60),
      scan,
    ) ??
    cut(input, new RegExp(`\\b(\\d+)\\s*${MINUTES}\\b`, 'i'), (m) => asMinutes(int(m[1])), scan)
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

  // Said rather than counted. `in an hour` is at least as natural as `in 60
  // minutes`, and it used to fall through to a note — a reminder that silently
  // was not one. `half` is tried first, or `half an hour` matches the `an hour`
  // pattern and leaves `half` sitting in the title.
  const spoken =
    cut(input, new RegExp(`\\b(?:in|after)\\s+half\\s+(?:an?\\s+)?${HOURS}\\b`, 'i'), () =>
      ahead('30', 1),
    ) ??
    cut(input, new RegExp(`\\bhalf\\s+(?:an?\\s+)?${HOURS}\\s+from\\s+now\\b`, 'i'), () =>
      ahead('30', 1),
    ) ??
    cut(input, new RegExp(`\\b(?:in|after)\\s+an?\\s+${HOURS}\\b`, 'i'), () => ahead('60', 1)) ??
    cut(input, new RegExp(`\\ban?\\s+${HOURS}\\s+from\\s+now\\b`, 'i'), () => ahead('60', 1)) ??
    cut(input, new RegExp(`\\b(?:in|after)\\s+an?\\s+${MINUTES}\\b`, 'i'), () => ahead('1', 1)) ??
    cut(input, new RegExp(`\\ban?\\s+${MINUTES}\\s+from\\s+now\\b`, 'i'), () => ahead('1', 1))
  if (spoken) return spoken

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

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * A weekly repeat, as a set of weekdays.
 *
 * `standup 10am weekdays` is one row that rings five times a week, not five
 * rows — so what is read here is a *rule*, and the row's own date becomes the
 * next occurrence rather than the only one.
 *
 * **Read before the date.** `every monday` would otherwise lose its weekday to
 * the plain weekday matcher, filing the entry on *last* Monday and leaving
 * `every` in the title. `weekdays` is safe from that matcher either way — no
 * weekday name survives a `\b` inside it — but `every monday` is not.
 */
function takeRepeat(input: string): Cut<number[]> | null {
  /**
   * Bare `weekdays` counts only when the line also carries a clock time.
   *
   * It is an ordinary English word, and on its own it turned "weekdays are
   * busy" — plainly a note — into a reminder ringing five times a week titled
   * "are busy". A repeat modifies an appointment, and an appointment has a
   * time; prose does not. `every weekday` covers the rare timeless case, since
   * `every` says outright that a repeat is meant.
   */
  const bare =
    takeTime(input) === null
      ? null
      : cut(input, /\bweekdays\b/i, () => [1, 2, 3, 4, 5])

  return (
    // Ahead of `bare`, or the bare matcher takes the `weekdays` out of
    // `every weekdays` and leaves the `every` behind in the title:
    // `standup 10am every weekdays` was saving as "standup every".
    cut(input, /\bevery\s+weekdays?\b/i, () => [1, 2, 3, 4, 5]) ??
    bare ??
    cut(input, new RegExp(String.raw`\bevery\s+(${DAY_RUN})\b`, 'i'), (m) => {
      const days = readDays(m[1] ?? '')
      return days.length === 0 ? null : days
    })
  )
}

/**
 * One or more weekday names after `every`, however they are joined.
 *
 * `every tuesday and thursday` used to keep the Tuesday and lose the Thursday —
 * and worse, the orphaned `thursday` was then read by `takeDate` as a plain
 * weekday, which files on the *last* one. So a line asking for two days a week
 * produced a single repeat starting in the past, with `and` left sitting in the
 * title, and nothing on screen said so.
 *
 * The rest of the app was always ready for this: `BYDAY=TU,TH` is what
 * `weeklyRule` already writes, `repeatLabel` already reads "every Tue, Thu", and
 * `alarms` already schedules one cron per weekday. Only the grammar could not
 * say it.
 *
 * Separators are a comma, `and`, `&`, or nothing at all — `every mon wed fri` is
 * how people type it. A bare space is safe here because the run only continues
 * while the next word *is* a weekday: `every friday gym` stops at Friday and
 * leaves `gym` to be the title.
 */
const DAY_SEPARATOR = String.raw`(?:\s*,\s*|\s+and\s+|\s*&\s*|\s+)`
const DAY_RUN = `(?:${WEEKDAY})s?(?:${DAY_SEPARATOR}(?:${WEEKDAY})s?)*`

/** Every weekday named in a matched run. Order is irrelevant; `weeklyRule` sorts. */
function readDays(run: string): number[] {
  const days: number[] = []
  for (const word of run.toLowerCase().split(/[\s,&]+|\band\b/)) {
    const day = WEEKDAYS[word] ?? WEEKDAYS[word.replace(/s$/, '')]
    if (day !== undefined) days.push(day)
  }
  return days
}

/** `[1,2,3,4,5]` becomes `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`. */
function weeklyRule(days: number[]): string {
  const codes = [...new Set(days)].sort().map((day) => BYDAY[day] ?? 'MO')
  return `FREQ=WEEKLY;BYDAY=${codes.join(',')}`
}

/**
 * The soonest of these weekdays, today included only while its time is ahead.
 *
 * The clock matters: `standup 10am weekdays` typed at eight in the evening on a
 * Thursday means Friday's standup, not one that was over ten hours ago. Without
 * this the row sat on today while `nextOccurrence` answered with tomorrow, and
 * the two disagreed about the same entry.
 */
function soonestOf(days: number[], from: Date, clock: Clock | null, now: Date): Date {
  for (let ahead = 0; ahead < 8; ahead += 1) {
    const candidate = addDays(from, ahead)
    if (!days.includes(candidate.getDay())) continue
    if (ahead > 0) return candidate

    const due = new Date(candidate)
    due.setHours(clock?.hours ?? 9, clock?.minutes ?? 0, 0, 0)
    if (due >= now) return candidate
  }
  return from
}

/** Words that make an entry an anniversary, whatever year its date falls in. */
const RECURRING = /\b(bdays?|birthdays?|anniversary|anniversaries)\b/i

/**
 * One date token, resolved. Shared with the question grammar so that asking
 * about `last saturday`, `14 nov` or `3 days ago` reuses the parser's own
 * handling rather than a second, drifting copy of it.
 */
export function dateIn(text: string, now: Date): { at: Date; rest: string } | null {
  const found = takeDate(text, now)
  return found === null ? null : { at: found.value, rest: found.rest }
}

/**
 * Shared with the editor, so correcting a misparsed note into an event applies
 * the same yearly rule the parser would have.
 */
export function recurringTitle(title: string): boolean {
  return RECURRING.test(title)
}

const AMOUNT = '(\\d[\\d,]*(?:\\.\\d{1,2})?)'
const CURRENCY = '(?:₹|\\brs\\.?|\\binr\\.?)'
const SUFFIX = '(?:₹|rs\\.?|inr\\.?|rupees?)\\b'

/**
 * A minus only at the start of a word, never mid-token.
 *
 * `covid-19 test 500` and `9-6 work` both carry a hyphen between digits and
 * neither is a negative number, so a bare `-?` in front of the amount would
 * turn the first into minus nineteen rupees. Requiring the line's start or a
 * space before it keeps every existing reading exactly as it was.
 */
const MINUS = '(?:^|\\s)-\\s*'

/**
 * A bare number is money only when it stands as its own word.
 *
 * `\b` is not that test. In `covid-19 test 500` there is a word boundary
 * between the hyphen and the 1, so the first thing the old pattern found was
 * **19** — and the 500, which is plainly the price, was left in the title
 * beside a mangled "covid-". `9-6 work` went the same way and became an expense
 * of ₹9 titled "6 work", which is exactly the time range this parser documents
 * itself as refusing to read. `2kg rice 300` was two rupees.
 *
 * So the digits must start at the line's edge or after a character that is
 * neither a word character nor a hyphen, and must not run straight into one
 * either. A trailing full stop is still fine, because `Lunch, 350.` is a
 * sentence rather than a decimal.
 */
const EDGE = String.raw`(?:^|[^\w-])`
const BARE = String.raw`${AMOUNT}(?![-\w])`

/**
 * The two written-date shapes `takeDate` tries, for masking rather than reading.
 *
 * Deliberately loose about validity: the whole point is to catch the phrases
 * `takeDate` turned *down*, which are the ones still sitting in the text.
 */
const DATE_SHAPE = new RegExp(
  String.raw`\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH})|(?:${MONTH})\.?\s+\d{1,2}(?:st|nd|rd|th)?)` +
    String.raw`(?:\s+(?:19|20)\d{2})?\b`,
  'gi',
)

/**
 * The same string with every date phrase's digits blanked, one character for
 * one, so offsets and every other character survive untouched.
 */
function maskDates(input: string): string {
  return input.replace(DATE_SHAPE, (phrase) => phrase.replace(/\d/g, '#'))
}

/**
 * `remind 2 days before`, `remind me a week before`, `alert 1 month early`.
 *
 * A verb is required — `remind` or `alert`, `me` optional — because `before`
 * on its own is ordinary English (`call before dinner`) and needs the same
 * explicit anchor `every` already gives the weekday grammar. Units are always
 * spelled out in full: `1d`, `1w` and `2h` collide with the duration tokens
 * and with `3 days ago`, and extraction only protects against that by
 * ordering, which is exactly the kind of correctness a later reorder quietly
 * breaks. `a`/`an` stand in for one, matching `in an hour` elsewhere in this
 * file — mind the trailing `\b` on the unit, or `remind a house before` would
 * be the same mistake `in a house` once was here.
 */
const LEAD_VERB = '(?:remind(?:\\s+me)?|alert(?:\\s+me)?)'
const LEAD_UNIT = '(?:days?|weeks?|months?|hours?|minutes?)'
const LEAD_SHAPE = new RegExp(
  `\\b${LEAD_VERB}\\s+(?:a|an|\\d+)\\s*${LEAD_UNIT}\\s+(?:before|early)\\b`,
  'gi',
)

/**
 * Two years of headroom: a passport or an insurance policy is a real one-year
 * lead, a lease is closer to two, and past that a lead is more likely a typo
 * than a want. `data.lead` is a JSONB field with no column to overflow, so
 * this is a sanity ceiling agreed on rather than one Postgres imposes.
 */
const LEAD_MAX_MINUTES = 2 * 365 * 24 * 60

function leadFits(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= LEAD_MAX_MINUTES
}

/** A month has no fixed length; the export in `ics.ts` decides why this one does. */
function minutesPerLeadUnit(unit: string): number {
  const word = unit.toLowerCase()
  if (word.startsWith('week')) return 60 * 24 * 7
  if (word.startsWith('month')) return 60 * 24 * 30
  if (word.startsWith('day')) return 60 * 24
  if (word.startsWith('hour')) return 60
  return 1
}

/**
 * A lead time, in minutes — `parse` decides on its own whether to keep it. See
 * the comment at the call site for why: it must not create an event, only
 * attach to one already implied by the rest of the line, and never to a
 * weekly repeat.
 */
function takeLead(input: string): Cut<number> | null {
  return cut(
    input,
    new RegExp(`\\b${LEAD_VERB}\\s+(a|an|\\d+)\\s*(${LEAD_UNIT})\\s+(?:before|early)\\b`, 'i'),
    (m) => {
      const qty = /^\d+$/.test(m[1] ?? '') ? int(m[1]) : 1
      const minutes = qty * minutesPerLeadUnit(m[2] ?? '')
      return leadFits(minutes) ? minutes : null
    },
  )
}

/**
 * The same string with a lead phrase's own digit blanked, so `takeDuration`
 * and `takeAmount` can never read it as a two-hour time log or two rupees —
 * the same trick `maskDates` already plays for a date phrase it declined to
 * use. Unconditional, like `maskDates`: a lead over the two-year cap is still
 * a lead-shaped phrase and its digit must not leak into either reading either.
 */
function maskLead(input: string): string {
  return input.replace(LEAD_SHAPE, (phrase) => phrase.replace(/\d/g, '#'))
}

/**
 * Money can be negative, because a refund is money.
 *
 * The rest of the money model already says so: the column is a signed integer,
 * `rupees` prints a leading minus, and `paiseFrom` has always accepted one — so
 * the editor stored refunds correctly while the parser threw the sign away and
 * filed `-50 refund` as fifty rupees *spent*, quietly inflating the day's
 * total. That is the one reading here that can be wrong without looking wrong.
 *
 * This is not a fifth kind and not a new concept: it is an expense of −₹50.
 */
function takeAmount(input: string, currencyOnly: boolean, leadMask: string = input): Cut<number> | null {
  const marked =
    cut(input, new RegExp(`${CURRENCY}\\s*-\\s*${AMOUNT}`, 'i'), negated) ??
    cut(input, new RegExp(`${CURRENCY}\\s*${AMOUNT}`, 'i'), toPaise) ??
    cut(input, new RegExp(`${MINUS}${AMOUNT}\\s*${SUFFIX}`, 'i'), negated) ??
    // Suffixed, as in `350rs` or `100 rupees`. No \b before `rs`: there is no word
    // boundary between `0` and `r`, which is exactly the case this has to catch.
    cut(input, new RegExp(`\\b${AMOUNT}\\s*${SUFFIX}`, 'i'), toPaise)
  if (marked || currencyOnly) return marked

  // `every 2 weeks` is a repeat this app cannot express — it is not two rupees.
  // The bare-number branch below was reading that 2 as money, so a line about a
  // fortnightly gym session became a ₹2 expense titled "gym every weeks": the
  // wrong kind, an invented amount, and the user's own words mangled in the
  // title. A number directly after `every` is a quantity in somebody's
  // recurrence grammar, whatever the grammar happens to be, and never a price.
  // Currency-marked amounts above are untouched: `₹2` says money outright.
  if (/\bevery\s+\d/i.test(input)) return null

  // Scanned with every date-shaped phrase blanked out. `takeDate` has already
  // removed the one it could read; what is left is a date phrase it *refused* —
  // `31 feb`, or `29 feb 2026` — and those digits are a day and a year, never
  // money. Visible to this branch, `anniversary 31 feb` became an expense of
  // ₹31 and `anniversary 29 feb 2026` an expense of ₹2,026.
  //
  // `leadMask` has already had a lead phrase's own digit blanked the same way,
  // so `remind 2 days before` reads as a lead and not as ₹2 — see `takeLead`.
  const scan = maskDates(leadMask)

  return (
    cut(input, new RegExp(`${MINUS}${BARE}`), negated, scan) ??
    cut(input, new RegExp(`${EDGE}${BARE}`), toPaise, scan)
  )
}

function negated(m: RegExpMatchArray): number | null {
  const paise = toPaise(m)
  return paise === null ? null : -paise
}

/**
 * Out of range is not an amount.
 *
 * `amount_paise` is a Postgres `integer`, so a bigger number is one this device
 * would store, total into the day and then owe the server for ever — refused
 * with `22003` on every attempt. Returning null makes the pattern simply not
 * match, so the digits stay in the title exactly as any other number the parser
 * cannot use does, and nothing on screen ever claims the money was recorded.
 */
function toPaise(m: RegExpMatchArray): number | null {
  const raw = Number((m[1] ?? '').replace(/,/g, ''))
  if (!Number.isFinite(raw)) return null
  const paise = Math.round(raw * 100)
  return amountFits(paise) ? paise : null
}

/** The same bound for the other integer column. */
function asMinutes(value: number): number | null {
  const whole = Math.round(value)
  return minutesFit(whole) ? whole : null
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

  // Before the date: see `takeRepeat`. A repeat also *implies* a date, so what
  // it leaves behind is the next occurrence rather than nothing at all.
  const repeat = takeRepeat(rest)
  if (repeat) {
    rest = repeat.rest
    matched = true
    kind ??= 'event'
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

  // Read before the day is resolved, because a weekly repeat needs the clock to
  // know whether today still counts.
  const time = takeTime(rest)
  if (time) {
    rest = time.rest
    matched = true
  }

  /**
   * `remind 2 days before` — held rather than cut. Two reasons pin it exactly
   * here, both load-bearing:
   *
   * It must run after `takeRepeat`/`takeDate`/`takeRelative`/`takeTime`,
   * because whether it is kept depends on `resolved` further down, which in
   * turn depends on whether any of those four found an anchor — reordering
   * this earlier would mean guessing at a kind that is not decided yet.
   *
   * It must run before `takeDuration`/`takeAmount`, or its own number is read
   * as a two-hour time log or two rupees — the exact `every 2 weeks` failure
   * `takeAmount` already guards against for a repeat this app cannot express.
   * Extraction is what makes that guard unnecessary here: masked out via
   * `maskLead` below, the number is simply never visible to either.
   *
   * Not cut into `rest` yet, because whether it survives depends on `kind`,
   * and `kind` is not settled until after `takeDuration` and `takeAmount` have
   * both had their turn — see the call site by `resolved`, below.
   */
  const lead = takeLead(rest)

  const fallback = defaultDay === undefined ? startOfDay(now) : startOfDay(parseISO(defaultDay))
  // A relative offset can roll past midnight, so it decides the day too. A
  // weekly repeat lands on its next matching weekday, so `standup 10am
  // weekdays` typed on a Saturday sits on Monday rather than today.
  //
  // Counted from `fallback`, not from today: the day being viewed is where an
  // entry lands when no date is typed, and a repeat is no exception. Measuring
  // from today put a standup set up while looking at Monday the 14th onto
  // Friday the 11th, which is the one rule `defaultDay` exists to state.
  const occurredOn =
    date?.value ??
    (relative
      ? startOfDay(relative.value)
      : repeat
        ? soonestOf(repeat.value, fallback, time?.value ?? null, now)
        : fallback)

  // Recomputed fresh before each call rather than once: an earlier cut can
  // shift where the lead phrase sits, and a stale mask would blank the wrong
  // characters — or none at all — in whatever `rest` has become by then.
  const duration = takeDuration(rest, maskLead(rest))
  if (duration) {
    rest = duration.rest
    matched = true
    kind ??= 'time'
  }

  // A bare number is part of the title once a duration has fixed the kind.
  const amount = takeAmount(rest, duration !== null, maskLead(rest))
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

  /**
   * Commit, or release back into the title.
   *
   * A lead attaches to an event; it never creates one. Money already blocks
   * the event inference above — `kind ??= 'expense'` runs before the
   * future-date check ever gets a turn — so `500 dinner remind 1 day before`
   * is already an expense by the time this is reached, and giving the lead a
   * say here would need `alarms()`, the day totals and `query.ts` to all learn
   * the difference between money spent and money merely due. The parser
   * already keeps that distinction for free by staying quiet: refused, the
   * phrase stays in the title exactly as `every 2 weeks` does — ugly, honest,
   * and the same rule applied twice.
   *
   * Refused on a weekly repeat too. `alarms()` schedules that as a cron on a
   * fixed weekday and clock; shifting *which* weekday a lead would fire on is
   * a wider change this build does not take on, so `remind` beside `weekdays`
   * stays literal text rather than silently doing nothing once saved.
   *
   * And refused on a line with no date, time, relative moment or repeat, even
   * though `occurredOn` still resolves to *some* day — the ordinary fallback,
   * viewing today, is not itself an anchor. `call mom remind 1 hour before`
   * names nothing to be early for, and inventing "today" would arm a reminder
   * against a moment nobody stated — the same "before *what*" question
   * `RECURRING` already refuses to guess at without a date. Stricter than it
   * strictly needs to be, and the right default: an event dated today whose
   * lead has already rolled past `now` is a reminder that never fires and
   * never says so. The one exception is a `defaultDay` already in the future:
   * that is its own anchor by the *existing* "occurredOn > today" rule below,
   * with nothing about the lead grammar involved.
   *
   * `takeLead` is called again rather than reusing `lead.rest`: `duration` and
   * `amount` matched against a masked copy and never touched the lead phrase's
   * own text, so it is still sitting in `rest` untouched and this is
   * guaranteed to find it.
   */
  let committedLead: number | null = null
  if (lead !== null && resolved === 'event' && repeat === null) {
    const applied = takeLead(rest)
    if (applied !== null) {
      rest = applied.rest
      matched = true
      committedLead = applied.value
    }
  }

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

  // A weekly rule wins over the yearly one: "standup weekdays" is not an
  // anniversary even if somebody calls it a birthday standup.
  if (repeat) entry.data.rrule = weeklyRule(repeat.value)
  else if (resolved === 'event' && recurring) entry.data.rrule = 'FREQ=YEARLY'

  // Minutes, nothing summed — the same rule `data.done` and `data.rrule`
  // already follow, so this costs no column and no migration. Absent means on
  // the day, so every existing row keeps its current behaviour with no backfill.
  if (committedLead !== null) entry.data.lead = committedLead

  return entry
}

/**
 * `label: item1, item2, ...` — one line, several rows, gated behind an
 * explicit colon so nothing about a single line's reading changes. `parse()`
 * already treats `Lunch, 350.` as one entry, and an unconditional split on a
 * bare comma would break exactly that — the colon is what makes this opt-in,
 * the same way `?` opts into a question and `every` opts into a repeat.
 *
 * The label is prepended to every item and each is then read by `parse()`
 * unchanged: a date, a time or a `+` typed in the label falls out for free,
 * because each item is — textually — the same line with a different tail, and
 * the items can never disagree about what day they land on.
 *
 * The colon must be followed by whitespace, or `5:30pm: prep, snacks` reads
 * its own clock as the boundary — a clock's colon in this grammar is never
 * followed by a space, so `\s+` is what tells the two apart without having to
 * know anything about `takeTime`'s own patterns.
 *
 * Requires at least two items. A single item after the colon is not a batch —
 * `salon: 450 detan` alone reads closer to a label typed out of habit than an
 * instruction to split, and `parse()` already handles it as one entry, colon
 * and all.
 */
export function parseMulti(input: string, now: Date, defaultDay?: string): ParsedEntry[] | null {
  const split = /^(.*?):\s+(.+)$/.exec(input)
  if (split === null) return null

  const label = (split[1] ?? '').trim()
  const items = (split[2] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (items.length < 2) return null

  const parsed = items.map((item) => parse(label === '' ? item : `${label} ${item}`, now, defaultDay))
  return parsed.every((entry): entry is ParsedEntry => entry !== null) ? parsed : null
}
