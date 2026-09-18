import { format, parseISO, startOfMonth } from 'date-fns'
import { useState } from 'react'
import { MonthGrid } from './MonthGrid'
import { Stats } from './Stats'
import { minutes, rupees } from '../lib/format'
import type { Entry } from '../types'

type Props = {
  day: string
  now: Date
  /** This device's whole log, which is what the figures are counted from. */
  all: Entry[]
  loadDays: (from: string, to: string) => Promise<string[]>
  onPick: (day: string) => void
}

/**
 * The month, and what the month came to.
 *
 * The grid was a sheet behind the date — a tap to open and a tap to dismiss for
 * something that is navigation, which is exactly the shape a destination has
 * instead. Given the screen rather than a modal it has room for the one thing
 * the dots could never say: a dot means *something* happened that day, and the
 * figures under the grid say what all of it added up to.
 *
 * Counted from the **stored** rows only, the same rule the day's totals follow
 * and for the same reason: a repeat is one row drawn on every day it lands on,
 * so counting the occurrences would report a standup costing five times what it
 * did. It also keeps the figures in step with the dots, which `fetchDays` builds
 * from stored `occurred_on` and nothing else.
 *
 * Read from this device's log rather than from a fetch, for the reason the bell
 * reads it: an entry typed a moment ago has to be in a figure that claims to
 * total the month it landed in. Costs no query either way.
 */
export function Calendar({ day, now, all, loadDays, onPick }: Props) {
  /**
   * Two views of one destination: the grid for getting to a day, the chart for
   * how much and how often. A toggle rather than a fifth destination — the nav
   * holds four items and a screen that both gets you somewhere and tells you
   * how much is strictly more useful in the same slot.
   */
  const [look, setLook] = useState<'grid' | 'chart'>('grid')

  // The month the *grid* is showing, which is not always the month the selected
  // day is in — browsing back through the year must move the figures with it.
  const [month, setMonth] = useState(() => startOfMonth(parseISO(day)))
  const within = format(month, 'yyyy-MM')

  const rows = all.filter((row) => row.occurred_on.startsWith(within))
  const spent = rows.reduce((total, row) => total + (row.amount_paise ?? 0), 0)
  const logged = rows.reduce((total, row) => total + (row.duration_minutes ?? 0), 0)
  const days = new Set(rows.map((row) => row.occurred_on)).size

  return (
    <div>
      {/* The same segmented shape the theme control uses, at 44px: a 40px pill
          inside a full-height button, so the target never shrinks to fit the
          decoration. */}
      <div role="group" aria-label="Calendar view" className="mb-4 flex gap-1 rounded-xl border border-line bg-sunken p-0.5">
        {(['grid', 'chart'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={look === option}
            onClick={() => setLook(option)}
            className={`h-11 flex-1 rounded-[11px] px-2 text-sm transition-colors ${
              look === option
                ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted hover:text-ink'
            }`}
          >
            {option === 'grid' ? 'Grid' : 'Chart'}
          </button>
        ))}
      </div>

      {look === 'chart' && <Stats all={all} now={now} day={day} />}

      {look === 'grid' && (
        <>
      <MonthGrid day={day} now={now} loadDays={loadDays} onPick={onPick} onMonth={setMonth} />

      {/* Under what it summarises, with the grid's own edge as the rule above
          it — the same shape the day's totals take under the last row. */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
          {format(month, 'MMMM')}
        </p>

        {/* The figures lead and their names sit back. Money is the one allowed
            to be big here: it is what the month is usually being asked about,
            and nothing else on this screen is competing for the size. */}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs text-faint">
          {/* Not `> 0`: a month whose only money is a refund has a total, and
              hiding it says the month carried none at all. */}
          {spent !== 0 && (
            <span>
              <span className="text-[1.375rem] leading-tight font-semibold text-ink tabular-nums">
                {rupees(spent)}
              </span>{' '}
              spent
            </span>
          )}
          {logged > 0 && (
            <span>
              <span className="text-sm font-medium text-ink tabular-nums">{minutes(logged)}</span>{' '}
              logged
            </span>
          )}
          <span>
            <span className="text-sm font-medium text-ink tabular-nums">{days}</span>{' '}
            {days === 1 ? 'day with entries' : 'days with entries'}
          </span>
        </p>
      </div>
        </>
      )}
    </div>
  )
}
