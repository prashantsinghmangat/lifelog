import { format } from 'date-fns'
import { dayKey } from '../lib/format'

/**
 * One day, wherever days are laid out in a grid — the month sheet, the sidebar
 * calendar, the week strip. Shared so that selected, today and has-entries never
 * come to mean three different things depending on which grid you are looking at.
 */

// Monday first. Repeated letters are fine — the columns are positional, and the
// full weekday name is on each cell for screen readers.
export const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** The one place the week starts, since two answers to that is a bug you see. */
export const WEEK_STARTS = { weekStartsOn: 1 } as const

type Props = {
  date: Date
  /** The currently selected day, yyyy-MM-dd. */
  day: string
  /** Today, yyyy-MM-dd. */
  today: string
  /** Something happened that day. */
  marked: boolean
  /** Dimmed, because it belongs to a neighbouring month. */
  outside?: boolean
  onPick: (day: string) => void
}

export function DayCell({ date, day, today, marked, outside = false, onPick }: Props) {
  const key = dayKey(date)
  const selected = key === day

  return (
    <button
      type="button"
      onClick={() => onPick(key)}
      aria-current={selected ? 'date' : undefined}
      // The dot is decorative; the label carries the same fact in words.
      aria-label={`${format(date, 'EEEE d MMMM yyyy')}${marked ? ', has entries' : ''}`}
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
          !marked ? 'bg-transparent' : selected ? 'bg-surface' : 'bg-note'
        }`}
      />
    </button>
  )
}
