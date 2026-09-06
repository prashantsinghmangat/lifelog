import { KIND_NAME, KindMark } from './KindMark'
import { clock, minutes, relativeDay, rupees } from '../lib/format'
import type { Row } from '../hooks/useEntries'

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
