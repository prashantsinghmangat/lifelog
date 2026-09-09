import { KIND_NAME, KindMark } from './KindMark'
import { behindYou } from '../lib/events'
import { clock, relativeDay, rowValue } from '../lib/format'
import type { Row } from '../hooks/useEntries'

type Props = {
  row: Row
  now: Date
  /** True when the row sits on a day other than the one being viewed. */
  offDay?: boolean
  onOpen: () => void
  onRetry: () => void
}

export function EntryRow({ row, now, offDay = false, onOpen, onRetry }: Props) {
  const right = rowValue(row)
  const gone = behindYou(row, now)
  const at = row.occurred_at === null ? null : clock(row.occurred_at)
  const detail = [
    at,
    row.category,
    offDay ? relativeDay(row.occurred_on, now) : null,
    // Words, not a colour or an icon: the row is saved on this device and the
    // server has not seen it, which is worth knowing and is not a problem.
    row.status === 'queued' ? 'saved here, not synced' : null,
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
          {/* Behind you — the moment went by, or you ticked it off. Struck
              rather than hidden: it still happened.

              Two lines, not one. A truncated title told you that an entry
              existed and not what it was, and the longest titles are the notes,
              where the words are the whole content. */}
          <span
            className={`block line-clamp-2 text-sm ${gone ? 'text-muted line-through' : ''}`}
          >
            {row.title}
          </span>
          <span className="sr-only">
            {KIND_NAME[row.kind]}
            {gone ? ', done' : ''}.{' '}
          </span>
          {detail.length > 0 && (
            <span className="mt-0.5 block truncate text-xs text-faint">{detail.join(' · ')}</span>
          )}
        </span>

        {/* Metadata, not the headline. At medium weight in full-strength ink a
            number competed with the title on every row, including the many
            rows where it is incidental — what the entry *is* comes first. */}
        {right !== null && (
          <span className="shrink-0 text-sm text-muted tabular-nums">{right}</span>
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
