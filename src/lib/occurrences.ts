import { parseISO } from 'date-fns'
import { weeklyDays } from './events'
import type { Entry } from '../types'

/**
 * The days a repeat lands on, worked out rather than stored.
 *
 * **This is not recurring event expansion.** The log still holds exactly one
 * row for a standup that rings every working day, so there is still one thing
 * to edit and one thing to delete. What is derived here is the *view*: a
 * standup that rings at ten on Tuesday has to appear on Tuesday, or the day
 * reads as empty while the phone is armed to go off.
 *
 * That gap was the whole reason a working repeat looked broken — the alarms
 * were set for Monday to Friday, the row was drawn on Monday only, and every
 * other day of the week showed nothing at all.
 */

/** A day's view of an entry that is stored under a different date. */
export type Occurrence = Entry & { occurrence: true }

/** The clock kept, the date moved to the day being viewed. */
function movedTo(entry: Entry, day: string): Occurrence {
  const at = entry.occurred_at === null ? null : parseISO(entry.occurred_at)
  if (at === null) return { ...entry, occurred_on: day, occurrence: true }

  const when = parseISO(`${day}T00:00:00`)
  when.setHours(at.getHours(), at.getMinutes(), 0, 0)
  return { ...entry, occurred_on: day, occurred_at: when.toISOString(), occurrence: true }
}

/**
 * Whether a repeat falls on `day` — never before the day it starts, which is
 * the same bound the alarms use. A standup set up to begin on the 14th does not
 * appear on the 11th any more than it rings then.
 */
function falls(entry: Entry, day: string): boolean {
  if (entry.kind !== 'event' || day < entry.occurred_on) return false

  const on = parseISO(`${day}T00:00:00`)

  const weekly = weeklyDays(entry)
  if (weekly !== null) return weekly.includes(on.getDay())

  if (entry.data.rrule !== 'FREQ=YEARLY') return false
  // Matched as text so 29 February only ever recalls another 29 February,
  // exactly as `onThisDay` does it.
  return entry.occurred_on.slice(5) === day.slice(5)
}

/**
 * Every repeat that lands on `day` but is stored under another date.
 *
 * The row already sitting on its own start date is left out, or the first day
 * of a standup would draw it twice.
 */
export function occurrencesOn(entries: Entry[], day: string): Occurrence[] {
  return entries
    .filter((entry) => entry.occurred_on !== day && falls(entry, day))
    .map((entry) => movedTo(entry, day))
}

/** True for a row this module derived, which nothing may total or count. */
export function isOccurrence(entry: Entry): boolean {
  return (entry as Partial<Occurrence>).occurrence === true
}
