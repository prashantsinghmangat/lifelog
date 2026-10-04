import { addDays } from 'date-fns'
import { clockAt, dayKey, minutes as spell, rupees } from './format'
import type { Upcoming } from './ahead'
import type { Totals } from './stats'

/**
 * What the 9pm prompt says.
 *
 * It used to ask — *"What happened today?"* — which made the app's one daily
 * touchpoint a demand and nothing else. Everything here is already on the
 * device: the figures come from `stats.ts`, tomorrow's first moment from the
 * same `ahead()` the bell reads. No query, no new column, no model.
 *
 * Pure, and `now` is injected, because the text for a night is built hours
 * before that night arrives.
 */

export type Recap = { title: string; body: string }

/**
 * The wording for a night this device cannot describe yet — and for a locked
 * app, where printing a figure would put it on the lock screen.
 */
export const GENERIC: Recap = {
  title: 'What happened today?',
  body: 'And anything you want waiting for tomorrow.',
}

/** With nothing coming, the prompt is still a prompt. */
const NO_TOMORROW = 'Anything else to add?'

export function recapBody(
  totals: Totals,
  upcoming: Upcoming[],
  now: Date,
  figures: boolean,
): Recap {
  // An entry's title is as readable over a locked phone as an amount is, so
  // suppression covers both or it covers nothing. Android decides whether a
  // notification is redacted and this app cannot overrule it (ARCHITECTURE's
  // channel-visibility finding), which leaves the words themselves as the only
  // control there is.
  if (!figures) return GENERIC

  const counted = Object.values(totals.counts).reduce((sum, count) => sum + count, 0)
  const parts: string[] = []
  // A refund-only day totals below zero and is still worth reading back.
  if (totals.paise !== 0) parts.push(rupees(totals.paise))
  if (totals.minutes > 0) parts.push(spell(totals.minutes))
  if (counted > 0) parts.push(`${counted} logged`)

  const first = firstTomorrow(upcoming, now)
  const tomorrow = first ? `Tomorrow: ${first.entry.title} · ${clockAt(first.at)}` : null

  // Nothing logged and nothing coming: report no zeroes, just ask.
  if (parts.length === 0 && !tomorrow) return GENERIC

  return {
    // The figures lead, because a collapsed notification shows the title.
    title: parts.length > 0 ? parts.join(' · ') : GENERIC.title,
    body: tomorrow ?? NO_TOMORROW,
  }
}

/**
 * Tomorrow's first moment, or null.
 *
 * `ahead()` is already sorted and already pulled back by any lead, so this is
 * a filter over it — the recap names the moment the phone will ring, the same
 * one the bell shows.
 */
function firstTomorrow(upcoming: Upcoming[], now: Date): Upcoming | null {
  const tomorrow = dayKey(addDays(now, 1))
  return upcoming.find((item) => dayKey(item.at) === tomorrow) ?? null
}
