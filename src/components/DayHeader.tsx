import { addDays, parseISO, subDays } from 'date-fns'
import { type ReactNode } from 'react'
import { Chevron } from './Icons'
import { dayEyebrow, dayKey, dayLabel, dayTitle } from '../lib/format'

type Props = {
  day: string
  now: Date
  onChange: (day: string) => void
  onOpenCalendar: () => void
  /** The bell, when there is anything ahead. Sits with the day's own controls. */
  actions?: ReactNode
}

/**
 * The subject of the screen, in two lines.
 *
 * It was one centred line between two chevrons, which spent the widest part of
 * the header on two 44px arrows and left the date competing with them for the
 * middle. Read left, the eyebrow says which day relative to now and the date
 * below it is the thing itself — the only line in the app allowed to be this
 * size, so nothing else has to shout to be found.
 *
 * The chevrons move to the right as a pair. Stepping a day is a repeated
 * gesture, and two targets beside each other are one place to aim rather than
 * two edges to cross; on a phone they also land under the thumb rather than
 * across the top corners. The date itself stays the way into the calendar, and
 * keeps the accessible name it always had so nothing that looks for it moves.
 */
export function DayHeader({ day, now, onChange, onOpenCalendar, actions }: Props) {
  return (
    <div className="flex items-end justify-between gap-2">
      <button
        type="button"
        onClick={onOpenCalendar}
        aria-label={`${dayLabel(day, now)} — open calendar`}
        className="-mx-1 min-w-0 rounded-lg px-1 py-1 text-left transition-colors hover:bg-sunken active:bg-sunken"
      >
        <span className="block text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
          {dayEyebrow(day, now)}
        </span>
        <span className="mt-0.5 block truncate text-[1.375rem] leading-tight font-semibold tracking-tight sm:text-2xl">
          {dayTitle(day, now)}
        </span>
      </button>

      <div className="flex shrink-0 items-center">
        {actions}
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => onChange(dayKey(subDays(parseISO(day), 1)))}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-faint transition-colors hover:text-ink active:text-ink"
        >
          <Chevron dir="left" size={18} />
        </button>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => onChange(dayKey(addDays(parseISO(day), 1)))}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-faint transition-colors hover:text-ink active:text-ink"
        >
          <Chevron dir="right" size={18} />
        </button>
      </div>
    </div>
  )
}
