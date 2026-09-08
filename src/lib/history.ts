import type { Entry } from '../types'

/**
 * Looking back at the same day in earlier years.
 *
 * Pure and takes the log as an argument, for the same reason the parser and the
 * query grammar do: it is a filter over rows, so it can be tested exactly. It
 * deliberately runs off the corpus already in memory rather than asking the
 * database anything — a memory layer that costs a round trip on every day
 * change would be paying for something nobody asked for.
 */

/** A previous year's version of the day being viewed. */
export type Recollection = {
  /** The full `yyyy-MM-dd`, so tapping through lands on the right day. */
  day: string
  year: string
  entries: Entry[]
}

/**
 * Within-day order: timed entries first in clock order, then untimed ones in
 * the order they were logged.
 *
 * Shared with the timeline rather than written twice — a day recalled from last
 * year listing its entries in a different order from the day itself is the kind
 * of disagreement nobody thinks to test for.
 */
export function byClock(a: Entry, b: Entry): number {
  if (a.occurred_at !== null && b.occurred_at !== null) {
    return a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0
  }
  if (a.occurred_at !== null) return -1
  if (b.occurred_at !== null) return 1
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
}

/**
 * The same calendar day in previous years, most recent first.
 *
 * Matched on month and day as text rather than by subtracting years, so 29
 * February only ever recalls another 29 February instead of quietly answering
 * with the 28th or the 1st.
 *
 * Only years already gone: an event dated next year is something ahead of you,
 * and filing it under "on this day" would make the log look like it remembers
 * the future.
 */
export function onThisDay(entries: Entry[], day: string): Recollection[] {
  const year = day.slice(0, 4)
  const monthDay = day.slice(5)
  if (monthDay.length !== 5) return []

  const years = new Map<string, Entry[]>()

  for (const entry of entries) {
    const on = entry.occurred_on
    if (on.slice(5) !== monthDay) continue

    const was = on.slice(0, 4)
    if (was >= year) continue

    const found = years.get(was)
    if (found === undefined) years.set(was, [entry])
    else found.push(entry)
  }

  return [...years.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([was, found]) => ({
      day: `${was}-${monthDay}`,
      year: was,
      entries: [...found].sort(byClock),
    }))
}
