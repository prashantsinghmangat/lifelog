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
 */
export function KindMark({ kind }: { kind: Kind }) {
  return (
    <span className={`flex w-5 shrink-0 justify-center ${TINT[kind]}`} aria-hidden="true">
      {kind === 'expense' ? (
        <span className="text-base leading-none font-semibold">₹</span>
      ) : kind === 'time' ? (
        <ClockIcon size={16} />
      ) : kind === 'event' ? (
        <CalendarIcon size={16} />
      ) : (
        <NoteIcon size={16} />
      )}
    </span>
  )
}
