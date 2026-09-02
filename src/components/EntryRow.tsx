import { CalendarIcon, ClockIcon, NoteIcon } from './Icons'
import { clock, minutes, relativeDay, rupees } from '../lib/format'
import type { Row } from '../hooks/useEntries'
import type { Kind } from '../types'

const TINT: Record<Kind, string> = {
  expense: 'text-expense',
  time: 'text-time',
  event: 'text-event',
  note: 'text-note',
}

const KIND_NAME: Record<Kind, string> = {
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
function KindMark({ kind }: { kind: Kind }) {
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

type Props = {
  row: Row
  now: Date
  /** True when the row sits on a day other than the one being viewed. */
  offDay?: boolean
  onOpen: () => void
  onRetry: () => void
}

function value(row: Row): string | null {
  if (row.amount_paise !== null) return rupees(row.amount_paise)
  if (row.duration_minutes !== null) return minutes(row.duration_minutes)
  return null
}

export function EntryRow({ row, now, offDay = false, onOpen, onRetry }: Props) {
  const right = value(row)
  const at = row.occurred_at === null ? null : clock(row.occurred_at)
  const detail = [
    at,
    row.category,
    offDay ? relativeDay(row.occurred_on, now) : null,
  ].filter((bit): bit is string => bit !== null && bit !== '')

  return (
    <div
      className={`row-in flex items-stretch border-b border-line ${
        row.status === 'saving' ? 'opacity-60' : ''
      }`}
    >
      {/* The whole row is the target: one tap opens everything about the entry. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[3.25rem] min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <KindMark kind={row.kind} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{row.title}</span>
          <span className="sr-only">{KIND_NAME[row.kind]}. </span>
          {detail.length > 0 && (
            <span className="mt-0.5 block truncate text-xs text-faint">{detail.join(' · ')}</span>
          )}
        </span>

        {right !== null && (
          <span className="shrink-0 text-sm font-medium tabular-nums">{right}</span>
        )}
      </button>

      {row.status === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          className="my-2 ml-3 shrink-0 self-center rounded border border-expense px-2 py-1 text-xs text-expense"
        >
          Retry
        </button>
      )}
    </div>
  )
}
