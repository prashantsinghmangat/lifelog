import { differenceInCalendarDays, format, getHours, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import { CalendarIcon, Chevron, ClockIcon, NoteIcon, WalletIcon } from './Icons'
import { behindYou } from '../lib/events'
import {
  columnsFor,
  dailyAverage,
  growthPercent,
  peak,
  periodLabel,
  spanOf,
  stepAnchor,
  totalsFor,
  valueOf,
  type Column,
  type Measure,
  type Scale,
} from '../lib/stats'
import { dayKey, minutes, rupees, rupeesCompact } from '../lib/format'
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

/** The plot's height. Bars scale into it; the axis labels sit below. */
const BAR_AREA = 158

/** Written out, never interpolated: Tailwind only compiles what it can see. */
const SEGMENT: Record<Kind, string> = {
  expense: 'bg-expense',
  time: 'bg-time',
  event: 'bg-event',
  note: 'bg-note',
}

/** The kinds block's order. Money first, as everywhere. */
const STACK: Kind[] = ['expense', 'time', 'event', 'note']

/** The stacked bar drawn top-down, so money sits on the baseline. */
const TOPDOWN: Kind[] = [...STACK].reverse()

const KIND_NAME: Record<Kind, string> = {
  expense: 'Expenses',
  time: 'Time logs',
  event: 'Events',
  note: 'Notes',
}

/** The breakdown tiles: a tinted square and a glyph per kind. Written out —
 *  Tailwind only compiles what it can see. */
const TILE: Record<Kind, string> = {
  expense: 'bg-expense/10 text-expense',
  time: 'bg-time/10 text-time',
  event: 'bg-event/10 text-event',
  note: 'bg-note/10 text-note',
}

const TILE_ICON: Record<Kind, typeof WalletIcon> = {
  expense: WalletIcon,
  time: ClockIcon,
  event: CalendarIcon,
  note: NoteIcon,
}

/** The breakdown's left caption, singular and plural. */
const CAPTION: Record<Kind, [string, string]> = {
  expense: ['entry logged', 'entries logged'],
  time: ['session', 'sessions'],
  event: ['total', 'total'],
  note: ['noted', 'noted'],
}

/**
 * One colour per measure. The kind palette fails colour-vision separation
 * between time and event, which is why the per-kind breakdown is the text
 * block below and never a stacked bar. `entries` reads as "How often" on
 * screen — a count, told in ink.
 */
const MEASURES: { value: Measure; label: string; fill: string }[] = [
  { value: 'entries', label: 'All entries', fill: 'bg-ink' },
  { value: 'spent', label: 'Spent', fill: 'bg-expense' },
  { value: 'hours', label: 'Hours', fill: 'bg-time' },
]

/** The legend's short words — the mock's. The breakdown keeps the full names. */
const LEGEND: Record<Kind, string> = {
  expense: 'Spent',
  time: 'Focus',
  event: 'Events',
  note: 'Notes',
}

const SCALES: { value: Scale; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

/** A non-zero value never renders shorter than the 3px stub a zero draws. */
function height(value: number, max: number): number {
  if (value === 0) return 0
  return Math.max(3, (value / max) * BAR_AREA)
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

/** What the axis chips print for one measure's value. */
function said(measure: Measure, value: number): string {
  if (measure === 'spent') return rupeesCompact(value)
  if (measure === 'hours') return value === 0 ? '0m' : minutes(value)
  return String(value)
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
  // All entries first — the stacked picture is the mock's hero (020).
  const [measure, setMeasure] = useState<Measure>('entries')

  /**
   * The hour picked out of the day view — the one bar tap that goes nowhere,
   * because there is nothing finer than an hour. Tapping selects and names it;
   * tapping again clears. Reconciled during render rather than in an effect,
   * the way `MonthGrid` follows the day: a selection made on one day must not
   * still be lit when the arrows move to another.
   */
  const [hour, setHour] = useState<string | null>(null)
  const [hourFor, setHourFor] = useState(anchor)
  if (hourFor !== anchor) {
    setHourFor(anchor)
    setHour(null)
  }

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
  const max = useMemo(() => peak(columns, measure), [columns, measure])

  /** The whole period's totals, which the figures and both blocks read. */
  const totals = useMemo(() => totalsFor(all, spanOf(scale, anchor)), [all, scale, anchor])
  const entries = valueOf(totals, 'entries')

  const back = stepAnchor(scale, anchor, -1, now, floor)
  const ahead = stepAnchor(scale, anchor, 1, now, floor)

  const label = periodLabel(scale, anchor)

  /**
   * What the hourly bars cannot hold. `occurred_at` is optional, so most rows
   * have no hour to land on — and a few land outside 6am–10pm. Said out loud,
   * or the day's bars quietly disagree with the day's own total.
   */
  const dayTotal = useMemo(
    () => (scale === 'day' ? totalsFor(all, spanOf('day', anchor)) : null),
    [all, scale, anchor],
  )
  const leftOut =
    dayTotal === null
      ? 0
      : valueOf(dayTotal, 'entries') -
        columns.reduce((sum, column) => sum + valueOf(column.totals, 'entries'), 0)

  const chosenAt = columns.findIndex((column) => column.key === hour)
  const chosen = chosenAt === -1 ? null : columns[chosenAt]!

  /**
   * Under a week of history, almost every bar is a flat zero and the one or
   * two that aren't read as noise rather than a picture — the chart is
   * answering a question the log hasn't lived long enough to have an answer
   * to. Counted over the whole log, not the visible period: switching scale
   * or paging back would otherwise make the same three days look like either
   * "not enough" or "plenty" depending on how they happen to be sliced.
   */
  const loggedDays = useMemo(() => new Set(all.map((row) => row.occurred_on)).size, [all])
  const tooLittleData = loggedDays < 7

  /** A bar is a way further in — except an hour, which is the bottom. */
  function tap(column: Column) {
    if (scale === 'day') {
      setHour((held) => (held === column.key ? null : column.key))
      return
    }
    if (column.drillTo === null) return
    setScale(column.drillTo.scale)
    setAnchor(column.drillTo.anchor)
  }

  /** A period after today draws nothing — not even a stub. */
  function future(column: Column): boolean {
    if (scale === 'day') return anchor === today && Number(column.key) + 6 > getHours(now)
    return column.key > today
  }

  const live = MEASURES.find((option) => option.value === measure)!
  const average = dailyAverage(totals)

  // Real or absent: the badge compares against the period before and says
  // nothing when there is nothing to compare against — see `growthPercent`.
  const growth = useMemo(() => growthPercent(all, scale, anchor), [all, scale, anchor])

  /** How many days the heading's chip names. */
  const spanDays = useMemo(() => {
    const held = spanOf(scale, anchor)
    return differenceInCalendarDays(parseISO(held.to), parseISO(held.from)) + 1
  }, [scale, anchor])

  /**
   * Done, counted from the period's own rows rather than invented: an event
   * is behind you when `behindYou` says so — the same call the strikethrough
   * makes, so a repeat (never "done") counts here exactly as it reads there.
   */
  const doneEvents = useMemo(() => {
    const held = spanOf(scale, anchor)
    return all.filter(
      (row) =>
        row.kind === 'event' &&
        row.occurred_on >= held.from &&
        row.occurred_on <= held.to &&
        behindYou(row, now),
    ).length
  }, [all, scale, anchor, now])

  return (
    <div>
      {/* The period selector: four equal buttons, not a second full-width
          segmented control stacked under Grid | Chart. The live one is a
          filled `sunken` pill at 600; the pill is 40px inside a 44px target. */}
      <div role="group" aria-label="Scale" className="flex rounded-[11px] bg-sunken p-[3px]">
        {SCALES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={scale === option.value}
            onClick={() => setScale(option.value)}
            className="-my-[5px] flex h-11 min-w-0 flex-1 items-center justify-center"
          >
            <span
              className={`flex h-[34px] w-full items-center justify-center rounded-lg text-sm transition-colors ${
                scale === option.value
                  ? 'bg-accent font-semibold text-surface shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </span>
          </button>
        ))}
      </div>

      {/* The period heading on its own row — the mock's cadence (019): the
          name, how many days that is, and the arrows that move it. */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-[17px] font-semibold tracking-tight text-ink">{label}</h3>
          {scale !== 'day' && (
            <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-muted tabular-nums">
              {spanDays} days
            </span>
          )}
        </div>

        {/* Paired right, like the day header's own: one place to aim. Disabled
            at the bounds rather than scrolling into empty months a reader
            would take for data loss. */}
        <div className="flex shrink-0 items-center rounded-full bg-sunken px-0.5">
          <button
            type="button"
            aria-label="Previous period"
            disabled={back === null}
            onClick={() => back !== null && setAnchor(back)}
            className={`-my-1 flex h-11 w-10 items-center justify-center rounded-full text-muted transition-colors ${
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
            className={`-my-1 flex h-11 w-10 items-center justify-center rounded-full text-muted transition-colors ${
              ahead === null ? 'opacity-25' : 'hover:text-ink active:text-ink'
            }`}
          >
            <Chevron dir="right" size={18} />
          </button>
        </div>
      </div>

      {/* The headline card. The lead figure is always the period's money —
          the measure buttons change the picture, never the headline — with
          what the period held on a sunken strip, and the measure pills right
          under the telemetry they change (019). */}
      <div className="mt-2 rounded-2xl border border-line bg-raised px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.6875rem] font-semibold tracking-[0.1em] text-expense uppercase">
            {scale === 'day' ? 'Spent' : `Spent this ${scale}`}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="font-display text-[2.5rem] leading-none tracking-[-0.01em] text-ink tabular-nums">
              {rupees(totals.paise)}
            </p>
            {/* Computed against the period before, or absent — never a fixed
                number, and never 0% invented over an empty prior period. More
                spend takes the expense colour; less stays muted, because a
                falling figure is a fact and not an achievement. */}
            {growth !== null && (
              <span
                className={`shrink-0 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium tabular-nums ${
                  growth > 0 ? 'text-expense' : 'text-muted'
                }`}
              >
                <span aria-hidden="true">{growth > 0 ? '↗ ' : '↘ '}</span>
                {`${growth > 0 ? '+' : ''}${growth}%`}
                <span className="sr-only"> against the period before</span>
              </span>
            )}
          </div>
          {/* 13px: the average over the days that hold entries, and how many. */}
          {scale !== 'day' && totals.activeDays > 0 && (
            <p className="mt-1.5 text-[0.8125rem] text-muted">
              <span className="tabular-nums">{rupees(average)}</span> a day across{' '}
              <span className="tabular-nums">{totals.activeDays}</span>{' '}
              {totals.activeDays === 1 ? 'day' : 'days'} with entries
            </p>
          )}
        </div>

        {/* The wallet tile, the card's own mark. */}
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TILE.expense}`}
        >
          <WalletIcon size={20} />
        </span>
        </div>

        {/* What the period held, one string on a sunken band so it reads —
            and is read aloud — as one fact. */}
        <p className="mt-3 truncate rounded-lg bg-sunken px-2.5 py-1.5 text-xs text-muted tabular-nums">
          {[
            `${entries} ${entries === 1 ? 'entry' : 'entries'}`,
            ...(totals.minutes > 0 ? [`${minutes(totals.minutes)} logged`] : []),
            ...(totals.counts.event > 0
              ? [`${totals.counts.event} ${totals.counts.event === 1 ? 'event' : 'events'}`]
              : []),
          ].join(' · ')}
        </p>

        {/* The measure pills, beside the telemetry they change. Hidden with
            the bars: with nothing drawn there is nothing for them to do. */}
        {!tooLittleData && (
          <div role="group" aria-label="Measure" className="mt-3 flex gap-2">
            {MEASURES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={measure === option.value}
                onClick={() => setMeasure(option.value)}
                className={`h-11 min-w-0 flex-1 rounded-full px-2 text-sm transition-colors ${
                  measure === option.value
                    ? 'bg-accent font-medium text-surface'
                    : 'border border-line text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Announced as one polite sentence when the period or scale moves, the
          way an answer is — never a walk through the bars. */}
      <p role="status" aria-live="polite" className="sr-only">
        {`${label}: ${entries} ${entries === 1 ? 'entry' : 'entries'}, ${rupees(
          totals.paise,
        )} spent, ${totals.minutes === 0 ? 'no time logged' : minutes(totals.minutes)}`}
      </p>

      {tooLittleData ? (
        // Say so rather than draw it: a handful of spikes in an otherwise flat
        // grid is not a picture, and the totals above and the breakdowns below
        // stay meaningful with no bars at all.
        <p className="mt-4 flex h-[158px] items-center justify-center text-center text-xs text-faint">
          Too little logged yet for a chart to mean anything —
          <br />a few more days and this fills in.
        </p>
      ) : (
        <div className="mt-4 rounded-2xl border border-line bg-raised px-3.5 pt-3 pb-3.5">
          {/* The card says what it draws and what a tap actually does at this
              scale — never a promise the drill cannot keep. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-ink">
              {scale === 'day'
                ? 'Hourly distribution'
                : scale === 'year'
                  ? 'Monthly distribution'
                  : 'Daily distribution'}
            </p>

            {/* Only where the bars stack: on one colour per measure the fill
                is named by the live measure pill, and a legend would repeat
                it. */}
            {measure === 'entries' && (
              <div
                role="group"
                aria-label="What the colours mean"
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
              >
              {STACK.map((kind) => (
                <span key={kind} className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SEGMENT[kind]}`} />
                  {LEGEND[kind]}
                </span>
              ))}
              </div>
            )}
          </div>

          <p className="mt-0.5 text-xs text-faint">
            {scale === 'day' ? 'Tap an hour to inspect it' : 'Tap a bar to go further in'}
          </p>

          <div className="relative mt-4">
          {/* One guide row at the peak — the mock's: a word, a dashed rule,
              the value it stands for. */}
          <div aria-hidden="true" className="flex items-center gap-2 pb-1.5 text-faint">
            <span className="text-[10px] font-medium">High</span>
            <span className="min-w-0 flex-1 border-t border-dashed border-line" />
            <span className="text-[10px] tabular-nums">{said(measure, max)}</span>
          </div>

          <div
            role="group"
            aria-label={`Entries by ${scale === 'day' ? 'hour' : scale === 'year' ? 'month' : 'day'}, ${label}`}
            className="relative flex h-[158px] items-end gap-[2px]"
          >
            {columns.map((column) => {
              const value = valueOf(column.totals, measure)
              const selected = scale === 'day' && column.key === hour
              return (
                <button
                  key={column.key}
                  type="button"
                  aria-label={barName(column)}
                  aria-pressed={scale === 'day' ? column.key === hour : undefined}
                  onClick={() => tap(column)}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                >
                  {/* One colour per measure; today takes the accent and the
                      selected bar takes ink. Radius on the data end only,
                      anchored to the baseline. A zero in the past is a stub in
                      `sunken`, never a gap — a gap reads as a day that did not
                      exist. After today, nothing. */}
                  {!future(column) &&
                    (measure === 'entries' && value > 0 && !selected ? (
                      // The stack: one segment per kind, proportional inside
                      // the bar's own height, in the same colours the legend
                      // above and the breakdown below carry. Reinstated over
                      // 016's CVD objection by explicit decision — spec 017.
                      <span
                        aria-hidden="true"
                        className="flex w-full max-w-[8px] flex-col overflow-hidden rounded-full"
                        style={{ height: height(value, max) }}
                      >
                        {TOPDOWN.map(
                          (kind) =>
                            column.totals.counts[kind] > 0 && (
                              <span
                                key={kind}
                                className={`w-full ${SEGMENT[kind]}`}
                                style={{ flexGrow: column.totals.counts[kind] }}
                              />
                            ),
                        )}
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`w-full max-w-[8px] rounded-full ${
                          value === 0
                            ? 'bg-sunken'
                            : selected
                              ? 'bg-ink'
                              : column.isNow
                                ? 'bg-accent'
                                : live.fill
                        }`}
                        style={{ height: value === 0 ? 3 : height(value, max) }}
                      />
                    ))}
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-[8px] w-full overflow-visible text-center text-[10px] leading-none tabular-nums ${
                      column.isNow ? 'font-medium text-ink' : 'text-faint'
                    }`}
                  >
                    {/* Thirty labels do not fit under 10px columns; the month
                        axis names every fifth day, and today always. */}
                    {scale !== 'month' ||
                    column.isNow ||
                    column.key.endsWith('-01') ||
                    Number(column.key.slice(-2)) % 5 === 0
                      ? column.label
                      : ''}
                  </span>
                </button>
              )
            })}
          </div>

          {/* The callout on the selected bar: the value, then the hour and its
              count — in place of printing a number on every bar. Clamped so
              the chip stays inside the plot at any font scale, and a live
              region so the selection is also said aloud. */}
          {chosen !== null && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute top-2 -translate-x-1/2"
              style={{
                left: `${Math.min(86, Math.max(14, ((chosenAt + 0.5) / columns.length) * 100))}%`,
              }}
            >
              <span className="block w-max rounded-md bg-sunken px-2 py-1 text-center shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
                <span className="block text-sm font-semibold text-ink tabular-nums">
                  {measure === 'spent'
                    ? rupees(chosen.totals.paise)
                    : said(measure, valueOf(chosen.totals, measure))}
                </span>
                <span className="block text-[0.6875rem] text-muted">
                  {chosen.label} · {valueOf(chosen.totals, 'entries')}{' '}
                  {valueOf(chosen.totals, 'entries') === 1 ? 'entry' : 'entries'}
                </span>
              </span>
            </div>
          )}
          </div>

        </div>
      )}

      {/* The day view's reconciliation line: how many entries stand in no
          hourly bar. One quiet line — a fact about the day, not a problem. */}
      {!tooLittleData && scale === 'day' && leftOut > 0 && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-faint">
          {`${leftOut} ${
            leftOut === 1 ? 'entry is' : 'entries are'
          } not in the bars — no time, or outside 6am–10pm`}
        </p>
      )}

      {/* A fact about a past week, not a problem to fix: no illustration and
          no call to action, just the truth said quietly. */}
      {entries === 0 && <p className="mt-4 text-xs text-faint">Nothing was logged.</p>}

      {/* The same two blocks under every scale, so the shape of the answer
          never changes as you move — only the numbers. First the four kinds,
          each with a proportional micro-bar in its own colour: the biggest
          kind fills the track and the rest read relative to it, the same
          scaling Where-it-went uses. The card treatment and the bars are spec
          017's breakdown; the figures are the same ones the text rows said. */}
      <p className="mt-[26px] mb-2 text-[15px] font-semibold text-ink">Category breakdown</p>
      {/* One card per kind — the mock's grammar (019): a tinted glyph tile,
          what the count is a count of, the kind's own headline figure with an
          honest sub-caption, and the proportional track. Every figure is the
          period's, from `stats.ts` or `behindYou` — nothing decorative. */}
      <div className="space-y-2">
        {STACK.map((kind) => {
          const count = totals.counts[kind]
          const most = Math.max(1, ...STACK.map((held) => totals.counts[held]))
          const top = totals.byCategory[0]
          const Icon = TILE_ICON[kind]

          const figure =
            kind === 'expense' && totals.paise !== 0
              ? rupees(totals.paise)
              : kind === 'time'
                ? totals.minutes === 0
                  ? '0m'
                  : minutes(totals.minutes)
                : kind === 'event'
                  ? `${doneEvents} done`
                  : String(count)

          // One rounded division for the time card's caption; the exact
          // period arithmetic stays in stats.ts.
          const sub =
            kind === 'expense' && top !== undefined && top.name !== null
              ? `Top: ${top.name} · ${rupees(top.paise)}`
              : kind === 'time' && totals.minutes > 0 && totals.activeDays > 0
                ? `${minutes(Math.round(totals.minutes / totals.activeDays))} / active day`
                : kind === 'event' && count > 0
                  ? `${Math.round((doneEvents / count) * 100)}% done`
                  : null

          return (
            <div key={kind} className="rounded-2xl border border-line bg-raised px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${TILE[kind]}`}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{KIND_NAME[kind]}</span>
                  <span className="block truncate text-xs text-faint tabular-nums">
                    {count} {CAPTION[kind][count === 1 ? 0 : 1]}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-ink tabular-nums">
                    {figure}
                  </span>
                  {sub !== null && (
                    <span className="block max-w-[10rem] truncate text-xs text-faint tabular-nums">
                      {sub}
                    </span>
                  )}
                </span>
              </div>
              {/* h-1.5 like the grid ribbon's track, not the page-surface
                  h-1: inside a raised card a 4px sunken track all but
                  disappears on a phone screen. */}
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken">
                <span
                  className={`block h-full rounded-full ${SEGMENT[kind]}`}
                  style={{ width: `${(count / most) * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Then where the money went: name, share, amount, and a 4px bar on a
          sunken track — scaled against the largest category, not against
          100%, so the biggest fills the track and the rest read relative to
          it. The bucket with no name sorts last even when largest, because it
          is an absence, not a category. */}
      {totals.byCategory.length > 0 && (
        <>
          <p className="mt-[26px] mb-2 text-[15px] font-semibold text-ink">Where it went</p>
          {/* The breakdown card's exact treatment, so the two blocks match. */}
          <div className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {totals.byCategory.slice(0, 4).map((category) => {
              const widest = Math.max(
                1,
                ...totals.byCategory.slice(0, 4).map((held) => Math.abs(held.paise)),
              )
              const share =
                totals.paise === 0
                  ? 0
                  : Math.round((Math.abs(category.paise) / Math.abs(totals.paise)) * 100)
              return (
                <div key={category.name ?? ''} className="px-3.5 py-2.5">
                  <div className="flex items-baseline gap-3">
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        category.name === null ? 'text-faint' : 'text-ink'
                      }`}
                    >
                      {category.name ?? 'uncategorised'}
                    </span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{share}%</span>
                    <span className="shrink-0 text-right text-sm text-muted tabular-nums">
                      {rupees(category.paise)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                    <span
                      className="block h-full rounded-full bg-expense"
                      style={{ width: `${(Math.abs(category.paise) / widest) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
