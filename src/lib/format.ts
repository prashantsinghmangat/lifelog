import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { Entry } from '../types'

/**
 * What the columns can actually hold.
 *
 * `amount_paise` and `duration_minutes` are Postgres `integer`. A value past
 * that is written to this device happily and then refused by the server for
 * ever with `22003` — a row that looks saved, totals into the day, and can
 * never sync, with a Retry chip that cannot work. The ceiling therefore belongs
 * here, beside the only other place that knows money is paise, so the parser
 * and the editor cannot come to disagree about it.
 *
 * ₹21,474,836.47. Raising it is a `bigint` migration, not a change here.
 */
const INT4_MAX = 2_147_483_647
const INT4_MIN = -2_147_483_648

export const MAX_PAISE = INT4_MAX

/** Whether an amount in paise is one the server will accept. */
export function amountFits(paise: number): boolean {
  return Number.isInteger(paise) && paise >= INT4_MIN && paise <= INT4_MAX
}

/** The same ceiling, for the other integer column. Minutes are never negative. */
export function minutesFit(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= INT4_MAX
}

/** The only place paise become a string. 34750 → "₹347.50", 35000 → "₹350". */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const whole = Math.trunc(abs / 100).toLocaleString('en-IN')
  const rest = abs % 100
  return `${sign}₹${whole}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`
}

/** The inverse, for the editor. "347.5" → 34750. Empty or unreadable input → null. */
export function paiseFrom(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

/** 90 → "1h 30m", 45 → "45m", 120 → "2h". */
export function minutes(total: number): string {
  const h = Math.trunc(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * A moment → "5:00 pm".
 *
 * Most callers hold a timestamp off a row and want `clock`. This one is for the
 * derived moments — the next firing of a repeat — which are computed as `Date`
 * and have no ISO string to read. The same function either way, or the editor
 * would have grown its own `format(…, 'h:mm a')` and the app would eventually
 * have printed a time two ways on one screen.
 */
export function clockAt(at: Date): string {
  return format(at, 'h:mm a').toLowerCase()
}

/** ISO timestamp → "5:00 pm". */
export function clock(iso: string): string {
  return clockAt(parseISO(iso))
}

/**
 * A local calendar day. Never `toISOString().slice(0, 10)` — in IST that returns
 * yesterday's date for the first five and a half hours of every day.
 */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/**
 * The one place the week starts, since two answers to that is a bug you see.
 * It lived in `DayCell` while only the grids read it; `stats.ts` is pure and
 * cannot import a component, so the constant moved to the date home instead of
 * being written twice.
 */
export const WEEK_STARTS = { weekStartsOn: 1 } as const

/**
 * How long until a moment happening later today: "in 47m", "in 1h 30m".
 *
 * A clock time answers *when* and leaves the arithmetic to you, which is the one
 * thing a phone is better at. `10:00 am` on a row tells you nothing at a glance
 * about whether that is the next thing or hours away; `in 47m` is the fact you
 * were reading the row for.
 *
 * **Today only, and never a countdown.** Beyond today `relativeDay` already says
 * "tomorrow", which reads far better than "in 19h 20m" — and a ticking display
 * would need a timer per row to stay true, where this is recomputed on the same
 * 30-second clock tick everything else here uses. Null once the moment has gone,
 * so nothing can announce a wait that is already over.
 */
export function until(at: Date, now: Date): string | null {
  if (dayKey(at) !== dayKey(now)) return null
  const away = at.getTime() - now.getTime()
  if (away <= 0) return null
  // Rounded up, or the last 59 seconds before a reminder read "in 0m".
  return `in ${minutes(Math.ceil(away / 60_000))}`
}

/** ISO timestamp → `HH:mm`, the value a native time input wants. */
export function timeValue(iso: string): string {
  return format(parseISO(iso), 'HH:mm')
}

/**
 * `yyyy-MM-dd` plus `HH:mm` → an ISO timestamp with offset.
 *
 * Both halves are rebuilt together whenever either is edited, rather than
 * shifting the old timestamp onto a new day: a reminder whose date moved but
 * whose clock did not is the kind of thing that fires at the wrong moment and
 * looks like the app forgot.
 */
export function atTime(day: string, time: string): string | null {
  const [hours, minutes] = time.split(':').map(Number)
  if (hours === undefined || minutes === undefined) return null
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null

  const at = parseISO(day)
  at.setHours(hours, minutes, 0, 0)
  return format(at, "yyyy-MM-dd'T'HH:mm:ssXXX")
}

/**
 * Header label: "Today", otherwise "Sat, 30 Aug" — with the year when it is not
 * the current one.
 *
 * The year is not decoration here. Browsing back to a previous September, the
 * header read "Fri, 12 Sep" and there was nothing anywhere on the screen to say
 * which year you were looking at.
 */
export function dayLabel(day: string, now: Date): string {
  const date = parseISO(day)
  if (differenceInCalendarDays(date, now) === 0) return 'Today'
  return format(date, date.getFullYear() === now.getFullYear() ? 'EEE, d MMM' : 'EEE, d MMM yyyy')
}

/**
 * The day header, said in two parts.
 *
 * `dayLabel` packs both into one string — "Today", "Sat, 30 Aug" — which is
 * right for a tab title and for an accessible name, and wrong for the largest
 * line on the screen: at one size the weekday, the date and the word "Today"
 * all claim the same weight, so the header states everything and emphasises
 * nothing. Split, the small line says *which* day relative to now and the large
 * one is the date itself.
 *
 * Deliberately two functions over one returning a pair: the eyebrow is uppercase
 * and the title is not, and they are set at different sizes, so they were never
 * going to be rendered together anyway. `dayLabel` stays exactly as it was —
 * nothing that names a control or a tab has changed.
 */
export function dayEyebrow(day: string, now: Date): string {
  const date = parseISO(day)
  switch (differenceInCalendarDays(date, now)) {
    case 0:
      return 'Today'
    case -1:
      return 'Yesterday'
    case 1:
      return 'Tomorrow'
    default:
      return format(date, 'EEEE')
  }
}

/**
 * "15 September", and "15 September 2024" for any other year — the same rule
 * `dayLabel` follows, since browsing back a year with nothing on screen naming
 * it is how you end up reading the wrong September.
 */
export function dayTitle(day: string, now: Date): string {
  const date = parseISO(day)
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMMM' : 'd MMMM yyyy')
}

/**
 * A date as a heading over the rows that fall on it: "Sun 23 Aug".
 *
 * The year appears only when it is not the current one, since an answer that
 * reaches back a year has to say so and one that does not would only be
 * repeating itself.
 */
export function dayHeading(day: string, now: Date): string {
  const date = parseISO(day)
  const shown = date.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy'
  return format(date, shown)
}

/**
 * The days an answer actually covers: "1 — 7 Sep", "28 Aug — 3 Sep".
 *
 * The month is printed once when both ends share it, because "1 Sep — 7 Sep"
 * spends half the line repeating itself. Years appear only when one of them is
 * not the current year, for the same reason the day header names one.
 */
export function daySpan(from: string, to: string, now: Date): string {
  const start = parseISO(from)
  const end = parseISO(to)

  if (start.getFullYear() !== now.getFullYear() || end.getFullYear() !== now.getFullYear()) {
    return `${format(start, 'd MMM yyyy')} — ${format(end, 'd MMM yyyy')}`
  }
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, 'd')} — ${format(end, 'd MMM')}`
  }
  return `${format(start, 'd MMM')} — ${format(end, 'd MMM')}`
}

/**
 * The one number a row carries on its right: money when it has any, otherwise
 * duration. Shared so the timeline, an answer and a toast cannot drift apart
 * about which of the two a row leads with.
 */
export function rowValue(row: Pick<Entry, 'amount_paise' | 'duration_minutes'>): string | null {
  if (row.amount_paise !== null) return rupees(row.amount_paise)
  if (row.duration_minutes !== null) return minutes(row.duration_minutes)
  return null
}

/**
 * Inline label for preview text: "today", "yesterday", "tomorrow", "14 Nov" —
 * and "12 Sep 2025" for another year.
 *
 * This is the text in "→ saving to X" and "Saved to X", which is the app's only
 * warning that an entry is about to land somewhere other than the day on
 * screen. Without the year that warning was wrong by twelve months and looked
 * right: `12 sep 2025` previewed as "saving to 12 Sep", identical to what a
 * date in this September would show.
 */
export function relativeDay(day: string, now: Date): string {
  const date = parseISO(day)
  switch (differenceInCalendarDays(date, now)) {
    case 0:
      return 'today'
    case -1:
      return 'yesterday'
    case 1:
      return 'tomorrow'
    default:
      return format(date, date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy')
  }
}
