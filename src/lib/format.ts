import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { Entry } from '../types'

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

/** ISO timestamp → "5:00 pm". */
export function clock(iso: string): string {
  return format(parseISO(iso), 'h:mm a').toLowerCase()
}

/**
 * A local calendar day. Never `toISOString().slice(0, 10)` — in IST that returns
 * yesterday's date for the first five and a half hours of every day.
 */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
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
