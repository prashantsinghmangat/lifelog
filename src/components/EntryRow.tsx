import { clock, minutes, relativeDay, rupees } from '../lib/format'
import type { Row } from '../hooks/useEntries'
import type { Kind } from '../types'

const DOT: Record<Kind, string> = {
  expense: 'bg-expense',
  time: 'bg-time',
  event: 'bg-event',
  note: 'bg-note',
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
  const detail = [
    row.occurred_at === null ? null : clock(row.occurred_at),
    row.category,
    offDay ? relativeDay(row.occurred_on, now) : null,
  ].filter((bit): bit is string => bit !== null)

  const right = value(row)

  return (
    <div
      className={`row-in flex items-center gap-3 border-b border-gray-100 py-2 ${
        row.status === 'saving' ? 'opacity-60' : ''
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[row.kind]}`} aria-hidden="true" />

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm">{row.title}</div>
        {detail.length > 0 && <div className="truncate text-xs text-gray-400">{detail.join(' · ')}</div>}
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
          className="shrink-0 px-1 text-gray-300 active:text-expense"
        >
          ×
        </button>
      )}
    </div>
  )
}
