import { addDays, eachDayOfInterval, format, parseISO, startOfWeek } from 'date-fns'
import { useMarkedDays } from '../hooks/useMarkedDays'
import { WEEK_STARTS, dayKey } from '../lib/format'

/**
 * The week you are in, always visible.
 *
 * Chevrons and swiping move one day at a time, which is fine for yesterday and
 * useless for Tuesday: the calendar sheet was the only way there, and it costs
 * a tap to open and a tap to dismiss. Seven buttons cost nothing and answer
 * "where am I in the week" without being asked.
 *
 * Its own cells since Variant E (021), no longer `DayCell`: the strip's cell
 * carries the weekday letter inside it and fills the selected day with the
 * accent, which is a different anatomy from the month grid's disc — one
 * component bent to serve both was how they would drift.
 *
 * Not rendered on wide screens, where the sidebar already shows the whole
 * month — the same information for zero taps, so a second copy is just noise.
 */

type Props = {
  /** The currently selected day, yyyy-MM-dd. */
  day: string
  now: Date
  loadDays: (from: string, to: string) => Promise<string[]>
  onPick: (day: string) => void
}

export function WeekStrip({ day, now, loadDays, onPick }: Props) {
  const start = startOfWeek(parseISO(day), WEEK_STARTS)
  const end = addDays(start, 6)
  const marked = useMarkedDays(dayKey(start), dayKey(end), loadDays)
  const today = dayKey(now)

  return (
    <nav aria-label="This week" className="lg:hidden">
      <div className="grid grid-cols-7 gap-1 rounded-2xl border border-line bg-raised p-1.5">
        {eachDayOfInterval({ start, end }).map((date) => {
          const key = dayKey(date)
          const selected = key === day
          const isToday = key === today
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-label={format(date, 'EEEE d MMMM yyyy')}
              aria-current={selected ? 'date' : undefined}
              className={`flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-xl py-1 transition-colors ${
                selected ? 'bg-accent' : 'hover:bg-sunken active:bg-sunken'
              }`}
            >
              <span
                aria-hidden="true"
                className={`text-[0.625rem] font-semibold uppercase ${
                  selected ? 'text-surface/70' : 'text-faint'
                }`}
              >
                {format(date, 'EEEEE')}
              </span>
              <span
                aria-hidden="true"
                className={`mt-0.5 text-[13px] tabular-nums ${
                  selected
                    ? 'font-bold text-surface'
                    : isToday
                      ? 'font-bold text-accent'
                      : 'font-medium text-ink'
                }`}
              >
                {format(date, 'd')}
              </span>
              {/* The dot means something happened that day — the same fact
                  the month grid's dots carry, nothing more. */}
              <span
                aria-hidden="true"
                className={`mt-1 h-1 w-1 rounded-full ${
                  marked.has(key) ? (selected ? 'bg-surface/80' : 'bg-edge/40') : 'bg-transparent'
                }`}
              />
            </button>
          )
        })}
      </div>
    </nav>
  )
}
