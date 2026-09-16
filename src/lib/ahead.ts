import { done, nextFireAt } from './events'
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

export function ahead(entries: Entry[], now: Date, horizon = HORIZON_DAYS): Upcoming[] {
  const until = new Date(now)
  until.setDate(until.getDate() + horizon)

  const found: Upcoming[] = []

  for (const entry of entries) {
    // Ticked off means it is not coming, the same way it means silent.
    if (done(entry)) continue

    // Already past is `nextFireAt`'s own answer now — null, not a stale moment.
    const at = nextFireAt(entry, now)
    if (at === null || at > until) continue

    found.push({ entry, at })
  }

  return found.sort((a, b) => a.at.getTime() - b.at.getTime())
}
