import { parseISO, startOfDay } from 'date-fns'
import { dayKey } from './format'
import type { Entry } from '../types'

/**
 * Where an event sits relative to now. Pure and `now`-injected like the parser,
 * so both answers can be tested exactly rather than sampled.
 */

/**
 * When an event happens next.
 *
 * A birthday logged on 13 February is in the past for most of the year, so the
 * date on the row is the wrong answer — `data.rrule` makes it an anniversary,
 * and the useful answer is the next one. Asking "when is Deepak's birthday" in
 * September should say February, not report an entry from seven months ago.
 */
export function nextOccurrence(entry: Entry, now: Date): Date | null {
  if (entry.kind !== 'event') return null

  const on = parseISO(entry.occurred_on)
  const today = startOfDay(now)

  if (entry.data.rrule === 'FREQ=YEARLY') {
    const thisYear = new Date(today.getFullYear(), on.getMonth(), on.getDate())
    return thisYear >= today
      ? thisYear
      : new Date(today.getFullYear() + 1, on.getMonth(), on.getDate())
  }

  // A one-off that has passed has no next.
  return on >= today ? on : null
}

/**
 * The moment has gone by, so the timeline can stop presenting it as something
 * still ahead. Derived from the clock rather than stored: a reminder does not
 * need to be ticked off to have happened, and asking for a tap would put a step
 * in front of the one thing this app is for.
 *
 * Never true of a recurring event — a birthday is not something you finish —
 * and never true without a time until the day itself is over, so a birthday
 * today does not read as done from 9am onwards.
 */
export function passed(entry: Entry, now: Date): boolean {
  if (entry.kind !== 'event') return false
  if (entry.data.rrule === 'FREQ=YEARLY') return false
  if (entry.occurred_at !== null) return parseISO(entry.occurred_at) < now
  return entry.occurred_on < dayKey(now)
}
