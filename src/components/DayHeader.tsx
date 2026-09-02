import { addDays, parseISO, subDays } from 'date-fns'
import { CalendarIcon, Chevron } from './Icons'
import { dayKey, dayLabel } from '../lib/format'

type Props = {
  day: string
  now: Date
  onChange: (day: string) => void
  onOpenCalendar: () => void
}

export function DayHeader({ day, now, onChange, onOpenCalendar }: Props) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onChange(dayKey(subDays(parseISO(day), 1)))}
        className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-faint active:text-ink"
      >
        <Chevron dir="left" />
      </button>

      {/* The icon is the whole point: without it nobody finds the month sheet. */}
      <button
        type="button"
        onClick={onOpenCalendar}
        aria-label={`${dayLabel(day, now)} — open calendar`}
        className="flex h-11 min-w-0 items-center justify-center gap-1.5 px-2 text-base font-semibold"
      >
        <CalendarIcon size={16} className="text-faint" />
        {dayLabel(day, now)}
      </button>

      <button
        type="button"
        aria-label="Next day"
        onClick={() => onChange(dayKey(addDays(parseISO(day), 1)))}
        className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-faint active:text-ink"
      >
        <Chevron dir="right" />
      </button>
    </div>
  )
}
