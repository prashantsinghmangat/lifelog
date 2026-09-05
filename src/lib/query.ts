import { addDays, format, parseISO, startOfDay, subDays, subMonths, subYears } from 'date-fns'
import { dayKey, minutes as durationText, rupees } from './format'
import type { Entry } from '../types'

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

/** Which number the question is really after. */
export type Measure = 'days' | 'times' | 'money' | 'hours'

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
  /** Most recent matching day, which is usually the thing worth knowing. */
  last: string | null
}

/** Words that carry no subject: question scaffolding, and the measures themselves. */
const NOISE = new Set([
  'how', 'many', 'much', 'often', 'total', 'count', 'number', 'of',
  'day', 'days', 'time', 'times', 'hour', 'hours', 'hrs',
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

export function summarise(entries: Entry[], question: Question): Summary {
  const hits = entries.filter(
    (entry) => within(entry, question.range) && matches(entry, question.terms),
  )

  const days = new Set(hits.map((entry) => entry.occurred_on))
  const paise = hits.reduce((total, entry) => total + (entry.amount_paise ?? 0), 0)
  const mins = hits.reduce((total, entry) => total + (entry.duration_minutes ?? 0), 0)
  const last = [...days].sort().pop() ?? null

  return { entries: hits.length, days: days.size, paise, minutes: mins, last }
}

/**
 * One line, leading with whatever was asked for and following with the other
 * facts that happen to be true. A question the grammar did not understand still
 * gets a count rather than an apology.
 */
export function phrase(summary: Summary, question: Question, now: Date): string {
  if (summary.entries === 0) return 'nothing found'

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const parts: string[] = []

  const money = summary.paise > 0 ? rupees(summary.paise) : null
  const time = summary.minutes > 0 ? durationText(summary.minutes) : null

  switch (question.measure) {
    case 'days':
      parts.push(plural(summary.days, 'day'))
      break
    case 'times':
      parts.push(plural(summary.entries, 'time'))
      break
    case 'money':
      parts.push(money ?? '₹0')
      break
    case 'hours':
      parts.push(time ?? '0m')
      break
    default:
      parts.push(plural(summary.entries, 'entry').replace('entrys', 'entries'))
      parts.push(plural(summary.days, 'day'))
  }

  if (question.measure !== 'money' && money !== null) parts.push(money)
  if (question.measure !== 'hours' && time !== null) parts.push(time)

  if (summary.last !== null) {
    const gap = Math.round(
      (startOfDay(now).getTime() - parseISO(summary.last).getTime()) / 86_400_000,
    )
    const when =
      gap <= 0 ? 'today' : gap === 1 ? 'yesterday' : format(parseISO(summary.last), 'd MMM')
    parts.push(`last ${when}`)
  }

  return parts.join(' · ')
}

/** The window a question needs loaded, so a query does not fetch the whole log. */
export function windowFor(question: Question, now: Date): { from: string; to: string } {
  if (question.range !== null) return { from: question.range.from, to: question.range.to }
  // No period named means all of it; a year back covers any realistic answer.
  return { from: dayKey(subYears(startOfDay(now), 5)), to: dayKey(addDays(startOfDay(now), 365)) }
}
