import { differenceInCalendarDays, format } from 'date-fns'
import { KIND_NAME, KindMark } from './KindMark'
import { Sheet } from './Sheet'
import { repeatLabel } from '../lib/events'
import { clockAt, dayKey, until } from '../lib/format'
import type { Upcoming } from '../lib/ahead'

/**
 * Everything the phone is going to raise, soonest first.
 *
 * Read-only on purpose: it answers "what is coming" and then gets out of the
 * way. Tapping a row goes to the day it belongs to, where the entry can be
 * edited like any other — a second editor here would be a second place for the
 * same thing to live.
 */

type Props = {
  upcoming: Upcoming[]
  now: Date
  onPick: (day: string) => void
  onClose: () => void
}

/** "today", "tomorrow", then the weekday — a fortnight needs no dates. */
function when(at: Date, now: Date): string {
  const away = differenceInCalendarDays(at, now)
  if (away === 0) return 'today'
  if (away === 1) return 'tomorrow'
  return format(at, away < 7 ? 'EEEE' : 'EEE d MMM')
}

export function AheadSheet({ upcoming, now, onPick, onClose }: Props) {
  return (
    <Sheet label="What is coming" onClose={onClose}>
      <p className="mb-2 text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
        Coming up
      </p>

      {upcoming.length === 0 ? (
        <p className="py-2 text-sm text-muted">Nothing in the next fortnight.</p>
      ) : (
        upcoming.map(({ entry, at }) => {
          const timeAt = clockAt(at)
          const rest = [
            // This sheet exists to answer "what is the phone going to do", and
            // for anything left today "in 47m" answers it where "today" only
            // repeats what the sheet already said. `until` is null on any other
            // day, so the weekday wording still covers the rest of the fortnight.
            until(at, now) ?? when(at, now),
            repeatLabel(entry),
          ].filter((bit): bit is string => bit !== null)

          return (
            <button
              key={`${entry.id}-${at.getTime()}`}
              type="button"
              onClick={() => onPick(dayKey(at))}
              className="-mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-lg border-b border-line px-2 py-2 text-left transition-colors hover:bg-sunken active:bg-sunken"
            >
              <KindMark kind={entry.kind} />
              <span className="min-w-0 flex-1">
                <span className="sr-only">{KIND_NAME[entry.kind]}. </span>
                {/* No `block`: it would override the clamp's display. See EntryRow. */}
                <span className="line-clamp-2 text-sm leading-snug text-ink">{entry.title}</span>
                {/* The clock leads, a step forward of the rest of the line —
                    the same rule the timeline itself follows. */}
                <span className="mt-1 block truncate text-xs text-faint">
                  <span className="text-muted tabular-nums">{timeAt}</span>
                  {rest.length > 0 && ' · '}
                  {rest.join(' · ')}
                </span>
              </span>
            </button>
          )
        })
      )}
    </Sheet>
  )
}
