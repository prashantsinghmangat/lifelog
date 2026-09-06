import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { useState } from 'react'
import { DayCell, WEEKDAYS, WEEK_STARTS } from './DayCell'
import { Chevron } from './Icons'
import { useMarkedDays } from '../hooks/useMarkedDays'
import { dayKey } from '../lib/format'

type Props = {
  /** The currently selected day, yyyy-MM-dd. */
  day: string
  now: Date
  loadDays: (from: string, to: string) => Promise<string[]>
  onPick: (day: string) => void
}

/**
 * Navigation, not a scheduler. A dot means something happened that day; the
 * only job is getting to that day in one tap.
 */
export function MonthGrid({ day, now, loadDays, onPick }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(parseISO(day)))

  const gridStart = startOfWeek(month, WEEK_STARTS)
  const gridEnd = endOfWeek(endOfMonth(month), WEEK_STARTS)
  const marked = useMarkedDays(dayKey(gridStart), dayKey(gridEnd), loadDays)
  const today = dayKey(now)

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth(subMonths(month, 1))}
          className="-ml-1.5 flex h-11 w-11 items-center justify-center text-faint active:text-ink"
        >
          <Chevron dir="left" size={18} />
        </button>
        <span className="text-sm font-semibold">{format(month, 'MMMM yyyy')}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth(addMonths(month, 1))}
          className="-mr-1.5 flex h-11 w-11 items-center justify-center text-faint active:text-ink"
        >
          <Chevron dir="right" size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs text-faint" aria-hidden="true">
        {WEEKDAYS.map((letter, index) => (
          <span key={index}>{letter}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7">
        {eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => (
          <DayCell
            key={dayKey(date)}
            date={date}
            day={day}
            today={today}
            marked={marked.has(dayKey(date))}
            outside={!isSameMonth(date, month)}
            onPick={onPick}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onPick(today)}
        className="mt-1 w-full py-2 text-xs text-muted underline"
      >
        Today
      </button>
    </div>
  )
}
