import { format, parseISO } from 'date-fns'
import { useState } from 'react'
import { KIND_NAME, KindMark } from './KindMark'
import { clock, minutes, rupees } from '../lib/format'
import type { Answer } from '../lib/query'
import type { Entry } from '../types'

/**
 * The answer to a question, laid out to be read rather than parsed.
 *
 * A single line of text was accurate and useless: it told you ₹2,340 without
 * telling you which four days that was, and the entries behind a number are
 * most of what makes it worth asking. So the number leads and its working
 * follows, capped at a handful — a question is a glance, not a report.
 *
 * Rows are buttons: the day an answer points at is almost always the next place
 * you want to be, and getting there any other way costs a calendar and a guess.
 */

/** Enough to recognise the answer; the rest is one tap away. */
const SHOWN = 4

type Props = {
  answer: Answer
  onPick: (day: string) => void
}

function value(entry: Entry): string | null {
  if (entry.amount_paise !== null) return rupees(entry.amount_paise)
  if (entry.duration_minutes !== null) return minutes(entry.duration_minutes)
  return null
}

export function AnswerCard({ answer, onPick }: Props) {
  const [expanded, setExpanded] = useState(false)

  const rows = expanded ? answer.rows : answer.rows.slice(0, SHOWN)
  const rest = answer.rows.length - rows.length

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
          <div className="shrink-0 text-right text-xs text-muted">
            {answer.extras.map((extra) => (
              <p key={extra}>{extra}</p>
            ))}
          </div>
        )}
      </div>

      {/* Capped rather than unbounded: the box above stays put while you scroll,
          so an answer allowed to grow without limit would take the screen with it. */}
      <div className={expanded ? 'max-h-[50vh] overflow-y-auto' : undefined}>
        {rows.map((row, index) => {
          const right = value(row)
          // A question about one day repeats that date on every row, which says
          // nothing. The clock does.
          const left = answer.oneDay
            ? row.occurred_at === null
              ? ''
              : clock(row.occurred_at)
            : format(parseISO(row.occurred_on), 'EEE d')

          // Two entries on the same day print the date twice, and the second one
          // carries no information the first did not. Printed once, the column
          // reads as the days it is listing rather than a repeated label.
          const above = rows[index - 1]
          const repeated =
            !answer.oneDay && above !== undefined && above.occurred_on === row.occurred_on

          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onPick(row.occurred_on)}
              className="flex min-h-12 w-full items-center gap-3 border-t border-line px-3.5 py-2 text-left active:bg-raised"
            >
              <span className="w-14 shrink-0 text-xs text-faint tabular-nums">
                {/* Suppressed for the eye only: every row still says its date. */}
                <span className="sr-only">{format(parseISO(row.occurred_on), 'd MMMM')}. </span>
                <span aria-hidden="true">{repeated ? '' : left}</span>
              </span>
              <KindMark kind={row.kind} />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="sr-only">{KIND_NAME[row.kind]}. </span>
                {row.title}
              </span>
              {right !== null && (
                <span className="shrink-0 text-sm font-medium tabular-nums">{right}</span>
              )}
            </button>
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
