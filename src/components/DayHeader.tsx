import { format, parseISO } from 'date-fns'
import { type ReactNode } from 'react'
import { dayLabel } from '../lib/format'

type Props = {
  day: string
  now: Date
  onOpenCalendar: () => void
  /** The bell, when there is anything ahead. Sits with the day's own meta. */
  actions?: ReactNode
}

/**
 * The subject of the screen, said editorially — Variant E (021): the weekday
 * and an italic day number, the month italic and stepped back beneath, the
 * ISO week at the right. The only lines in the app allowed this size.
 *
 * The chevrons are gone: swiping, the week strip, the keyboard arrows and the
 * calendar all still step days, and the pair of 44px targets spent the
 * widest part of the header on the one gesture that had four other routes.
 */
export function DayHeader({ day, now, onOpenCalendar, actions }: Props) {
  const at = parseISO(day)

  const said = (
    <>
      <span className="block truncate font-display text-[26px] leading-tight font-semibold tracking-tight text-ink">
        {format(at, 'EEEE')}, <span className="font-normal italic">{format(at, 'd')}</span>
      </span>
      <span className="block truncate font-display text-[21px] leading-tight italic text-muted">
        {format(at, 'MMMM')}
      </span>
    </>
  )

  return (
    <div className="flex items-start justify-between gap-2">
      {/* The date is the way to the calendar on a phone, where the calendar is a
          destination in the bottom nav. On a wide screen it is a label and
          nothing else: the sidebar has held the whole month, permanently and at
          no taps, since long before the nav existed. */}
      <button
        type="button"
        onClick={onOpenCalendar}
        aria-label={`${dayLabel(day, now)} — open calendar`}
        className="-mx-1 min-w-0 rounded-lg px-1 py-1 text-left transition-colors hover:bg-sunken active:bg-sunken lg:hidden"
      >
        {said}
      </button>
      <div className="-mx-1 hidden min-w-0 px-1 py-1 lg:block">{said}</div>

      <div className="flex shrink-0 items-center gap-1 pt-1.5">
        <span className="text-[0.6875rem] font-medium text-faint tabular-nums">
          Week {format(at, 'I')}
        </span>
        {actions}
      </div>
    </div>
  )
}
