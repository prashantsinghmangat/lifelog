import { parseISO, startOfDay } from 'date-fns'
import { dayKey } from './format'
import type { Entry } from '../types'

/**
 * Where an event sits relative to now. Pure and `now`-injected like the parser,
 * so both answers can be tested exactly rather than sampled.
 */

/**
 * The weekdays a weekly rule fires on, as `Date.getDay()` numbers, or null when
 * the entry does not repeat weekly.
 *
 * Stored as an RRULE rather than five rows. "No recurring event expansion" is
 * the rule this respects: one row means one thing to edit, one thing to delete
 * and one line in the log, however many times it rings.
 */
export function weeklyDays(entry: Entry): number[] | null {
  const rule = entry.data.rrule
  if (typeof rule !== 'string' || !rule.startsWith('FREQ=WEEKLY')) return null

  const byDay = /BYDAY=([A-Z,]+)/.exec(rule)?.[1]
  if (byDay === undefined) return null

  const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const days = byDay
    .split(',')
    .map((code) => codes.indexOf(code))
    .filter((day) => day >= 0)

  return days.length === 0 ? null : days
}

/** Yearly or weekly — either way, its date is not the last word on when it happens. */
export function recurring(entry: Entry): boolean {
  return entry.data.rrule === 'FREQ=YEARLY' || weeklyDays(entry) !== null
}

/**
 * The repeat in words, and the only place those words are chosen.
 *
 * Because a repeat is stored once and expanded nowhere, the row on Friday is the
 * *only* evidence that a standup also rings on Monday. Showing the clock and
 * nothing else made a five-day repeat indistinguishable from a one-off, so the
 * feature worked and looked like it had not — which is the same failure as a
 * silent reminder, one step earlier.
 */
export function repeatLabel(entry: Entry): string | null {
  const weekly = weeklyDays(entry)
  if (weekly === null) return entry.data.rrule === 'FREQ=YEARLY' ? 'every year' : null

  const days = [...new Set(weekly)].sort((a, b) => a - b)
  if (days.length === 5 && days.every((day, i) => day === i + 1)) return 'weekdays'

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `every ${days.map((day) => names[day]).join(', ')}`
}

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

  const weekly = weeklyDays(entry)
  if (weekly !== null) {
    // The row's date is where the repeat *starts*, not decoration. Scanning
    // from today regardless meant a standup set up to begin on Monday the 14th
    // answered with Friday the 11th and rang three days before it existed —
    // the row said one thing and the phone did another.
    const from = on > today ? on : today

    // The soonest listed weekday from there, that day included: a standup at
    // ten is still today's standup at nine in the morning.
    for (let ahead = 0; ahead < 8; ahead += 1) {
      const candidate = new Date(from)
      candidate.setDate(candidate.getDate() + ahead)
      if (!weekly.includes(candidate.getDay())) continue
      if (ahead > 0) return candidate
      // The first candidate only counts while its time has not gone by. Built
      // from the candidate rather than from today, or a repeat starting on a
      // future weekday is tested against today's clock and skipped a week.
      const at = entry.occurred_at === null ? null : parseISO(entry.occurred_at)
      const due = new Date(candidate)
      due.setHours(at?.getHours() ?? 9, at?.getMinutes() ?? 0, 0, 0)
      if (due >= now) return candidate
    }
    return null
  }

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
  // Nothing that repeats is ever behind you: a birthday is not something you
  // finish, and neither is a standup that rings again on Monday.
  if (recurring(entry)) return false
  if (entry.occurred_at !== null) return parseISO(entry.occurred_at) < now
  return entry.occurred_on < dayKey(now)
}

/**
 * Ticked off by hand.
 *
 * `passed` covers the reminder whose moment has simply gone by, which needs no
 * tap — but a note saying "send the revised scope" is done when you decide it
 * is, and nothing about the clock can know that. So this is the one piece of
 * state in the app the user sets rather than the parser or the clock.
 *
 * It lives in `data` rather than a column because nothing sums it, which is the
 * rule the schema already states — and so it costs no migration.
 */
export function done(entry: Entry): boolean {
  return entry.data.done === true
}

/** Struck through in the timeline: either the moment went by, or you said so. */
export function behindYou(entry: Entry, now: Date): boolean {
  return done(entry) || passed(entry, now)
}
