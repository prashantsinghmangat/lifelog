import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
  subDays,
  subMonths,
  subYears,
} from 'date-fns'
import { nextOccurrence } from './events'
import { dayKey, daySpan, minutes as durationText, rupees } from './format'
import { dateIn } from './parser'
import type { Entry } from '../types'

/** How far either side of a remembered date to look. Memory is not exact. */
const AROUND = 3

/**
 * Answering questions about the log, without an LLM.
 *
 * Pure and `now`-injected like the parser, and for the same reason: the answers
 * are arithmetic over rows, so they can be tested exactly rather than sampled.
 *
 * The grammar is deliberately small. It reads the shape of a question — what is
 * being asked about, over what period, and which number is wanted — and ignores
 * everything else, so a phrase it has never seen still answers something useful
 * instead of nothing.
 */

/** Which answer the question is really after. */
export type Measure = 'days' | 'times' | 'money' | 'hours' | 'when'

export type Range = { from: string; to: string; label: string }

export type Question = {
  terms: string[]
  range: Range | null
  measure: Measure | null
}

export type Summary = {
  entries: number
  days: number
  paise: number
  minutes: number
  /** Earliest matching day, which is what makes a total a span rather than a number. */
  first: string | null
  /** Most recent matching day, which is usually the thing worth knowing. */
  last: string | null
  /** Soonest upcoming occurrence, which for an event is the whole answer. */
  next: string | null
  /** The rows the numbers were computed from, so an answer can show its working. */
  hits: Entry[]
}

/**
 * One of the facts beside the lead.
 *
 * Labelled, because `₹293` beside a total is ambiguous and `avg ₹293` reads as
 * an abbreviation rather than a heading. A null label is for the facts that name
 * themselves — `tomorrow`, `8 entries` — where a label would be noise.
 */
export type Extra = { label: string | null; value: string }

/** An extra as one piece of text, for the sentence a screen reader hears. */
export function extraText(extra: Extra): string {
  return extra.label === null ? extra.value : `${extra.label} ${extra.value}`
}

/**
 * An answer with its parts kept separate, so the screen can lay them out and a
 * screen reader can still hear one sentence. `phrase` joins these back together
 * rather than deciding anything of its own, which is what stops the two from
 * ever disagreeing about what was asked.
 */
export type Answer = {
  /** What the question was about: `food · this week`, or null if it named neither. */
  caption: string | null
  /** The one thing asked for, and the only part that is always present. */
  lead: string
  /** The other facts that happen to be true. */
  extras: Extra[]
  /** Every match, ordered for display. */
  rows: Entry[]
  /** The question named a single day, so rows show a clock rather than a date. */
  oneDay: boolean
  /**
   * Rows are in day order, so the card can lift each date into a heading
   * instead of repeating it down a column.
   *
   * Not derived from `oneDay` in the card, because an answer about what is
   * *coming* is ordered by next occurrence rather than by `occurred_on` — a
   * yearly birthday logged in 2010 sorts first while its date sorts last. Group
   * that and the same heading can appear twice, which reads as a bug. Those
   * answers carry their date on the row instead.
   */
  grouped: boolean
}

/** Words that carry no subject: question scaffolding, and the measures themselves. */
const NOISE = new Set([
  'how', 'many', 'much', 'often', 'total', 'count', 'number', 'of',
  'day', 'days', 'time', 'times', 'hour', 'hours', 'hrs',
  'when', 'what', 'date', 'next', 'upcoming', 'due', 'coming',
  'around', 'about', 'near', 'happened', 'happen',
  'did', 'do', 'does', 'have', 'has', 'had', 'was', 'were', 'is', 'are', 'am',
  'i', 'my', 'me', 'we', 'the', 'a', 'an', 'to', 'on', 'at', 'in', 'for', 'from',
  'spend', 'spent', 'spending', 'go', 'gone', 'went', 'visit', 'visited',
  'log', 'logged', 'work', 'worked', 'this', 'last', 'past', 'ago', 'been',
])

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function range(from: Date, to: Date, label: string): Range {
  return { from: dayKey(from), to: dayKey(to), label }
}

/**
 * Pulls a period out of the question and returns what is left.
 *
 * Ranges are inclusive of both ends, because "last month" plainly includes the
 * last day of last month.
 */
export function periodOf(text: string, now: Date): { range: Range | null; rest: string } {
  const today = startOfDay(now)
  const strip = (pattern: RegExp, made: Range) => ({
    range: made,
    rest: text.replace(pattern, ' '),
  })

  if (/\btoday\b/i.test(text)) return strip(/\btoday\b/i, range(today, today, 'today'))
  if (/\byesterday\b/i.test(text)) {
    const then = subDays(today, 1)
    return strip(/\byesterday\b/i, range(then, then, 'yesterday'))
  }

  if (/\bthis\s+week\b/i.test(text)) {
    return strip(/\bthis\s+week\b/i, range(subDays(today, 6), today, 'this week'))
  }
  if (/\blast\s+week\b/i.test(text)) {
    return strip(/\blast\s+week\b/i, range(subDays(today, 13), subDays(today, 7), 'last week'))
  }
  if (/\bthis\s+month\b/i.test(text)) {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return strip(/\bthis\s+month\b/i, range(first, today, 'this month'))
  }
  if (/\blast\s+month\b/i.test(text)) {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return strip(/\blast\s+month\b/i, range(first, last, 'last month'))
  }
  if (/\bthis\s+year\b/i.test(text)) {
    const first = new Date(now.getFullYear(), 0, 1)
    return strip(/\bthis\s+year\b/i, range(first, today, 'this year'))
  }

  const days = /\b(?:last|past)\s+(\d+)\s+days?\b/i.exec(text)
  if (days?.[1] !== undefined) {
    const count = Number(days[1])
    return strip(
      /\b(?:last|past)\s+\d+\s+days?\b/i,
      range(subDays(today, count - 1), today, `last ${count} days`),
    )
  }

  const months = /\b(?:last|past)\s+(\d+)\s+months?\b/i.exec(text)
  if (months?.[1] !== undefined) {
    const count = Number(months[1])
    return strip(
      /\b(?:last|past)\s+\d+\s+months?\b/i,
      range(subMonths(today, count), today, `last ${count} months`),
    )
  }

  if (/\blast\s+year\b/i.test(text)) {
    return strip(/\blast\s+year\b/i, range(subYears(today, 1), today, 'last year'))
  }

  // "around 20 august", "about last friday" — a window, because memory is
  // vague about the exact day and a single date usually answers nothing.
  const near = /\b(?:around|about|near)\s+/i
  if (near.test(text)) {
    const found = dateIn(text.replace(near, ' '), now)
    if (found !== null) {
      const at = startOfDay(found.at)
      return {
        range: range(subDays(at, AROUND), addDays(at, AROUND), `around ${format(at, 'd MMM')}`),
        rest: found.rest,
      }
    }
  }

  // Any single date the parser understands: last saturday, 14 nov, 14/11,
  // 3 days ago. Reused rather than reimplemented, so the two never disagree.
  // Ahead of the bare month below, or "20 august" loses its day to the month.
  const one = dateIn(text, now)
  if (one !== null) {
    const at = startOfDay(one.at)
    return { range: range(at, at, format(at, 'EEEE d MMM')), rest: one.rest }
  }

  // A bare month name means the most recent one that has already started.
  for (const [index, name] of MONTHS.entries()) {
    const pattern = new RegExp(`\\b${name}\\b`, 'i')
    if (!pattern.test(text)) continue
    const year = index > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
    const first = new Date(year, index, 1)
    const last = new Date(year, index + 1, 0)
    return strip(pattern, range(first, last, `${name[0]?.toUpperCase()}${name.slice(1)} ${year}`))
  }

  return { range: null, rest: text }
}

function measureOf(text: string): Measure | null {
  // Checked first: "when is the next gym session" is asking for a date, not a count.
  if (/\bwhen\b|\bwhat\s+date\b|\bnext\b|\bupcoming\b|\bdue\b/i.test(text)) return 'when'
  if (/\bhow\s+many\s+days?\b|\bdays?\b/i.test(text)) return 'days'
  if (/\bhow\s+(?:many\s+)?(?:times|often)\b/i.test(text)) return 'times'
  if (/\bhow\s+much\b|\bspen[dt]\b|\btotal\b|\bcost\b/i.test(text)) return 'money'
  if (/\bhours?\b|\bhrs?\b|\bhow\s+long\b/i.test(text)) return 'hours'
  return null
}

/** `?` prefixed input is a question. Returns null when nothing was asked. */
export function parseQuestion(input: string, now: Date): Question | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('?')) return null

  const asked = trimmed.slice(1).trim()
  const measure = measureOf(asked)
  const { range: period, rest } = periodOf(asked, now)

  const terms = rest
    .toLowerCase()
    .split(/[^a-z0-9₹]+/i)
    .filter((word) => word !== '' && !NOISE.has(word))

  return { terms, range: period, measure }
}

function matches(entry: Entry, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = `${entry.title} ${entry.category ?? ''} ${entry.kind}`.toLowerCase()
  // Every term must appear, so "deepak kiran store" does not match "deepak" alone.
  return terms.every((term) => haystack.includes(term))
}

function within(entry: Entry, period: Range | null): boolean {
  if (period === null) return true
  return entry.occurred_on >= period.from && entry.occurred_on <= period.to
}

/**
 * A question about money is a question about the entries carrying money.
 *
 * "How much did I spend today" counted the day's two expenses correctly and
 * then listed all seven entries beside the total, notes and time logs included
 * — none of which put anything into the number they appeared to explain. A
 * total and its working have to be the same set of rows.
 *
 * Only the measures that read one field narrow: counting days is a question
 * about every match, whatever each one happens to carry.
 */
function counts(entry: Entry, measure: Measure | null): boolean {
  if (measure === 'money') return entry.amount_paise !== null
  if (measure === 'hours') return entry.duration_minutes !== null
  return true
}

export function summarise(entries: Entry[], question: Question, now: Date): Summary {
  const hits = entries.filter(
    (entry) =>
      within(entry, question.range) &&
      matches(entry, question.terms) &&
      counts(entry, question.measure),
  )

  const days = new Set(hits.map((entry) => entry.occurred_on))
  const paise = hits.reduce((total, entry) => total + (entry.amount_paise ?? 0), 0)
  const mins = hits.reduce((total, entry) => total + (entry.duration_minutes ?? 0), 0)
  const ordered = [...days].sort()
  const last = ordered[ordered.length - 1] ?? null
  const first = ordered[0] ?? null

  const upcoming = hits
    .map((entry) => nextOccurrence(entry, now))
    .filter((at): at is Date => at !== null)
    .sort((a, b) => a.getTime() - b.getTime())

  return {
    entries: hits.length,
    days: days.size,
    paise,
    minutes: mins,
    first,
    last,
    next: upcoming[0] === undefined ? null : dayKey(upcoming[0]),
    hits,
  }
}

/** Most recent first, which is the order a question about the past wants. */
function byRecency(entries: Entry[]): Entry[] {
  return [...entries].sort(
    (a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) ||
      (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''),
  )
}

/** Soonest first, for an answer that is about what is coming rather than gone. */
function byNext(entries: Entry[], now: Date): Entry[] {
  return [...entries].sort((a, b) => {
    const first = nextOccurrence(a, now)
    const second = nextOccurrence(b, now)
    if (first === null) return second === null ? 0 : 1
    if (second === null) return -1
    return first.getTime() - second.getTime()
  })
}

/**
 * Leads with whatever was asked for and follows with the other facts that happen
 * to be true. A question the grammar did not understand still gets a count rather
 * than an apology.
 */
export function answer(summary: Summary, question: Question, now: Date): Answer {
  const named = [
    question.terms.length > 0 ? question.terms.join(' ') : null,
    question.range === null ? null : question.range.label,
  ].filter((bit): bit is string => bit !== null)

  const caption = named.length === 0 ? null : named.join(' · ')
  const oneDay = question.range !== null && question.range.from === question.range.to
  const nothing = { caption, extras: [], rows: [], oneDay, grouped: false }

  if (summary.entries === 0) return { ...nothing, lead: 'nothing found' }

  // A date beats a tally. If something is coming up, that is the answer —
  // whether or not the question remembered to say "when".
  //
  // But only about *something*. Without a subject, "what happened around 6
  // September" was answered with "Tuesday 8 September" and a list ordered by
  // next occurrence: a question explicitly about the past, answered with an
  // upcoming reminder that merely fell inside the window. Naming a subject is
  // what makes an upcoming date the answer; `when` asked outright still is.
  const dateLeads =
    summary.next !== null &&
    (question.measure === 'when' || (question.measure === null && question.terms.length > 0))

  if (dateLeads && summary.next !== null) {
    const at = parseISO(summary.next)
    const away = differenceInCalendarDays(at, startOfDay(now))
    const soon = away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away} days`
    const shown = at.getFullYear() === now.getFullYear() ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy'
    return {
      caption,
      lead: format(at, shown),
      extras: [{ label: null, value: soon }],
      rows: byNext(summary.hits, now),
      oneDay,
      // Ordered by next occurrence, not by date — see `grouped`.
      grouped: false,
    }
  }

  // Asked when, and nothing is ahead. The rows still stand: what did happen is
  // more use than a dead end.
  if (question.measure === 'when') {
    return {
      ...nothing,
      lead: 'nothing upcoming',
      rows: byRecency(summary.hits),
      grouped: !oneDay,
    }
  }

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const entryCount = `${summary.entries} ${summary.entries === 1 ? 'entry' : 'entries'}`
  const money = summary.paise > 0 ? rupees(summary.paise) : null
  const time = summary.minutes > 0 ? durationText(summary.minutes) : null
  const extras: Extra[] = []
  let lead: string

  // An average over a single row is that row, so it explains nothing the row
  // does not already say.
  const many = summary.entries > 1

  /**
   * The answer is "which days", so the span leads instead of a tally.
   *
   * Only with no subject *and* no measure: both of those turn the question into
   * one about a quantity, and the quantity has to lead. The span is taken from
   * the rows rather than from the period asked about — "around 4 September" is
   * a seven-day window, but the days that actually hold something are what
   * happened.
   */
  const spanning =
    question.measure === null &&
    question.terms.length === 0 &&
    !oneDay &&
    summary.first !== null &&
    summary.last !== null &&
    summary.first !== summary.last

  switch (question.measure) {
    case 'days':
      lead = plural(summary.days, 'day')
      break
    case 'times':
      lead = plural(summary.entries, 'time')
      break
    case 'money':
      lead = money ?? '₹0'
      // A total on its own hides its shape: ₹2,340 is a very different week
      // across two entries than across twenty.
      extras.push({ label: null, value: entryCount })
      if (many) {
        // Whole rupees. Money is stored as paise and printed with paise
        // whenever they are non-zero, which is right for an amount somebody
        // typed and wrong for a derived one: `avg ₹684.29` offers two decimal
        // places of precision on a figure that is inherently rough.
        extras.push({
          label: 'avg',
          value: rupees(Math.round(summary.paise / summary.entries / 100) * 100),
        })
      }
      break
    case 'hours':
      lead = time ?? '0m'
      extras.push({ label: null, value: entryCount })
      if (many) {
        extras.push({
          label: 'avg',
          value: durationText(Math.round(summary.minutes / summary.entries)),
        })
      }
      break
    default:
      // "What happened around 20 August" is a question about *when*, and a
      // count is not an answer to it. With no subject and no measure asked
      // for, the days that actually hold something are the answer, and the
      // count becomes one of the facts about them. A subject changes that:
      // "gym this month" is asking how much gym, so the tally leads again.
      if (spanning) {
        lead = daySpan(summary.first ?? '', summary.last ?? '', now)
        extras.push({ label: null, value: `${entryCount} over ${plural(summary.days, 'day')}` })
      } else {
        lead = entryCount
        extras.push({ label: null, value: plural(summary.days, 'day') })
      }
  }

  if (question.measure !== 'money' && money !== null) {
    extras.push({ label: null, value: money })
  }
  if (question.measure !== 'hours' && time !== null) {
    extras.push({ label: null, value: time })
  }

  // The span the number covers. Only when the matches actually straddle more
  // than one day: otherwise "first" and "last" are the same date said twice —
  // and never when the lead is already that span.
  if (!spanning && summary.first !== null && summary.first !== summary.last) {
    extras.push({ label: 'first', value: format(parseISO(summary.first), 'd MMM') })
  }

  if (!spanning && summary.last !== null) {
    const gap = Math.round(
      (startOfDay(now).getTime() - parseISO(summary.last).getTime()) / 86_400_000,
    )
    const when =
      gap <= 0 ? 'today' : gap === 1 ? 'yesterday' : format(parseISO(summary.last), 'd MMM')
    extras.push({ label: 'last', value: when })
  }

  return { caption, lead, extras, rows: byRecency(summary.hits), oneDay, grouped: !oneDay }
}

/**
 * The same answer as one line, for the live region: a screen reader should hear
 * a sentence, not a table. Derived rather than written twice, so it can never
 * say something different from what is on screen.
 */
export function phrase(summary: Summary, question: Question, now: Date): string {
  const said = answer(summary, question, now)
  return [said.lead, ...said.extras.map(extraText)].join(' · ')
}

