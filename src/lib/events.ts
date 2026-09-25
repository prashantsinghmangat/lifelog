import { parseISO, startOfDay } from 'date-fns'
import { dayKey } from './format'
import type { Entry } from '../types'

/**
 * Where an event sits relative to now. Pure and `now`-injected like the parser,
 * so both answers can be tested exactly rather than sampled.
 */

/**
 * An all-day event has no clock, so it happens at 9am — the hour the alarms use
 * and the one the exported `.ics` triggers at.
 */
export const ALL_DAY_HOUR = 9

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
/**
 * `2 hours`, `1 week` — the largest whole unit a lead (in minutes) divides
 * into. Shared between `repeatLabel` and the editor's chip so a stored value
 * is never described two ways: that drift is exactly what happened once
 * already between this file and `AheadSheet`'s own copy of the repeat wording.
 */
export function leadWords(minutes: number): string {
  const units: [number, string][] = [
    [60 * 24 * 30, 'month'],
    [60 * 24 * 7, 'week'],
    [60 * 24, 'day'],
    [60, 'hour'],
    [1, 'minute'],
  ]
  for (const [size, name] of units) {
    if (minutes % size === 0) {
      const count = minutes / size
      return `${count} ${name}${count === 1 ? '' : 's'}`
    }
  }
  // Unreachable — the 1-minute unit always divides — but a total function
  // needs no comment explaining why its last branch never runs by surprise.
  return `${minutes} minutes`
}

/**
 * The repeat alone, with no lead folded in — what `EntryEditor` needs to
 * decide whether "Stop repeating" applies at all. `repeatLabel` below returns
 * non-null for a lead on its own, which is correct for a row's caption and
 * wrong for a control that offers to turn a repeat off: an entry with only a
 * lead has no repeat to stop.
 */
export function repeatOnly(entry: Entry): string | null {
  const weekly = weeklyDays(entry)
  if (weekly === null) return entry.data.rrule === 'FREQ=YEARLY' ? 'every year' : null

  const days = [...new Set(weekly)].sort((a, b) => a - b)
  if (days.length === 5 && days.every((day, i) => day === i + 1)) return 'weekdays'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `every ${days.map((day) => names[day]).join(', ')}`
}

export function repeatLabel(entry: Entry): string | null {
  const base = repeatOnly(entry)

  // A lead never lands on a weekly repeat — the parser refuses that
  // combination — but reads it off the entry rather than assuming, so a row
  // stays honest even if `data.lead` ever gets there some other way.
  const lead =
    typeof entry.data.lead === 'number' && entry.data.lead > 0
      ? `reminder ${leadWords(entry.data.lead)} before`
      : null

  const bits = [base, lead].filter((bit): bit is string => bit !== null)
  return bits.length === 0 ? null : bits.join(' · ')
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
    /**
     * A year the date does not exist in is not a year it happens in.
     *
     * 29 February is the only such date, and the rest of the app had already
     * decided what it means: `occurrencesOn` and `onThisDay` both match the
     * month and day *as text*, so a leap-day anniversary is drawn on 29
     * February and nowhere else, and an exported `FREQ=YEARLY` from a 29
     * February start recurs only in leap years by RFC 5545. This function was
     * the one place that disagreed — and not by decision: `new Date(2027, 1,
     * 29)` silently rolls to 1 March. So the bell said 1 March, the alarm rang
     * on 1 March, and the timeline drew nothing there.
     *
     * Rejecting the rolled-over date is not a new rule, it is the existing one
     * applied here. The cost is that a leap-day birthday reminds you every four
     * years, which is what the date means and what the OS calendar already does
     * with the same entry. Eight years of headroom covers the century gap,
     * where 1896 is followed by 1904.
     */
    for (let ahead = 0; ahead <= 8; ahead += 1) {
      const at = new Date(today.getFullYear() + ahead, on.getMonth(), on.getDate())
      if (at.getMonth() !== on.getMonth() || at.getDate() !== on.getDate()) continue
      if (at >= today) return at
    }
    return null
  }

  // A one-off that has passed has no next.
  return on >= today ? on : null
}

/**
 * The next moment this entry actually happens: its next occurrence, at its own
 * clock, or 9am when it carries none.
 *
 * `nextOccurrence` answers with a *day*, and gluing a time onto that day was
 * being done separately in `ahead`, in the yearly branch of `alarms`, and — the
 * reason this exists — in the editor, which is the first place that has to *say*
 * the answer out loud rather than act on it. A fourth copy would eventually have
 * disagreed with the other three about what an entry with no clock means, and
 * the disagreement would have been a reminder that rang at a time the app had
 * never shown anybody.
 *
 * Says nothing about whether the reminder is *armed* — a done entry still has a
 * next occurrence, it just does not ring. `fireAt` and `alarms` remain the choke
 * point for that, so silencing stays one decision made in one place.
 *
 * A moment that has gone is not a next one. `nextOccurrence` answers with a day
 * and can hand back *today* for a reminder that rang this morning, which is
 * correct of a day and wrong of a moment — it is why `alarms` drops a yearly
 * `when <= now` and `ahead` drops an `at <= now`. The same rule belongs here,
 * once, rather than in each of the three callers that would otherwise have to
 * remember it.
 */
export function nextFireAt(entry: Entry, now: Date): Date | null {
  const day = nextOccurrence(entry, now)
  if (day === null) return null

  const at = entry.occurred_at === null ? null : parseISO(entry.occurred_at)
  const when = new Date(day)
  when.setHours(at?.getHours() ?? ALL_DAY_HOUR, at?.getMinutes() ?? 0, 0, 0)
  return when <= now ? null : when
}

/**
 * A moment, pulled back by however many minutes `data.lead` asks for. Absent,
 * zero or not a number means on the day: `at` comes back unchanged. Shared by
 * `reminderAt` here and by `fireAt` in `reminders.ts`, so the one arithmetic —
 * what a lead actually does to a moment — is written once rather than kept in
 * step across two files by hand.
 */
export function withLead(entry: Entry, at: Date): Date {
  const lead = entry.data.lead
  if (typeof lead !== 'number' || !Number.isFinite(lead) || lead <= 0) return at
  return new Date(at.getTime() - lead * 60_000)
}

/**
 * The moment the phone will actually raise a notification for — `nextFireAt`
 * pulled back by any lead. This is what `alarms()` schedules the one-off and
 * yearly cases against, and what the bell in `ahead.ts` sorts and displays.
 *
 * Deliberately a second answer from `nextFireAt`'s, not a replacement for it.
 * `passed()` keeps querying the event's own moment on purpose: a warranty
 * whose reminder fired last week but which expires tomorrow is not behind
 * you, and a row must not strike through because the phone already rang.
 * These two are supposed to disagree — see the note beside `passed`.
 *
 * A moment that has gone by is not a next one, the same rule `nextFireAt`
 * itself already states — reapplied here because pulling a moment backwards
 * can put it in the past even when the event's own moment is still ahead.
 */
export function reminderAt(entry: Entry, now: Date): Date | null {
  const at = nextFireAt(entry, now)
  if (at === null) return null
  const shifted = withLead(entry, at)
  return shifted <= now ? null : shifted
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
 *
 * **Deliberately blind to a lead.** This answers about the event's own
 * moment, not the moment `reminderAt` fires at — a warranty whose reminder
 * rang last week but which expires tomorrow is not behind you, so it must not
 * strike through early. Reads like the two ought to agree; they are supposed
 * not to.
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
