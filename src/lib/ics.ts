import { addDays, addMinutes, parseISO } from 'date-fns'
import { dayKey } from './format'
import type { Entry } from '../types'

/**
 * Turns events into an iCalendar file so the operating system does the
 * reminding. No web API raises a notification while the app is closed, and a
 * calendar alarm keeps working with the app shut, the phone offline and the
 * Supabase project paused.
 *
 * Pure, and `now` is injected, so the same input always produces the same bytes.
 */

/** A timed entry is a point in time; calendars render a zero-length block badly. */
const BLOCK_MINUTES = 30

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** A Date → the UTC basic format iCalendar wants: 20261114T113000Z. */
function stamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/** yyyy-MM-dd → 20261114, for all-day events. */
function dateValue(day: string): string {
  return day.replace(/-/g, '')
}

/** Backslash, semicolon, comma and newline all carry meaning in a property value. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * RFC 5545 caps a line at 75 octets and continues it with a leading space. A
 * long title breaks strict parsers without this.
 */
function fold(line: string): string {
  if (line.length <= 75) return line

  const parts = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`)
    rest = rest.slice(74)
  }
  if (rest.length > 0) parts.push(` ${rest}`)
  return parts.join('\r\n')
}

function isYearly(entry: Entry): boolean {
  return entry.data.rrule === 'FREQ=YEARLY'
}

function alarm(title: string, trigger: string): string[] {
  return ['BEGIN:VALARM', `TRIGGER${trigger}`, 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(title)}`, 'END:VALARM']
}

function event(entry: Entry, now: Date): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${entry.id}@lifelog`, `DTSTAMP:${stamp(now)}`]

  if (entry.occurred_at !== null) {
    const at = parseISO(entry.occurred_at)
    lines.push(`DTSTART:${stamp(at)}`, `DTEND:${stamp(addMinutes(at, BLOCK_MINUTES))}`)
    // "Notify me at 4pm" means 4pm, so the alarm sits on the start.
    lines.push(...alarm(entry.title, ':-PT0M'))
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${dateValue(entry.occurred_on)}`,
      `DTEND;VALUE=DATE:${dateValue(dayKey(addDays(parseISO(entry.occurred_on), 1)))}`,
    )
    // An all-day event starts at local midnight, so +9h is 9am wherever the
    // reader is. Relative also repeats correctly every year; absolute would not.
    lines.push(...alarm(entry.title, ';RELATED=START:PT9H'))
  }

  if (isYearly(entry)) lines.push('RRULE:FREQ=YEARLY')

  lines.push(`SUMMARY:${escapeText(entry.title)}`)
  if (entry.note !== null && entry.note !== '') lines.push(`DESCRIPTION:${escapeText(entry.note)}`)
  lines.push('END:VEVENT')

  return lines
}

/**
 * What belongs in a bulk export. Only events — an expense is not something to be
 * reminded about. Past one-offs are clutter; yearly ones stay in regardless of
 * their year, because the RRULE is what makes them recur.
 *
 * Kept separate from `toIcs` so that adding one entry by hand is not second-
 * guessed by a filter.
 */
export function forCalendar(entries: Entry[], now: Date): Entry[] {
  const today = dayKey(now)
  return entries.filter(
    (entry) => entry.kind === 'event' && (isYearly(entry) || entry.occurred_on >= today),
  )
}

export function toIcs(entries: Entry[], now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lifelog//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:lifelog',
    ...entries.flatMap((entry) => event(entry, now)),
    'END:VCALENDAR',
  ]

  // CRLF is required, not stylistic.
  return `${lines.map(fold).join('\r\n')}\r\n`
}
