import { parseISO } from 'date-fns'
import { KIND_NAME } from './KindMark'
import { behindYou, repeatLabel } from '../lib/events'
import { clock, relativeDay, rowValue, until } from '../lib/format'
import type { Row } from '../hooks/useEntries'
import type { Kind } from '../types'

/** Written out, never interpolated: Tailwind only compiles what it can see. */
const BADGE: Record<Kind, string> = {
  expense: 'bg-expense/10 text-expense',
  time: 'bg-time/10 text-time',
  event: 'bg-event/10 text-event',
  note: 'bg-note/10 text-note',
}

type Props = {
  row: Row
  now: Date
  /**
   * Inside an epoch card the card draws the hairlines and holds the inset,
   * so the row gives up its own border and gutter bleed. Bare on the page,
   * it keeps both.
   */
  boxed?: boolean
  /** True when the row sits on a day other than the one being viewed. */
  offDay?: boolean
  /** A locally-stored photo for this entry — never read from `row` itself. */
  photoUrl?: string
  /** How many that entry holds, which is not always the one being drawn. */
  photoCount?: number
  onOpen: () => void
  /** Opening the photo, which is not the same act as opening the entry. */
  onOpenPhoto?: () => void
  onRetry: () => void
}

/**
 * The ledger row — Variant E's anatomy (021), replacing the spine node and
 * the 15px kind mark alike. A fixed time gutter leads (the trade the old row
 * refused is taken knowingly: the mock's two-tone ledger is built on the
 * clock column, blank where a row carries no time), then a badge line naming
 * the kind in its own colour with the metadata beside it, then the title.
 * Nothing rides on colour alone: the `sr-only` kind name stays, and the
 * badge is hidden from readers so the kind is never said twice.
 */
export function EntryRow({
  row,
  now,
  boxed = false,
  offDay = false,
  photoUrl,
  photoCount = 1,
  onOpen,
  onOpenPhoto,
  onRetry,
}: Props) {
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
  const rest = [
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
      className={`row-in flex items-stretch ${boxed ? '' : 'border-b border-line'} ${
        row.status === 'saving' ? 'opacity-60' : ''
      }`}
    >
      {/* The whole row is the target: one tap opens everything about the entry. */}
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-h-[3.25rem] min-w-0 flex-1 items-center gap-3 py-2.5 text-left transition-colors hover:bg-sunken active:bg-sunken ${
          boxed ? 'px-3.5' : '-mx-2 rounded-lg px-2'
        }`}
      >
        {/* The clock column. An event still ahead carries it in ink — the
            moment is the fact the row exists for. */}
        <span
          className={`w-14 shrink-0 text-xs tabular-nums ${
            soon !== null ? 'font-semibold text-ink' : 'text-faint'
          }`}
        >
          {at}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] leading-none font-bold tracking-wider uppercase ${BADGE[row.kind]}`}
            >
              {row.kind}
            </span>
            {/* The one coloured piece of text on a row: the clock is the fact
                you would repeat to somebody else, this is the one you were
                reading the row for. */}
            {soon !== null && (
              <span className="shrink-0 rounded bg-event/15 px-1.5 py-0.5 text-[0.625rem] leading-none font-medium text-event">
                {soon}
              </span>
            )}
            {rest.length > 0 && (
              <span className="min-w-0 truncate text-[0.6875rem] text-faint">
                {rest.join(' · ')}
              </span>
            )}
          </span>
          <span className="sr-only">
            {KIND_NAME[row.kind]}
            {gone ? ', done' : ''}.{' '}
          </span>
          {/* Behind you — the moment went by, or you ticked it off. Struck
              rather than hidden: it still happened. Two lines, not one: a
              truncated title told you that an entry existed and not what it
              was. No `block` beside `line-clamp-2` — the clamp needs
              `display:-webkit-box` and `block` wins the cascade. */}
          <span
            className={`mt-0.5 line-clamp-2 text-sm leading-snug ${
              gone ? 'text-muted line-through' : 'font-medium text-ink'
            }`}
          >
            {row.title}
          </span>
        </span>

        {/* Metadata, not the headline — what the entry *is* comes first. */}
        {right !== null && (
          <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{right}</span>
        )}
        {/* A done event has no figure; the chip says what the strikethrough
            says, for the glance that never reaches the title. */}
        {row.kind === 'event' && gone && (
          <span className="shrink-0 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-faint">
            completed
          </span>
        )}
      </button>

      {/* The proof, shown rather than described — its own button beside the
          row's: tapping the picture should show the picture rather than open
          the editor like the rest of the row does. A fixed square with
          `object-cover`, so every row keeps one height. */}
      {photoUrl !== undefined && (
        <button
          type="button"
          onClick={onOpenPhoto}
          // The count belongs in the name rather than only in the badge: `+2`
          // read aloud is "plus two", which is arithmetic rather than a fact
          // about the entry.
          aria-label={
            photoCount > 1
              ? `View ${photoCount} photos on ${row.title}`
              : `View photo on ${row.title}`
          }
          className={`-my-2 ml-3 flex h-11 shrink-0 items-center self-center ${boxed ? 'mr-3.5' : ''}`}
        >
          <span className="relative block h-9 w-9">
            {/* `transform-gpu` forces this blob URL onto its own compositing
                layer so it paints on its first frame — see `QuickAdd.tsx`'s
                staged strip for the same fix. */}
            <img
              src={photoUrl}
              alt=""
              className="h-full w-full rounded-md border border-line object-cover transform-gpu"
            />
            {/* One thumbnail understated an entry holding three. The remainder
                rather than the total, which is what sits beside a picture you
                can already see — and `aria-hidden` because the button's name
                above says it properly. */}
            {photoCount > 1 && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 rounded-b-md bg-ink/70 text-center text-[0.625rem] leading-[1.1rem] font-medium text-surface tabular-nums"
              >
                +{photoCount - 1}
              </span>
            )}
          </span>
        </button>
      )}

      {row.status === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          // Named with the row it belongs to. A day can carry several of these,
          // and `Did not save` lists more; as bare "Retry" they were N
          // identical buttons with nothing to tell them apart.
          aria-label={`Retry saving ${row.title}`}
          className={`-my-2 ml-3 flex h-11 shrink-0 items-center self-center ${boxed ? 'mr-3.5' : ''}`}
        >
          <span className="rounded-md border border-expense px-2 py-1 text-xs font-medium text-expense">
            Retry
          </span>
        </button>
      )}
    </div>
  )
}
