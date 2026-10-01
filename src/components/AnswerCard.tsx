import { format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import { KIND_NAME, KindMark } from './KindMark'
import { behindYou } from '../lib/events'
import { clock, dayHeading, rowValue, rupees } from '../lib/format'
import { extraText, type Answer } from '../lib/query'
import { categorySpread } from '../lib/stats'
import type { Entry } from '../types'

/**
 * The answer to a question, laid out to be read rather than parsed.
 *
 * A single line of text was accurate and useless: it told you ₹2,340 without
 * telling you which four days that was, and the entries behind a number are
 * most of what makes it worth asking. So the number leads and its working
 * follows, capped at a handful — a question is a glance, not a report.
 *
 * The working is grouped under its dates rather than repeating one down a
 * column. A flat list made "Aug 20" the loudest thing on four separate rows
 * while the days the answer actually covered had to be reassembled by eye; as
 * headings they are the structure instead of the noise.
 *
 * **A box again — 016's "No box" reversed by the fidelity pass (018).** 016
 * took the card off because the day headings made its boundary redundant;
 * 018's card grammar puts every distinct surface in the same raised
 * enclosure, and the answer standing as the one bare block undid that. The
 * enclosure is the pass's single recipe — raised tone and a hairline, no
 * shadow — and it re-takes the job the border-y rules were doing, so those
 * went back off.
 *
 * Rows are buttons: the day an answer points at is almost always the next place
 * you want to be, and getting there any other way costs a calendar and a guess.
 */

/** Enough to recognise the answer; the rest is one tap away. */
const SHOWN = 4

type Props = {
  answer: Answer
  now: Date
  /**
   * The row that was tapped, whole.
   *
   * It used to be handed the date alone, which is why tapping a result read as
   * the search being wiped: the day changed behind a screen that was still
   * showing Ask, and the entry you actually aimed at never opened.
   */
  onPick: (row: Entry) => void
  /**
   * How many entries the answer was counted from. The mock this replaces
   * (spec 017) stamped answers "Verified", claiming a step that does not
   * exist — what is true is that the number is arithmetic over this many of
   * your own rows, so that is what the badge says.
   */
  evidence?: number
  /** A money answer carries its per-category distribution under the figure. */
  money?: boolean
}

/** The distribution's fills: one hue stepped by opacity, so the bar never
 *  leans on colour separation the way the kind palette would. Written out —
 *  Tailwind only compiles what it can see. */
const RAMP = ['bg-expense', 'bg-expense/70', 'bg-expense/45', 'bg-expense/25'] as const

export function AnswerCard({ answer, now, onPick, evidence, money = false }: Props) {
  const [expanded, setExpanded] = useState(false)

  const shown = expanded ? answer.rows : answer.rows.slice(0, SHOWN)
  const rest = answer.rows.length - shown.length

  /**
   * Where a money answer's total sat, top categories first — drawn only when
   * there is more than one bucket, because a bar with a single segment says
   * nothing the lead figure has not. Everything past the top three folds into
   * one slice so the legend stays a glance.
   */
  const slices = useMemo(() => {
    if (!money) return []
    const spread = categorySpread(answer.rows)
    if (spread.length < 2) return []
    const top = spread.slice(0, 3)
    const folded = spread.slice(3)
    return [
      ...top.map((held, at) => ({
        name: held.name ?? 'uncategorised',
        paise: held.paise,
        fill: RAMP[at]!,
      })),
      ...(folded.length > 0
        ? [
            {
              name: folded.length === 1 ? (folded[0]!.name ?? 'uncategorised') : 'other',
              paise: folded.reduce((sum, held) => sum + held.paise, 0),
              fill: RAMP[3],
            },
          ]
        : []),
    ]
  }, [money, answer.rows])

  return (
    <div className="mt-3 rounded-2xl border border-line bg-raised px-3.5 py-4">
      {/* The conclusion, then its working. Caption set as a small uppercase
          eyebrow so it reads as the label on the number rather than as the
          first line of a paragraph the number then interrupts. The badge
          beside it says what is actually true of every answer: arithmetic
          over the log's own rows, this many of them. */}
      {(answer.caption !== null || (evidence !== undefined && evidence > 0)) && (
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
            {answer.caption}
          </p>
          {evidence !== undefined && evidence > 0 && (
            <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-muted tabular-nums">
              From your log · {evidence}
            </span>
          )}
        </div>
      )}
      {/* The lead and its context on a tinted inner panel — the mock's
          synthesis block (020), holding exactly what the figures always
          said. */}
      <div className="mt-2 rounded-xl bg-sunken px-3 py-2.5">
        <p className="font-display text-3xl leading-none font-semibold tracking-tight tabular-nums">
          {answer.lead}
        </p>

        {answer.extras.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {answer.extras.map((extra, index) => (
              <span key={extraText(extra)}>
                {index > 0 && <span className="text-faint"> · </span>}
                {/* The label sits back, so the line reads as values with their
                    names attached rather than as a sentence. */}
                {extra.label !== null && <span className="text-faint">{extra.label} </span>}
                <span className="tabular-nums">{extra.value}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      {slices.length > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-[0.6875rem] font-medium text-muted">
            <span>Category distribution</span>
            <span className="tabular-nums">
              {rupees(slices.reduce((sum, slice) => sum + slice.paise, 0))} total
            </span>
          </div>
          <div aria-hidden="true" className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-sunken">
            {slices.map(
              (slice) =>
                slice.paise !== 0 && (
                  <span
                    key={slice.name}
                    className={`h-full ${slice.fill}`}
                    style={{ flexGrow: Math.abs(slice.paise) }}
                  />
                ),
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {slices.map((slice) => (
              <span
                key={slice.name}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-sunken px-2.5 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${slice.fill}`}
                  />
                  <span className="truncate text-xs text-muted">{slice.name}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-ink tabular-nums">
                  {rupees(slice.paise)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Capped rather than unbounded: the box above stays put while you scroll,
          so an answer allowed to grow without limit would take the screen with it. */}
      <div className={`mt-4 ${expanded ? 'max-h-[50dvh] overflow-y-auto' : ''}`}>
        {shown.map((row, index) => {
          const right = rowValue(row)
          const gone = behindYou(row, now)

          // Printed once per run of rows sharing a day. Only where the rows are
          // in day order — an answer about what is coming is ordered by next
          // occurrence, and grouping that can repeat a heading.
          const above = shown[index - 1]
          const heads =
            answer.grouped && (above === undefined || above.occurred_on !== row.occurred_on)

          // The date is the heading above, or the caption for a single day.
          // Either way, repeating it here would say nothing.
          const at = row.occurred_at === null ? null : clock(row.occurred_at)
          const rest = [
            answer.oneDay || answer.grouped ? null : dayHeading(row.occurred_on, now),
            row.category,
          ].filter((bit): bit is string => bit !== null && bit !== '')

          return (
            // The rule is on the wrapper, not on the button: the button is inset
            // past the gutter so its highlight clears the text, and a separator
            // that moved with it would sit 8px wider than every rule in the
            // timeline directly below.
            <div key={row.id} className="border-b border-line">
              {heads && (
                <p
                  aria-hidden="true"
                  className={`pb-2 text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase ${
                    index === 0 ? '' : 'pt-4'
                  }`}
                >
                  {dayHeading(row.occurred_on, now)}
                </p>
              )}

              <button
                type="button"
                onClick={() => onPick(row)}
                className="-mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sunken active:bg-sunken"
              >
                <KindMark kind={row.kind} />

                <span className="min-w-0 flex-1">
                  {/* The heading is hidden from the reader, so every row still
                      carries its own date whatever the grouping decided. */}
                  <span className="sr-only">
                    {format(parseISO(row.occurred_on), 'd MMMM')}, {KIND_NAME[row.kind]}
                    {gone ? ', done' : ''}.{' '}
                  </span>
                  <span
                    // `block` would override the clamp's own display. See EntryRow.
                    className={`line-clamp-2 text-sm leading-snug ${
                      gone ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    {row.title}
                  </span>
                  {(at !== null || rest.length > 0) && (
                    <span className="mt-1 block truncate text-xs text-faint">
                      {/* The clock leads, a step forward of the rest of the
                          line — the same rule the timeline itself follows. */}
                      {at !== null && <span className="text-muted tabular-nums">{at}</span>}
                      {at !== null && rest.length > 0 && ' · '}
                      {rest.join(' · ')}
                    </span>
                  )}
                </span>

                {/* Metadata, not the headline: the title is what the row is. */}
                {right !== null && (
                  <span className="shrink-0 text-sm text-muted tabular-nums">{right}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex h-11 w-full items-center text-xs text-muted transition-colors hover:text-ink active:text-ink"
        >
          {rest} more · see all {answer.rows.length}
        </button>
      )}
    </div>
  )
}
