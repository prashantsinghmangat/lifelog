import { format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import { Chevron } from './Icons'
import {
  columnsFor,
  peak,
  periodLabel,
  stepAnchor,
  type Column,
  type Scale,
} from '../lib/stats'
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
 *
 * Three controls do all the navigating, and the chart is one of them: the
 * scale switches what a bar represents, the arrows step a period, and a bar is
 * a way further in. There is no date picker.
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

const SCALES: { value: Scale; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

/** Bar gaps, per scale: a month's thirty columns need tighter air. */
const GAP: Record<Scale, string> = {
  day: 'gap-[3px]',
  week: 'gap-1.5',
  month: 'gap-0.5',
  year: 'gap-1.5',
}

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
    : column.key.endsWith('-01') && column.drillTo?.scale === 'month'
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

  /**
   * One anchor date, and every period derives from it — the day itself, the
   * week containing it, the month, the year. That is what makes switching
   * scale keep your place: Day → Week lands on the week holding that day, not
   * on this week, and Year → Month returns to the month you last looked at.
   */
  const [scale, setScale] = useState<Scale>('month')
  const [anchor, setAnchor] = useState(() => (day < today ? day : today))

  /**
   * Browsing stops where the log starts: the earliest stored day, so a
   * birthday logged in 2010 stays reachable while nothing invites a walk into
   * empty decades before it.
   */
  const floor = useMemo(
    () =>
      all.reduce<string | undefined>(
        (earliest, row) =>
          earliest === undefined || row.occurred_on < earliest ? row.occurred_on : earliest,
        undefined,
      ),
    [all],
  )

  // Recomputed only when the inputs move — aggregating a year twice a minute
  // on the 30-second clock tick buys nothing. `now` reaches the columns only
  // through today's key and hour, which are stable across ticks.
  const columns = useMemo(
    () => columnsFor(all, scale, anchor, now),
    [all, scale, anchor, now],
  )
  const max = useMemo(() => peak(columns, 'entries'), [columns])

  const back = stepAnchor(scale, anchor, -1, now, floor)
  const ahead = stepAnchor(scale, anchor, 1, now, floor)

  const label = periodLabel(scale, anchor)

  return (
    <div>
      {/* The same negative-margin trick as Log · Ask: a 40px pill inside a
          44px target, so the control the artboard drew at 40 still meets the
          app's own rule. */}
      <div
        role="group"
        aria-label="Scale"
        className="flex rounded-[11px] bg-sunken p-0.5"
      >
        {SCALES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={scale === option.value}
            onClick={() => setScale(option.value)}
            className="-my-0.5 flex h-11 min-w-0 flex-1 items-center justify-center"
          >
            <span
              className={`flex h-10 w-full items-center justify-center rounded-[9px] text-sm transition-colors ${
                scale === option.value
                  ? 'border border-edge bg-raised font-medium text-ink'
                  : 'text-muted'
              }`}
            >
              {option.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
            {SCALES.find((option) => option.value === scale)?.label}
          </p>
          <h3 className="mt-0.5 truncate text-[1.375rem] leading-tight font-semibold tracking-[-0.012em] text-ink">
            {label}
          </h3>
        </div>

        {/* Paired right, like the day header's own: one place to aim. Disabled
            at the bounds rather than scrolling into empty months a reader
            would take for data loss. */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Previous period"
            disabled={back === null}
            onClick={() => back !== null && setAnchor(back)}
            className={`flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors ${
              back === null ? 'opacity-25' : 'hover:text-ink active:text-ink'
            }`}
          >
            <Chevron dir="left" size={18} />
          </button>
          <button
            type="button"
            aria-label="Next period"
            disabled={ahead === null}
            onClick={() => ahead !== null && setAnchor(ahead)}
            className={`-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors ${
              ahead === null ? 'opacity-25' : 'hover:text-ink active:text-ink'
            }`}
          >
            <Chevron dir="right" size={18} />
          </button>
        </div>
      </div>

      {/* Announced as one polite sentence when the period moves, the way an
          answer is — never a walk through the bars. */}
      <p role="status" aria-live="polite" className="sr-only">
        {label}
      </p>

      <div
        role="group"
        aria-label={`Entries by ${scale === 'day' ? 'hour' : scale === 'year' ? 'month' : 'day'}, ${label}`}
        className={`mt-4 flex h-[132px] items-end ${GAP[scale]}`}
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
              {/* Thirty labels do not fit under 10px columns; the month axis
                  names every fifth day, and today always. */}
              {scale !== 'month' || column.isNow || at === 0 || (at + 1) % 5 === 0
                ? column.label
                : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
