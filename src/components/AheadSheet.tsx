import { differenceInCalendarDays, format } from 'date-fns'
import { KIND_NAME, KindMark } from './KindMark'
import { Sheet } from './Sheet'
import { repeatLabel } from '../lib/events'
import { dayKey } from '../lib/format'
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
      <p className="mb-1 text-xs font-medium tracking-wide text-faint uppercase">Coming up</p>

      {upcoming.length === 0 ? (
        <p className="py-2 text-sm text-muted">Nothing in the next fortnight.</p>
      ) : (
        upcoming.map(({ entry, at }) => {
          const detail = [
            when(at, now),
            format(at, 'h:mm a').toLowerCase(),
            repeatLabel(entry),
          ].filter((bit): bit is string => bit !== null)

          return (
            <button
              key={`${entry.id}-${at.getTime()}`}
              type="button"
              onClick={() => onPick(dayKey(at))}
              className="flex min-h-12 w-full items-center gap-3 border-b border-line py-2 text-left active:bg-raised"
            >
              <KindMark kind={entry.kind} />
              <span className="min-w-0 flex-1">
                <span className="sr-only">{KIND_NAME[entry.kind]}. </span>
                <span className="block line-clamp-2 text-sm">{entry.title}</span>
                <span className="mt-0.5 block truncate text-xs text-faint">
                  {detail.join(' · ')}
                </span>
              </span>
            </button>
          )
        })
      )}
    </Sheet>
  )
}
