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
import { useEffect, useState } from 'react'
import { Chevron } from './Icons'
import { dayKey } from '../lib/format'

// Monday first. Repeated letters are fine — the columns are positional, and the
// full weekday name is on each cell for screen readers.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEK_STARTS = { weekStartsOn: 1 } as const

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
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set())

  const gridStart = startOfWeek(month, WEEK_STARTS)
  const gridEnd = endOfWeek(endOfMonth(month), WEEK_STARTS)
  // Strings, so the effect below has stable dependencies.
  const from = dayKey(gridStart)
  const to = dayKey(gridEnd)

  useEffect(() => {
    let live = true
    void loadDays(from, to)
      .then((days) => {
        if (live) setMarked(new Set(days))
      })
      .catch(() => {
        // Dots are decoration; a failed lookup must not break navigation.
        if (live) setMarked(new Set())
      })
    return () => {
      live = false
    }
  }, [from, to, loadDays])

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
        {eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => {
          const key = dayKey(date)
          const selected = key === day
          const outside = !isSameMonth(date, month)
          const has = marked.has(key)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-current={selected ? 'date' : undefined}
              // The dot is decorative; the label carries the same fact in words.
              aria-label={`${format(date, 'EEEE d MMMM yyyy')}${has ? ', has entries' : ''}`}
              className={`flex h-11 flex-col items-center justify-center rounded text-sm ${
                selected
                  ? 'bg-ink font-medium text-surface'
                  : outside
                    ? 'text-faint'
                    : key === today
                      ? 'font-semibold text-ink'
                      : 'text-muted'
              }`}
            >
              <span aria-hidden="true">{format(date, 'd')}</span>
              <span
                aria-hidden="true"
                className={`mt-1 h-1 w-1 rounded-full ${
                  !has ? 'bg-transparent' : selected ? 'bg-surface' : 'bg-note'
                }`}
              />
            </button>
          )
        })}
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
