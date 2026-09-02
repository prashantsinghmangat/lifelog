import { MonthGrid } from './MonthGrid'
import { Sheet } from './Sheet'

type Props = {
  day: string
  now: Date
  loadDays: (from: string, to: string) => Promise<string[]>
  onPick: (day: string) => void
  onClose: () => void
}

/** The calendar as a modal, for compact and medium widths. Wide layouts render
 *  `MonthGrid` directly in the sidebar, where it costs no taps at all. */
export function MonthSheet({ day, now, loadDays, onPick, onClose }: Props) {
  return (
    <Sheet label="Pick a date" onClose={onClose}>
      <MonthGrid day={day} now={now} loadDays={loadDays} onPick={onPick} />
    </Sheet>
  )
}
