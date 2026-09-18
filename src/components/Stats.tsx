import { format, parseISO } from 'date-fns'
import { useMemo } from 'react'
import { columnsFor, peak, periodLabel, type Column } from '../lib/stats'
import { dayKey, minutes, rupees } from '../lib/format'
import type { Entry, Kind } from '../types'

/**
 * How much and how often, drawn — the one chart the design rules allow.
 *
 * Every figure comes from `stats.ts`, which is pure and tested exactly; this
 * component does no arithmetic beyond turning a number into a pixel height.
 * The rows are `useEntries`'s `all` — the whole log this device already holds —
 * so there is no fetch, no loading state and no network path, which is the
 * entire argument for the screen existing.
 */

/** The drawable part of the chart. The remaining 8px of the 132 is the axis. */
const BAR_AREA = 124

/** Written out, never interpolated: Tailwind only compiles what it can see. */
const SEGMENT: Record<Kind, string> = {
  expense: 'bg-expense',
  time: 'bg-time',
  event: 'bg-event',
  note: 'bg-note',
}

/** Stacking order, bottom up. Money sits on the baseline. */
const STACK: Kind[] = ['expense', 'time', 'event', 'note']

/** A non-zero value never renders shorter than this, or a day with one entry
 *  disappears from its month. */
function height(value: number, max: number): number {
  if (value === 0) return 0
  return Math.max(2, (value / max) * BAR_AREA)
}

/**
 * '16 September, 8 entries, ₹1,520 spent, 2h 30m' — a bar is a real button and
 * this is its accessible name. The name carries the period and the numbers,
 * which is what makes the chart keyboard-navigable and screen-readable without
 * a table standing beside it.
 */
function barName(column: Column): string {
  const entries =
    column.totals.counts.expense +
    column.totals.counts.time +
    column.totals.counts.event +
    column.totals.counts.note
  const period = /^\d+$/.test(column.key)
    ? column.label
    : column.key.length === 7 || column.key.endsWith('-01')
      ? format(parseISO(column.key), 'MMMM')
      : format(parseISO(column.key), 'd MMMM')
  return [
    period,
    `${entries} ${entries === 1 ? 'entry' : 'entries'}`,
    ...(column.totals.paise !== 0 ? [`${rupees(column.totals.paise)} spent`] : []),
    ...(column.totals.minutes > 0 ? [minutes(column.totals.minutes)] : []),
  ].join(', ')
}

type Props = {
  /** The whole local log. Never fetched for; the device already holds it. */
  all: Entry[]
  now: Date
  /** The day being viewed, which is where the chart opens. */
  day: string
}

export function Stats({ all, now, day }: Props) {
  // Never a future period: the timeline can sit on tomorrow, the chart cannot.
  const today = dayKey(now)
  const anchor = day < today ? day : today

  // Recomputed only when the inputs move, not on the 30-second clock tick —
  // `now` matters to the columns only through today's key and hour, and `today`
  // is stable across ticks. Aggregating a year twice a minute buys nothing.
  const columns = useMemo(() => columnsFor(all, 'month', anchor, now), [all, anchor, now])
  const max = useMemo(() => peak(columns, 'entries'), [columns])

  return (
    <div>
      <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">Month</p>
      <h3 className="mt-0.5 text-[1.375rem] leading-tight font-semibold tracking-[-0.012em] text-ink">
        {periodLabel('month', anchor)}
      </h3>

      <div
        role="group"
        aria-label={`Entries by day, ${periodLabel('month', anchor)}`}
        className="mt-4 flex h-[132px] items-end gap-0.5"
      >
        {columns.map((column, at) => (
          <button
            key={column.key}
            type="button"
            aria-label={barName(column)}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
          >
            <span aria-hidden="true" className="flex w-full flex-col justify-end gap-px">
              {/* Stacked by kind so a period's texture is visible. Bottom up,
                  so the order is reversed for the DOM's top-down flow. */}
              {[...STACK].reverse().map((kind) =>
                column.totals.counts[kind] === 0 ? null : (
                  <span
                    key={kind}
                    className={`w-full rounded-[1px] ${SEGMENT[kind]}`}
                    style={{ height: height(column.totals.counts[kind], max) }}
                  />
                ),
              )}
            </span>
            {/* The whole of the you-are-here treatment: a heavier baseline. */}
            <span
              aria-hidden="true"
              className={`mt-px w-full ${column.isNow ? 'h-0.5 bg-ink' : 'h-px bg-edge'}`}
            />
            <span
              aria-hidden="true"
              className={`h-[8px] w-full overflow-visible text-center text-[10px] leading-none tabular-nums ${
                column.isNow ? 'text-ink' : 'text-faint'
              }`}
            >
              {/* Thirty labels do not fit under 10px columns; every fifth
                  keeps the axis readable, and today is always named. */}
              {column.isNow || at === 0 || (at + 1) % 5 === 0 ? column.label : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
