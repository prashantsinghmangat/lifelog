import { format, parseISO } from 'date-fns'
import { KIND_NAME, KindMark } from './KindMark'
import { rowValue } from '../lib/format'
import type { Recollection } from '../lib/history'

/**
 * The same day in earlier years, under the day you are looking at.
 *
 * Not a page, a dashboard or a mode: looking back is the last step of the loop
 * the app already has, so it sits at the bottom of the timeline where you
 * arrive at it by scrolling rather than by navigating. It renders nothing at
 * all until there is something to recall, which for a new log is most days.
 *
 * A whole year is one button, because the only thing anyone wants from a
 * memory this size is to go and read the rest of that day.
 */

/** Two years back is a memory. Five is a list, and a list is a different feature. */
const YEARS = 2

/** Enough to recognise the day; opening it shows everything. */
const ENTRIES = 3

type Props = {
  found: Recollection[]
  onPick: (day: string) => void
}

export function OnThisDay({ found, onPick }: Props) {
  if (found.length === 0) return null

  return (
    <section className="mt-10 border-t border-line pt-5">
      <h2 className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
        On this day
      </h2>

      <div className="mt-2">
        {found.slice(0, YEARS).map((year) => {
          const shown = year.entries.slice(0, ENTRIES)
          const rest = year.entries.length - shown.length

          return (
            <button
              key={year.day}
              type="button"
              onClick={() => onPick(year.day)}
              className="-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-sunken active:bg-sunken"
            >
              <span className="block text-xs font-medium text-muted tabular-nums">
                {format(parseISO(year.day), 'd MMMM yyyy')}
              </span>

              {shown.map((entry) => {
                const right = rowValue(entry)

                return (
                  <span key={entry.id} className="mt-1.5 flex items-center gap-3">
                    <KindMark kind={entry.kind} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      <span className="sr-only">{KIND_NAME[entry.kind]}. </span>
                      {entry.title}
                    </span>
                    {right !== null && (
                      <span className="shrink-0 text-xs text-muted tabular-nums">{right}</span>
                    )}
                  </span>
                )
              })}

              {rest > 0 && <span className="mt-1.5 block text-xs text-faint">and {rest} more</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}
