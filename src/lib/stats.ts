import {
  addDays,
  addMonths,
  addYears,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  getHours,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { WEEK_STARTS, dayKey } from './format'
import type { Entry, Kind } from '../types'

/**
 * The arithmetic behind the stats view, and nothing else.
 *
 * Pure for the same reason the parser is: every figure on that screen is a
 * confident claim about the log, and a claim can only be tested exactly if the
 * function making it imports nothing stateful and never reads the clock. `now`
 * is injected everywhere it matters — which period is current, where browsing
 * must stop — so the tests pin real dates rather than whatever today happens
 * to be.
 *
 * **Totals come from stored rows only.** A repeat is one row drawn on many
 * days, and counting the drawings would report a weekday standup as five
 * standups costing five times what it did — the same rule the day screen's
 * totals line already follows, stated in CLAUDE.md. The cost is agreed: the
 * chart shows a quiet Tuesday on which the phone rang. If either place ever
 * changes this, both change in the same commit.
 *
 * Money is integer paise throughout and is divided nowhere; only `format.ts`
 * turns it into a string. Days are grouped by `occurred_on`, never by
 * `occurred_at`, and every yyyy-MM-dd here comes from `dayKey` — never from
 * slicing an ISO string, which in IST names yesterday for the first five and a
 * half hours of every day.
 */

export type Scale = 'day' | 'week' | 'month' | 'year'

/** What bar height measures. The totals carry all three; this picks one. */
export type Measure = 'entries' | 'spent' | 'hours'

/** A period as two inclusive yyyy-MM-dd days. */
export type Span = { from: string; to: string }

export type Totals = {
  /** Signed, integer, never a float. A refund below zero stays below zero. */
  paise: number
  minutes: number
  counts: Record<Kind, number>
  /** Days in the span holding at least one entry. */
  activeDays: number
  /**
   * Spend per category, descending, all of them. `null` is the rows that have
   * no category — kept last even when largest, because it is an absence rather
   * than a category, and the UI owns the word for it.
   */
  byCategory: { name: string | null; paise: number }[]
}

export type Column = {
  /** yyyy-MM-dd, or '0'–'15' for an hour of the day view. */
  key: string
  /** Short, for the axis: 'M', '14', 'S', '6a'. */
  label: string
  totals: Totals
  isNow: boolean
  /** Where tapping this bar lands. Null: nothing finer, or not browsable. */
  drillTo: { scale: Scale; anchor: string } | null
}

/** The sixteen hours the day view draws, 6am to 10pm. */
const FIRST_HOUR = 6
const HOURS = 16

/**
 * Rows arrive from `useEntries`, which has already dropped soft-deleted ones —
 * but a rule this load-bearing is asserted rather than trusted, so a row that
 * somehow still carries `deleted_at` contributes nothing here either.
 */
type MaybeDeleted = Entry & { deleted_at?: string | null }

function alive(rows: Entry[]): Entry[] {
  return rows.filter((row) => (row as MaybeDeleted).deleted_at == null)
}

/** The period containing the anchor day, at the given scale. */
export function spanOf(scale: Scale, anchor: string): Span {
  const at = parseISO(anchor)
  if (scale === 'day') return { from: anchor, to: anchor }
  if (scale === 'week')
    return { from: dayKey(startOfWeek(at, WEEK_STARTS)), to: dayKey(endOfWeek(at, WEEK_STARTS)) }
  if (scale === 'month') return { from: dayKey(startOfMonth(at)), to: dayKey(endOfMonth(at)) }
  return { from: dayKey(startOfYear(at)), to: dayKey(endOfYear(at)) }
}

/**
 * The anchor one period over, or null at either bound.
 *
 * The future is not browsable: a reader who can walk into November and see
 * zero spend will read it as data loss, so no period may start after today.
 * The past stops at `floor` — the earliest day worth showing, which the caller
 * derives from the oldest stored row so a birthday logged in 2010 stays
 * reachable. With no floor given it is 1 January of the current year.
 */
export function stepAnchor(
  scale: Scale,
  anchor: string,
  dir: -1 | 1,
  now: Date,
  floor?: string,
): string | null {
  const at = parseISO(anchor)
  const moved =
    scale === 'day'
      ? addDays(at, dir)
      : scale === 'week'
        ? addDays(at, dir * 7)
        : scale === 'month'
          ? addMonths(at, dir)
          : addYears(at, dir)
  const next = dayKey(moved)

  if (dir === 1 && spanOf(scale, next).from > dayKey(now)) return null

  const first = floor ?? `${format(now, 'yyyy')}-01-01`
  if (dir === -1 && spanOf(scale, next).to < first) return null

  return next
}

const NONE: Totals = {
  paise: 0,
  minutes: 0,
  counts: { expense: 0, time: 0, event: 0, note: 0 },
  activeDays: 0,
  byCategory: [],
}

/** Totals over any set of rows. Zeros for none — never NaN. */
function aggregate(rows: Entry[]): Totals {
  if (rows.length === 0) return NONE

  const counts: Record<Kind, number> = { expense: 0, time: 0, event: 0, note: 0 }
  const days = new Set<string>()
  const categories = new Map<string | null, number>()
  let paise = 0
  let minutes = 0

  for (const row of rows) {
    counts[row.kind] += 1
    days.add(row.occurred_on)
    paise += row.amount_paise ?? 0
    minutes += row.duration_minutes ?? 0
    // Spend per category, so only rows that carry money say anything here.
    if (row.amount_paise !== null) {
      const name = row.category
      categories.set(name, (categories.get(name) ?? 0) + row.amount_paise)
    }
  }

  const named = [...categories.entries()]
    .filter(([name]) => name !== null)
    .sort((a, b) => b[1] - a[1])
  const bare = categories.get(null)

  return {
    paise,
    minutes,
    counts,
    activeDays: days.size,
    byCategory: [
      ...named.map(([name, total]) => ({ name, paise: total })),
      ...(bare === undefined ? [] : [{ name: null, paise: bare }]),
    ],
  }
}

/** Totals for the rows falling inside a span. */
export function totalsFor(rows: Entry[], span: Span): Totals {
  return aggregate(
    alive(rows).filter((row) => row.occurred_on >= span.from && row.occurred_on <= span.to),
  )
}

/** '6a', '12p', '9p' — the day axis. */
function hourLabel(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${hour < 12 ? 'a' : 'p'}`
}

/**
 * The bars of one period, in axis order.
 *
 * The day view buckets by the clock, which most rows do not carry —
 * `occurred_at` is optional — so entries without one land in no bar there, and
 * the caller says how many were left out rather than letting the bars quietly
 * disagree with the day's total. Hours outside 6am–10pm are left out the same
 * way. Every other scale buckets by `occurred_on`, which every row has.
 */
export function columnsFor(rows: Entry[], scale: Scale, anchor: string, now: Date): Column[] {
  const held = alive(rows)
  const today = dayKey(now)
  const span = spanOf(scale, anchor)

  if (scale === 'day') {
    const inDay = held.filter((row) => row.occurred_on === anchor)
    return Array.from({ length: HOURS }, (_, at) => {
      const hour = FIRST_HOUR + at
      return {
        key: String(at),
        label: hourLabel(hour),
        totals: aggregate(
          inDay.filter(
            (row) => row.occurred_at !== null && getHours(parseISO(row.occurred_at)) === hour,
          ),
        ),
        isNow: anchor === today && getHours(now) === hour,
        // No finer view: tapping an hour selects it, it does not travel.
        drillTo: null,
      }
    })
  }

  if (scale === 'year') {
    return eachMonthOfInterval({ start: parseISO(span.from), end: parseISO(span.to) }).map(
      (month) => {
        const start = dayKey(startOfMonth(month))
        return {
          key: start,
          label: format(month, 'MMMMM'),
          totals: totalsFor(held, { from: start, to: dayKey(endOfMonth(month)) }),
          isNow: start === dayKey(startOfMonth(now)),
          // Months after this one are a bare baseline, not a place to go.
          drillTo: start > today ? null : { scale: 'month', anchor: start },
        }
      },
    )
  }

  return eachDayOfInterval({ start: parseISO(span.from), end: parseISO(span.to) }).map((date) => {
    const key = dayKey(date)
    return {
      key,
      label: scale === 'week' ? format(date, 'EEEEE') : format(date, 'd'),
      totals: totalsFor(held, { from: key, to: key }),
      isNow: key === today,
      drillTo: key > today ? null : { scale: 'day', anchor: key },
    }
  })
}

/** The one number a bar's height comes from. Absolute, because a refund must
 *  not draw a negative pixel height — the sign survives in the figures. */
export function valueOf(totals: Totals, measure: Measure): number {
  if (measure === 'spent') return Math.abs(totals.paise)
  if (measure === 'hours') return totals.minutes
  return totals.counts.expense + totals.counts.time + totals.counts.event + totals.counts.note
}

/** The tallest bar of the set, floored at 1 so an empty period divides by
 *  nothing worse than one. Never -Infinity: an empty list is just 1. */
export function peak(columns: Column[], measure: Measure): number {
  return Math.max(1, ...columns.map((column) => valueOf(column.totals, measure)))
}

/**
 * What the header calls the period: 'Wed 16 Sep', '14 – 20 Sep',
 * 'September 2026', '2026'. Sits here beside the axis labels rather than in
 * `format.ts`, so everything the chart says about a date is tested in one
 * place; money and minutes still only become strings in `format.ts`.
 */
export function periodLabel(scale: Scale, anchor: string): string {
  const at = parseISO(anchor)
  if (scale === 'day') return format(at, 'EEE d MMM')
  if (scale === 'week') {
    const from = startOfWeek(at, WEEK_STARTS)
    const to = endOfWeek(at, WEEK_STARTS)
    const sameMonth = format(from, 'MMM') === format(to, 'MMM')
    return sameMonth
      ? `${format(from, 'd')} – ${format(to, 'd MMM')}`
      : `${format(from, 'd MMM')} – ${format(to, 'd MMM')}`
  }
  if (scale === 'month') return format(at, 'MMMM yyyy')
  return format(at, 'yyyy')
}
