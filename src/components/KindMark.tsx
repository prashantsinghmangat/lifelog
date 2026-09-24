import { CalendarIcon, ClockIcon, NoteIcon } from './Icons'
import type { Kind } from '../types'

const TINT: Record<Kind, string> = {
  expense: 'text-expense',
  time: 'text-time',
  event: 'text-event',
  note: 'text-note',
}

/** Meaning is never carried by colour alone, so this sits beside every mark. */
export const KIND_NAME: Record<Kind, string> = {
  expense: 'Expense',
  time: 'Time log',
  event: 'Event',
  note: 'Note',
}

/**
 * Expense uses the rupee glyph rather than a drawn icon — at this size a
 * currency symbol is read instantly and a wallet or coin shape is a guess.
 * The icon is decorative: `KIND_NAME` carries the same fact to a screen reader.
 *
 * 15px, in a 20px gutter. These are **scanning accents**, not four UI colours:
 * the mark is how you find the expenses in a day at a glance, and at 16px in
 * the old saturated hues four of them down a column competed with the titles
 * they were marking. Deepening the tokens and taking a pixel off the glyph
 * leaves the same information and stops it being the loudest thing in the row.
 */
export function KindMark({ kind }: { kind: Kind }) {
  return (
    <span className={`flex w-5 shrink-0 justify-center ${TINT[kind]}`} aria-hidden="true">
      {kind === 'expense' ? (
        <span className="text-[0.9375rem] leading-none font-semibold">₹</span>
      ) : kind === 'time' ? (
        <ClockIcon size={15} />
      ) : kind === 'event' ? (
        <CalendarIcon size={15} />
      ) : (
        <NoteIcon size={15} />
      )}
    </span>
  )
}
