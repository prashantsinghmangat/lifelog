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

/**
 * Expense uses the rupee glyph rather than a drawn icon — at 16px a currency
 * symbol is read instantly and any wallet or coin shape is a guess.
 */
function KindMark({ kind }: { kind: Kind }) {
  return (
    <span
      className={`flex w-5 shrink-0 justify-center ${TINT[kind]}`}
      title={kind}
      aria-hidden="true"
    >
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
  onDelete: () => void
  onRetry: () => void
}

function value(row: Row): string | null {
  if (row.amount_paise !== null) return rupees(row.amount_paise)
  if (row.duration_minutes !== null) return minutes(row.duration_minutes)
  return null
}

export function EntryRow({ row, now, offDay = false, onOpen, onDelete, onRetry }: Props) {
  const right = value(row)
  const at = row.occurred_at === null ? null : clock(row.occurred_at)
  const detail = [row.category, offDay ? relativeDay(row.occurred_on, now) : null].filter(
    (bit): bit is string => bit !== null && bit !== '',
  )

  return (
    <div
      className={`row-in flex items-center gap-2.5 border-b border-line py-2.5 ${
        row.status === 'saving' ? 'opacity-60' : ''
      }`}
    >
      <KindMark kind={row.kind} />

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm">{row.title}</div>
        {(at !== null || detail.length > 0) && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-faint">
            {at !== null && (
              <>
                <ClockIcon size={11} />
                <span>{at}</span>
              </>
            )}
            {at !== null && detail.length > 0 && <span>·</span>}
            {detail.length > 0 && <span className="truncate">{detail.join(' · ')}</span>}
          </div>
        )}
      </button>

      {right !== null && <span className="shrink-0 text-sm tabular-nums">{right}</span>}

      {row.status === 'failed' ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-expense px-2 py-0.5 text-xs text-expense"
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Delete ${row.title}`}
          onClick={onDelete}
          className="shrink-0 px-1 text-faint active:text-expense"
        >
          ×
        </button>
      )}
    </div>
  )
}
