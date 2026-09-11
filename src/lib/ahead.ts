import { parseISO } from 'date-fns'
import { done, nextOccurrence } from './events'
import type { Entry } from '../types'

/**
 * What is coming.
 *
 * The app could raise a reminder but never show you the set of them, so the
 * only way to find out what the phone was going to do was to wait for it. This
 * is a filter over rows already in memory — no query, no new column, and no
 * expansion: a weekly standup contributes its *next* occurrence, one line, not
 * one line per weekday between here and the horizon.
 */

/** How far ahead is worth calling "coming up". */
const HORIZON_DAYS = 14

export type Upcoming = { entry: Entry; at: Date }

/** The clock an occurrence happens at — 9am when the entry carries no time. */
function moment(entry: Entry, day: Date): Date {
  const at = entry.occurred_at === null ? null : parseISO(entry.occurred_at)
  const when = new Date(day)
  when.setHours(at?.getHours() ?? 9, at?.getMinutes() ?? 0, 0, 0)
  return when
}

export function ahead(entries: Entry[], now: Date, horizon = HORIZON_DAYS): Upcoming[] {
  const until = new Date(now)
  until.setDate(until.getDate() + horizon)

  const found: Upcoming[] = []

  for (const entry of entries) {
    // Ticked off means it is not coming, the same way it means silent.
    if (done(entry)) continue

    const day = nextOccurrence(entry, now)
    if (day === null) continue

    const at = moment(entry, day)
    if (at <= now || at > until) continue

    found.push({ entry, at })
  }

  return found.sort((a, b) => a.at.getTime() - b.at.getTime())
}
