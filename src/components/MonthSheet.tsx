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
import { dayKey } from '../lib/format'

// Monday first. Duplicated letters are fine at this size; the columns are positional.
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEK_STARTS = { weekStartsOn: 1 } as const

type Props = {
  /** The currently selected day, yyyy-MM-dd. */
  day: string
  now: Date
  loadDays: (from: string, to: string) => Promise<string[]>
  onPick: (day: string) => void
  onClose: () => void
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

export function MonthSheet({ day, now, loadDays, onPick, onClose }: Props) {
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
        // Dots are decoration; a failed lookup should not break navigation.
        if (live) setMarked(new Set())
      })
    return () => {
      live = false
    }
  }, [from, to, loadDays])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = dayKey(now)

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-10 flex items-start justify-center bg-black/30 px-4 pt-14"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick a date"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-white p-3 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(subMonths(month, 1))}
            className="p-1.5 text-gray-400 active:text-gray-900"
          >
            <Chevron dir="left" />
          </button>
          <span className="text-sm font-semibold">{format(month, 'MMMM yyyy')}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(addMonths(month, 1))}
            className="p-1.5 text-gray-400 active:text-gray-900"
          >
            <Chevron dir="right" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 text-center text-xs text-gray-400">
          {WEEKDAYS.map((letter, index) => (
            <span key={index}>{letter}</span>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7">
          {eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => {
            const key = dayKey(date)
            const selected = key === day
            const outside = !isSameMonth(date, month)

            return (
              <button
                key={key}
                type="button"
                onClick={() => onPick(key)}
                aria-current={selected ? 'date' : undefined}
                className={`flex flex-col items-center rounded py-1.5 text-sm ${
                  selected
                    ? 'bg-gray-900 text-white'
                    : outside
                      ? 'text-gray-300'
                      : key === today
                        ? 'font-semibold text-gray-900'
                        : 'text-gray-700'
                }`}
              >
                {format(date, 'd')}
                <span
                  aria-hidden="true"
                  className={`mt-1 h-1 w-1 rounded-full ${
                    !marked.has(key)
                      ? 'bg-transparent'
                      : selected
                        ? 'bg-white'
                        : 'bg-note'
                  }`}
                />
              </button>
            )
          })}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs">
          <button type="button" onClick={() => onPick(today)} className="text-gray-500 underline">
            Today
          </button>
          <button type="button" onClick={onClose} className="px-1 text-gray-400">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
