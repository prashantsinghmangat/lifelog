import { parseISO } from 'date-fns'
import { KIND_NAME, KindMark } from './KindMark'
import { behindYou, repeatLabel } from '../lib/events'
import { clock, relativeDay, rowValue, until } from '../lib/format'
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
  // Beside the clock, never instead of it: "in 47m" is the fact you are reading
  // the row for, and "10:00 am" is the one you will repeat to somebody else.
  // Only for something still ahead of you today — an expense at one o'clock
  // happened, and counting down to it would be nonsense.
  const soon =
    row.kind === 'event' && !gone && row.occurred_at !== null
      ? until(parseISO(row.occurred_at), now)
      : null
  const detail = [
    soon,
    // A repeat has one row, so this line is the only thing that can say the
    // standup on Friday is also the standup on Monday.
    repeatLabel(row),
    row.category,
    offDay ? relativeDay(row.occurred_on, now) : null,
    // Words, not a colour or an icon: the row is saved on this device and the
    // server has not seen it, which is worth knowing and is not a problem.
    row.status === 'queued' ? 'saved here, not synced' : null,
    // And a refusal is worth knowing about outright. It said so with a
    // red-bordered chip and nothing else, so a row the server had rejected
    // read, to anything not looking at the colour, exactly like a saved one.
    row.status === 'failed' ? 'the server refused this' : null,
  ].filter((bit): bit is string => bit !== null && bit !== '')

  return (
    <div
      className={`row-in flex items-stretch border-b border-line ${
        row.status === 'saving' ? 'opacity-60' : ''
      }`}
    >
      {/* The whole row is the target: one tap opens everything about the entry.
          The highlight is inset past the page gutter rather than drawn at the
          text, so a hover or a press reads as the row lighting up and not as a
          box appearing around the title. */}
      <button
        type="button"
        onClick={onOpen}
        className="-mx-2 flex min-h-[3.25rem] min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-sunken active:bg-sunken"
      >
        <KindMark kind={row.kind} />

        <span className="min-w-0 flex-1">
          {/* Behind you — the moment went by, or you ticked it off. Struck
              rather than hidden: it still happened.

              Two lines, not one. A truncated title told you that an entry
              existed and not what it was, and the longest titles are the notes,
              where the words are the whole content. */}
          <span
            // No `block` beside `line-clamp-2`: the clamp needs
            // `display:-webkit-box` and `block` wins the cascade, which left
            // every long title running to as many lines as it liked.
            className={`line-clamp-2 text-sm leading-snug ${
              gone ? 'text-muted line-through' : 'text-ink'
            }`}
          >
            {row.title}
          </span>
          <span className="sr-only">
            {KIND_NAME[row.kind]}
            {gone ? ', done' : ''}.{' '}
          </span>
          {(at !== null || detail.length > 0) && (
            <span className="mt-1 block truncate text-xs text-faint">
              {/* The clock sits a step forward of the rest of the line. There is
                  no time gutter — `occurred_at` is optional, so a column for it
                  is empty on most rows and buys a 56px indent for nothing — but
                  where a row does carry a time, that time is what anchors it in
                  the day, and flattened into the list of categories and repeat
                  rules it read as one more tag. */}
              {at !== null && <span className="text-muted tabular-nums">{at}</span>}
              {at !== null && detail.length > 0 && ' · '}
              {detail.join(' · ')}
            </span>
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
          // Named with the row it belongs to. A day can carry several of these,
          // and `Did not save` lists more; as bare "Retry" they were N
          // identical buttons with nothing to tell them apart.
          aria-label={`Retry saving ${row.title}`}
          // A 44px target holding a chip-sized box — the same negative-margin
          // trick the toast's own buttons use. At `py-1` it was 26px, which is
          // the smallest thing to aim at in the app and sits directly beside
          // the row button that opens the editor, so a miss does something else
          // rather than nothing. This is the control you reach for when a write
          // has been refused.
          className="-my-2 ml-3 flex h-11 shrink-0 items-center self-center"
        >
          <span className="rounded-md border border-expense px-2 py-1 text-xs font-medium text-expense">
            Retry
          </span>
        </button>
      )}
    </div>
  )
}
