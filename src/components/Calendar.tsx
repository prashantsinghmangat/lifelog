import { useState } from 'react'
import { MonthGrid } from './MonthGrid'
import { Stats } from './Stats'
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
 * One destination, two views: the grid for getting to a day, the chart for how
 * much and how often.
 *
 * The grid stays pure navigation — a tap on 14 September ends on the timeline
 * for 14 September, never in a sub-view of the stats. The chart is `Stats`,
 * which drills within itself and never writes. The month figures that used to
 * sit under the grid moved into the chart's blocks, which say strictly more;
 * one destination carrying two disagreeing figure blocks is how a reader stops
 * trusting either.
 */
export function Calendar({ day, now, all, loadDays, onPick }: Props) {
  /**
   * Two views of one destination: the grid for getting to a day, the chart for
   * how much and how often. A toggle rather than a fifth destination — the nav
   * holds four items and a screen that both gets you somewhere and tells you
   * how much is strictly more useful in the same slot.
   */
  const [look, setLook] = useState<'grid' | 'chart'>('grid')

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

      {/* Pure navigation again: the numbers moved to the chart view, whose
          blocks say strictly more than the three figures that used to sit
          under the grid — and one destination carrying two disagreeing figure
          blocks is how a reader stops trusting either. */}
      {look === 'grid' && (
        <MonthGrid day={day} now={now} loadDays={loadDays} onPick={onPick} />
      )}
    </div>
  )
}
