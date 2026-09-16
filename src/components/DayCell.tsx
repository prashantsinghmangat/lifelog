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
      // The target is 44px and the mark inside it is 28. Filling the whole cell
      // made the selected day a solid block the width of the column — the
      // loudest thing on a surface whose entire job is navigation, and in dark
      // mode a slab of near-white. A disc the size of the number says the same
      // thing and lets the grid stay a grid.
      //
      // `min-` rather than a fixed size, and that is not a detail: with Android's
      // font scale at 2× a 28px disc kept its size while the date inside it
      // doubled, so the number sat half outside its own circle. Anything whose
      // size is decided by the text it holds has to be a floor, not a value.
      // Verified on the emulator at font_scale 1.3 and 2.0.
      //
      // Three states, three strengths, and only the selected one is filled:
      // today is a ring, because two filled cells read as two selections and
      // the one you chose has to win outright.
      className="group flex min-h-11 flex-col items-center justify-center"
    >
      <span
        aria-hidden="true"
        className={`flex min-h-7 min-w-7 items-center justify-center rounded-full px-1 py-0.5 text-sm tabular-nums transition-colors ${
          selected
            ? 'bg-ink font-medium text-surface'
            : outside
              ? 'text-faint group-hover:bg-sunken'
              : key === today
                ? 'border border-edge font-semibold text-ink group-hover:bg-sunken'
                : 'text-muted group-hover:bg-sunken'
        }`}
      >
        {format(date, 'd')}
      </span>
      {/* Decorative: the label says "has entries" in words. Neutral rather than
          a kind colour — a dot on the calendar means something happened, not
          that a note happened. */}
      <span
        aria-hidden="true"
        className={`mt-1 h-1 w-1 rounded-full ${
          !marked ? 'bg-transparent' : selected ? 'bg-ink' : 'bg-faint'
        }`}
      />
    </button>
  )
}
