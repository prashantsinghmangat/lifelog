import { addDays, parseISO, subDays } from 'date-fns'
import { dayKey, dayLabel } from '../lib/format'

type Props = {
  day: string
  now: Date
  onChange: (day: string) => void
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
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

export function DayHeader({ day, now, onChange }: Props) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onChange(dayKey(subDays(parseISO(day), 1)))}
        className="-ml-2 p-2 text-gray-400 active:text-gray-900"
      >
        <Chevron dir="left" />
      </button>

      {/* The visible label is the picker: the native input sits on top of it, invisible. */}
      <label className="relative cursor-pointer px-2 text-base font-semibold">
        {dayLabel(day, now)}
        <input
          type="date"
          value={day}
          aria-label="Pick a date"
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value)
          }}
          className="absolute inset-0 h-full w-full opacity-0"
        />
      </label>

      <button
        type="button"
        aria-label="Next day"
        onClick={() => onChange(dayKey(addDays(parseISO(day), 1)))}
        className="-mr-2 p-2 text-gray-400 active:text-gray-900"
      >
        <Chevron dir="right" />
      </button>
    </div>
  )
}
