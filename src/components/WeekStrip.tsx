import { addDays, eachDayOfInterval, parseISO, startOfWeek } from 'date-fns'
import { DayCell, WEEKDAYS, WEEK_STARTS } from './DayCell'
import { useMarkedDays } from '../hooks/useMarkedDays'
import { dayKey } from '../lib/format'

/**
 * The week you are in, always visible.
 *
 * Chevrons and swiping move one day at a time, which is fine for yesterday and
 * useless for Tuesday: the calendar sheet was the only way there, and it costs
 * a tap to open and a tap to dismiss. Seven buttons cost nothing and answer
 * "where am I in the week" without being asked.
 *
 * Not rendered on wide screens, where the sidebar already shows the whole month
 * — the same information for zero taps, so a second copy is just noise.
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
      <div className="grid grid-cols-7 text-center text-xs text-faint" aria-hidden="true">
        {WEEKDAYS.map((letter, index) => (
          <span key={index}>{letter}</span>
        ))}
      </div>

      <div className="mt-0.5 grid grid-cols-7">
        {eachDayOfInterval({ start, end }).map((date) => (
          <DayCell
            key={dayKey(date)}
            date={date}
            day={day}
            today={today}
            marked={marked.has(dayKey(date))}
            onPick={onPick}
          />
        ))}
      </div>
    </nav>
  )
}
