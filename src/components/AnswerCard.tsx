import { format, parseISO } from 'date-fns'
import { useState } from 'react'
import { KIND_NAME, KindMark } from './KindMark'
import { passed } from '../lib/events'
import { clock, dayHeading, rowValue } from '../lib/format'
import { extraText, type Answer } from '../lib/query'

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
 * Rows are buttons: the day an answer points at is almost always the next place
 * you want to be, and getting there any other way costs a calendar and a guess.
 */

/** Enough to recognise the answer; the rest is one tap away. */
const SHOWN = 4

type Props = {
  answer: Answer
  now: Date
  onPick: (day: string) => void
}

export function AnswerCard({ answer, now, onPick }: Props) {
  const [expanded, setExpanded] = useState(false)

  const shown = expanded ? answer.rows : answer.rows.slice(0, SHOWN)
  const rest = answer.rows.length - shown.length

  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-sunken">
      <div className="flex items-baseline justify-between gap-3 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0">
          {answer.caption !== null && (
            <p className="truncate text-xs text-faint">{answer.caption}</p>
          )}
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{answer.lead}</p>
        </div>

        {answer.extras.length > 0 && (
          <div className="shrink-0 space-y-0.5 text-right text-xs text-muted">
            {answer.extras.map((extra) => (
              <p key={extraText(extra)}>
                {/* The label sits back so the column reads as values with
                    their names attached, not as a sentence per line. */}
                {extra.label !== null && <span className="text-faint">{extra.label} </span>}
                <span className="tabular-nums">{extra.value}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Capped rather than unbounded: the box above stays put while you scroll,
          so an answer allowed to grow without limit would take the screen with it. */}
      <div className={expanded ? 'max-h-[50vh] overflow-y-auto' : undefined}>
        {shown.map((row, index) => {
          const right = rowValue(row)
          const gone = passed(row, now)

          // Printed once per run of rows sharing a day. Only where the rows are
          // in day order — an answer about what is coming is ordered by next
          // occurrence, and grouping that can repeat a heading.
          const above = shown[index - 1]
          const heads =
            answer.grouped && (above === undefined || above.occurred_on !== row.occurred_on)

          // The date is the heading above, or the caption for a single day.
          // Either way, repeating it here would say nothing.
          const detail = [
            answer.oneDay || answer.grouped ? null : dayHeading(row.occurred_on, now),
            row.occurred_at === null ? null : clock(row.occurred_at),
            row.category,
          ].filter((bit): bit is string => bit !== null && bit !== '')

          return (
            <div key={row.id}>
              {heads && (
                <p
                  aria-hidden="true"
                  className="border-t border-line px-3.5 pt-2.5 pb-1 text-xs font-medium tracking-wide text-faint uppercase"
                >
                  {dayHeading(row.occurred_on, now)}
                </p>
              )}

              <button
                type="button"
                onClick={() => onPick(row.occurred_on)}
                className={`flex min-h-12 w-full items-center gap-3 px-3.5 py-2 text-left active:bg-raised ${
                  heads ? '' : 'border-t border-line'
                }`}
              >
                <KindMark kind={row.kind} />

                <span className="min-w-0 flex-1">
                  {/* The heading is hidden from the reader, so every row still
                      carries its own date whatever the grouping decided. */}
                  <span className="sr-only">
                    {format(parseISO(row.occurred_on), 'd MMMM')}, {KIND_NAME[row.kind]}
                    {gone ? ', passed' : ''}.{' '}
                  </span>
                  <span className={`block truncate text-sm ${gone ? 'text-muted line-through' : ''}`}>
                    {row.title}
                  </span>
                  {detail.length > 0 && (
                    <span className="mt-0.5 block truncate text-xs text-faint">
                      {detail.join(' · ')}
                    </span>
                  )}
                </span>

                {right !== null && (
                  <span className="shrink-0 text-sm font-medium tabular-nums">{right}</span>
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
          className="flex h-11 w-full items-center justify-center border-t border-line text-xs text-muted active:bg-raised"
        >
          {rest} more · see all {answer.rows.length}
        </button>
      )}
    </div>
  )
}
