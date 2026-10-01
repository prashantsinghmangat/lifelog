import { format, parseISO, startOfMonth } from 'date-fns'
import { useMemo, useState } from 'react'
import { KindMark } from './KindMark'
import { MonthGrid } from './MonthGrid'
import { Segmented } from './Segmented'
import { Stats } from './Stats'
import { ChartIcon, GridIcon } from './Icons'
import { behindYou, reminderAt } from '../lib/events'
import { byClock } from '../lib/history'
import { clock, dayKey, minutes, rowValue, rupees } from '../lib/format'
import { spanOf, totalsFor } from '../lib/stats'
import type { Entry, Kind } from '../types'

/** Written out, never interpolated: Tailwind only compiles what it can see. */
const DOT: Record<Kind, string> = {
  expense: 'bg-expense',
  time: 'bg-time',
  event: 'bg-event',
  note: 'bg-note',
}

/** How many entries the peek lists before deferring to the day itself. */
const PEEKED = 6

type Props = {
  day: string
  now: Date
  /** This device's whole log, which is what the figures are counted from. */
  all: Entry[]
  loadDays: (from: string, to: string) => Promise<string[]>
  onPick: (day: string) => void
}

/**
 * One destination, two views: the grid for getting to a day, the chart for how
 * much and how often.
 *
 * The grid carries two figure surfaces of its own now — spec 017. The ribbon
 * above it says what the month on show holds, counted by the same `stats.ts`
 * arithmetic the chart uses so the two views can never disagree; the peek
 * below it shows the day a tap chose without leaving the month. A second tap
 * on the chosen day — or the peek's own button — is what travels. The chart
 * is `Stats`, which drills within itself and never writes.
 */
export function Calendar({ day, now, all, loadDays, onPick }: Props) {
  /**
   * Two views of one destination: the grid for getting to a day, the chart for
   * how much and how often. A toggle rather than a fifth destination — the nav
   * holds four items and a screen that both gets you somewhere and tells you
   * how much is strictly more useful in the same slot.
   */
  const [look, setLook] = useState<'grid' | 'chart'>('grid')

  /** The month the grid is showing, reported by `MonthGrid` as it browses. */
  const [shown, setShown] = useState(() => startOfMonth(parseISO(day)))

  /**
   * The day a tap picked out, shown in place before it is travelled to. One
   * tap peeks, the same tap again goes — and the already-selected day goes
   * straight away, which is what keeps the grid's Today button a single act.
   */
  const [peek, setPeek] = useState<string | null>(null)

  const monthTotals = useMemo(
    () => totalsFor(all, spanOf('month', dayKey(shown))),
    [all, shown],
  )

  const peeked = useMemo(
    () =>
      peek === null
        ? []
        : all.filter((row) => row.occurred_on === peek).sort(byClock),
    [all, peek],
  )

  const counts = monthTotals.counts

  return (
    <div>
      {/* The one segmented control — see `Segmented` for the 40px track and
          the 44px targets inside it. */}
      <div className="mb-4">
        <Segmented
          label="Calendar view"
          value={look}
          options={[
            { value: 'grid', label: 'Grid', icon: <GridIcon size={16} /> },
            { value: 'chart', label: 'Chart', icon: <ChartIcon size={16} /> },
          ]}
          onChange={setLook}
        />
      </div>

      {look === 'chart' && <Stats all={all} now={now} day={day} />}

      {look === 'grid' && (
        <>
          {/* What the month on show holds, one cell per kind that carries a
              figure. Counted from stored rows by the chart's own arithmetic —
              a repeat counts once, on the day it is stored. */}
          <div className="mb-4 rounded-2xl border border-line bg-raised px-3.5 pt-3 pb-3.5">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  {
                    kind: 'expense',
                    label: 'Spent',
                    figure: rupees(monthTotals.paise),
                    caption: `${counts.expense} ${counts.expense === 1 ? 'entry' : 'entries'}`,
                  },
                  {
                    kind: 'time',
                    label: 'Logged',
                    figure: monthTotals.minutes === 0 ? '0m' : minutes(monthTotals.minutes),
                    caption: `${counts.time} ${counts.time === 1 ? 'session' : 'sessions'}`,
                  },
                  {
                    kind: 'event',
                    label: 'Events',
                    figure: String(counts.event),
                    caption: 'this month',
                  },
                ] as const
              ).map((cell) => (
                <div key={cell.label} className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[cell.kind]}`}
                    />
                    {cell.label}
                  </p>
                  <p className="mt-1 truncate text-lg leading-tight font-semibold text-ink tabular-nums">
                    {cell.figure}
                  </p>
                  <p className="truncate text-xs text-faint">{cell.caption}</p>
                </div>
              ))}
            </div>

            {/* The month's composition as one track: entry counts, the only
                unit the three kinds share — money against minutes would be a
                bar of mixed units. Decoration under the figures that carry
                the data, so it says nothing on its own. */}
            <div aria-hidden="true" className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-sunken">
              {(['expense', 'time', 'event'] as const).map(
                (kind) =>
                  counts[kind] > 0 && (
                    <span
                      key={kind}
                      className={`h-full ${DOT[kind]}`}
                      style={{ flexGrow: counts[kind] }}
                    />
                  ),
              )}
            </div>
          </div>

          <MonthGrid
            day={day}
            now={now}
            loadDays={loadDays}
            onMonth={setShown}
            onPick={(picked) =>
              picked === peek || picked === day ? onPick(picked) : setPeek(picked)
            }
          />

          {/* The day the tap chose, in place. Stored rows only — a repeat
              shows on the day it is stored, the known rough edge the dots
              share. Every row travels; so does the button under them. */}
          {peek !== null && (
            <section aria-label={`${format(parseISO(peek), 'EEEE d MMMM')}, peek`} className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 self-center rounded-full bg-accent" />
                  {format(parseISO(peek), 'EEEE, d MMM')}
                </h3>
                <span className="shrink-0 rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-muted tabular-nums">
                  {peeked.length} {peeked.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              <div className="mt-2 divide-y divide-line rounded-2xl border border-line bg-raised">
                {peeked.length === 0 && (
                  <p className="px-3.5 py-3 text-xs text-faint">Nothing logged.</p>
                )}
                {peeked.slice(0, PEEKED).map((row) => {
                  const right = rowValue(row)
                  const at = row.occurred_at === null ? null : clock(row.occurred_at)
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onPick(peek)}
                      className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-sunken active:bg-sunken"
                    >
                      <KindMark kind={row.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-sm text-ink">{row.title}</span>
                        {(at !== null || row.category !== null) && (
                          <span className="mt-0.5 block truncate text-xs text-faint">
                            {at !== null && <span className="text-muted tabular-nums">{at}</span>}
                            {at !== null && row.category !== null && ' · '}
                            {row.category}
                          </span>
                        )}
                      </span>
                      {right !== null && (
                        <span className="shrink-0 text-sm text-muted tabular-nums">{right}</span>
                      )}
                      {/* Said quietly, the way the strikethrough says it
                          elsewhere — facts about the event, not a status
                          system: behind you is Done, a reminder still to
                          fire is Alert. */}
                      {row.kind === 'event' && behindYou(row, now) && (
                        <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-muted">
                          Done
                        </span>
                      )}
                      {row.kind === 'event' &&
                        !behindYou(row, now) &&
                        reminderAt(row, now) !== null && (
                          <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-muted">
                            Alert
                          </span>
                        )}
                    </button>
                  )
                })}
                {peeked.length > PEEKED && (
                  <p className="px-3.5 py-2 text-xs text-faint">
                    {peeked.length - PEEKED} more on the day itself.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onPick(peek)}
                className="mt-1 flex h-11 w-full items-center justify-center rounded-lg text-xs font-medium text-accent transition-colors hover:bg-sunken"
              >
                Open the day
              </button>
            </section>
          )}
        </>
      )}
    </div>
  )
}
