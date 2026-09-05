import { differenceInCalendarDays, format, parseISO } from 'date-fns'

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

/** Header label: "Today", otherwise "Sat, 30 Aug". */
export function dayLabel(day: string, now: Date): string {
  const date = parseISO(day)
  return differenceInCalendarDays(date, now) === 0 ? 'Today' : format(date, 'EEE, d MMM')
}

/** Inline label for preview text: "today", "yesterday", "tomorrow", "14 Nov". */
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
      return format(date, 'd MMM')
  }
}
