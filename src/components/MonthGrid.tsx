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
import { DayCell, WEEKDAYS } from './DayCell'
import { Chevron } from './Icons'
import { useMarkedDays } from '../hooks/useMarkedDays'
import { WEEK_STARTS, dayKey } from '../lib/format'

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

  /**
   * Browsing months is this component's own state; the selected day is not.
   *
   * The sheet is mounted fresh each time it opens, so it never noticed — but on
   * a wide screen the sidebar grid stays mounted for the life of the app, and
   * everything that moves the day from somewhere else (an answer row, a memory
   * from 2022, the bell, an arrow key across the 1st) left it showing a month
   * the selected day is not in, with no cell marked anywhere on it.
   *
   * Reconciled during render rather than in an effect, so the grid never paints
   * the wrong month first. Only when the day leaves the month on show, or
   * stepping back a month and tapping a day in it would snap straight forward
   * again.
   */
  const [shownFor, setShownFor] = useState(day)
  if (shownFor !== day) {
    setShownFor(day)
    const picked = parseISO(day)
    if (!isSameMonth(picked, month)) setMonth(startOfMonth(picked))
  }

  const gridStart = startOfWeek(month, WEEK_STARTS)
  const gridEnd = endOfWeek(endOfMonth(month), WEEK_STARTS)
  const marked = useMarkedDays(dayKey(gridStart), dayKey(gridEnd), loadDays)
  const today = dayKey(now)

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth(subMonths(month, 1))}
          className="-ml-2.5 flex h-11 w-11 items-center justify-center rounded-lg text-faint transition-colors hover:text-ink active:text-ink"
        >
          <Chevron dir="left" size={18} />
        </button>
        <span className="text-[0.8125rem] font-semibold tracking-tight">
          {format(month, 'MMMM yyyy')}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth(addMonths(month, 1))}
          className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-lg text-faint transition-colors hover:text-ink active:text-ink"
        >
          <Chevron dir="right" size={18} />
        </button>
      </div>

      <div
        className="grid grid-cols-7 text-center text-[0.625rem] font-medium tracking-[0.08em] text-faint uppercase"
        aria-hidden="true"
      >
        {WEEKDAYS.map((letter, index) => (
          <span key={index}>{letter}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-0.5">
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
        className="mt-2 flex h-11 w-full items-center justify-center rounded-lg text-xs text-muted transition-colors hover:bg-sunken hover:text-ink"
      >
        Today
      </button>
    </div>
  )
}
