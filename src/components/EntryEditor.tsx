import { useState, type FormEvent } from 'react'
import { CheckIcon } from './Icons'
import { Sheet } from './Sheet'
import { done as isDone, recurring, repeatLabel, weeklyDays } from '../lib/events'
import { atTime, paiseFrom, timeValue } from '../lib/format'
import { recurringTitle } from '../lib/parser'
import type { Patch, Row } from '../hooks/useEntries'
import type { Kind } from '../types'

type Props = {
  row: Row
  onSave: (patch: Patch) => void
  onDelete: () => void
  onAddToCalendar: () => void
  onClose: () => void
}

const LABEL = 'mb-1 block text-xs text-muted'
const FIELD =
  'w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-ink'

// Short, because four of these share a row on a 375px screen.
const KIND_NAME = { expense: 'Expense', time: 'Time', event: 'Event', note: 'Note' }

// Written out, never interpolated: Tailwind only compiles classes it can see.
const KIND_TINT = {
  expense: 'text-expense',
  time: 'text-time',
  event: 'text-event',
  note: 'text-note',
}

function rupeeText(paise: number | null): string {
  if (paise === null) return ''
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)
}

/**
 * The detail surface. Fields are editable on arrival rather than sitting behind
 * an Edit button — opening the entry is already the tap that says "I want to
 * change this", so a second one earns nothing.
 */
export function EntryEditor({ row, onSave, onDelete, onAddToCalendar, onClose }: Props) {
  const [kind, setKind] = useState<Kind>(row.kind)
  const [title, setTitle] = useState(row.title)
  const [day, setDay] = useState(row.occurred_on)
  const [time, setTime] = useState(row.occurred_at === null ? '' : timeValue(row.occurred_at))
  const [amount, setAmount] = useState(rupeeText(row.amount_paise))
  const [duration, setDuration] = useState(
    row.duration_minutes === null ? '' : String(row.duration_minutes),
  )
  const [finished, setFinished] = useState(isDone(row))

  // Driven by the chosen kind, not the stored one, so switching to an expense
  // reveals the amount field there and then.
  const showAmount = kind === 'expense' || row.amount_paise !== null
  const showDuration = kind === 'time' || row.duration_minutes !== null

  function save(event: FormEvent) {
    event.preventDefault()
    // The row renders the title as flowing text over two lines, so a newline
    // typed in the editor would show as a gap rather than a break.
    const trimmed = title.trim().replace(/\s+/g, ' ')
    if (!trimmed) return

    // Rebuilt from both fields every time, so editing either one is enough and
    // clearing the time turns a reminder back into an all-day entry.
    const patch: Patch = {
      kind,
      title: trimmed,
      occurred_on: day,
      occurred_at: time === '' ? null : atTime(day, time),
    }

    // Correcting a misparsed note into an event should apply the same yearly
    // rule the parser would have, or "when is X birthday" still cannot answer.
    // Demoting it away from an event drops the rule, since only events recur.
    //
    // A *weekly* rule is not the same kind of thing and must not be recomputed.
    // Yearly is a reading of the title — the word `birthday` is what makes it
    // yearly — but `weekdays` was typed as an instruction and survives nowhere
    // in the title, so deriving it the same way deleted it. That silently
    // unscheduled a five-day standup on the first save that merely marked it
    // done, and nothing on screen said so.
    const stored = typeof row.data.rrule === 'string' ? row.data.rrule : undefined
    const weekly = weeklyDays(row) === null ? undefined : stored
    const yearly = kind === 'event' && recurringTitle(trimmed)
    const rule = kind !== 'event' ? undefined : (weekly ?? (yearly ? 'FREQ=YEARLY' : undefined))

    if (rule !== row.data.rrule || finished !== isDone(row)) {
      const data = { ...row.data }
      if (rule === undefined) delete data.rrule
      else data.rrule = rule
      if (finished) data.done = true
      else delete data.done
      patch.data = data
    }
    if (showAmount) patch.amount_paise = paiseFrom(amount)
    if (showDuration) {
      const value = Number(duration.trim())
      patch.duration_minutes = duration.trim() && Number.isFinite(value) ? Math.round(value) : null
    }
    onSave(patch)
  }

  // The date and time are editable below, so repeating them here would be noise.
  // The repeat is not: it is the one thing about the entry that no field shows,
  // and the date field alone reads as a one-off.
  const context = [row.category, repeatLabel(row)].filter(
    (bit): bit is string => bit !== null && bit !== '',
  )

  // Nothing that repeats can be ticked off. `done` sits on the row, so marking
  // a weekday standup done would silence every future Monday as well as today's
  // — the same reasoning that already keeps `passed` false for a repeat.
  const tickable = !recurring(row)

  return (
    <Sheet label={`Edit ${row.title}`} onClose={onClose}>
      <form onSubmit={save}>
        {/* Editable, because the parser guesses and a wrong guess otherwise
            means deleting and retyping the whole entry. */}
        <div role="group" aria-label="Kind" className="flex gap-1 rounded-lg border border-line p-1">
          {(['expense', 'time', 'event', 'note'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={`h-9 flex-1 rounded text-xs ${
                kind === option ? `bg-sunken font-medium ${KIND_TINT[option]}` : 'text-muted'
              }`}
            >
              {KIND_NAME[option]}
            </button>
          ))}
        </div>

        {context.length > 0 && <p className="mt-2 text-xs text-faint">{context.join(' · ')}</p>}

        <div className="mt-4">
          <label className={LABEL} htmlFor="entry-title">
            Title
          </label>
          {/* A textarea, not a one-line input. The longest titles are notes,
              and editing one through a 40-character window meant scrolling
              sideways to read your own sentence. */}
          <textarea
            id="entry-title"
            rows={3}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={`${FIELD} min-h-24 resize-y leading-relaxed`}
          />
        </div>

        {/* Two per row: date and time, then amount or minutes. Four abreast is
            unusable at 375px. */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="min-w-0 flex-1">
            <label className={LABEL} htmlFor="entry-date">
              Date
            </label>
            <input
              id="entry-date"
              type="date"
              value={day}
              onChange={(event) => {
                if (event.target.value) setDay(event.target.value)
              }}
              className={FIELD}
            />
          </div>

          {/* For a reminder the time is the entry. Leaving it blank makes the
              entry all-day, which for an event means it alarms at 9am. */}
          <div className="min-w-0 flex-1">
            <label className={LABEL} htmlFor="entry-time">
              Time
            </label>
            <input
              id="entry-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={FIELD}
            />
          </div>

          {showAmount && (
            <div className="min-w-0 flex-1">
              <label className={LABEL} htmlFor="entry-amount">
                Amount ₹
              </label>
              <input
                id="entry-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={FIELD}
              />
            </div>
          )}

          {showDuration && (
            <div className="min-w-0 flex-1">
              <label className={LABEL} htmlFor="entry-duration">
                Minutes
              </label>
              <input
                id="entry-duration"
                type="text"
                inputMode="numeric"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                className={FIELD}
              />
            </div>
          )}
        </div>

        {/* The one piece of state here that no clock can work out. A reminder
            whose time has gone strikes itself through; a note saying "send the
            revised scope" is done when you decide it is. */}
        {tickable && (
          <button
            type="button"
            aria-pressed={finished}
            onClick={() => setFinished(!finished)}
            className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium ${
              finished ? 'border-ink bg-sunken text-ink' : 'border-edge text-muted'
            }`}
          >
            <CheckIcon size={16} className={finished ? '' : 'opacity-40'} />
            {finished ? 'Done' : 'Mark done'}
          </button>
        )}

        {/* Only events have anything to remind about. */}
        {row.kind === 'event' && (
          <button
            type="button"
            onClick={onAddToCalendar}
            className="mt-4 h-11 w-full rounded-lg border border-edge text-sm font-medium text-ink"
          >
            Add to calendar
          </button>
        )}

        {/* Pinned. The fields scroll behind it, so Save is reachable without
            hunting for it — and on a phone the keyboard used to sit straight
            over this row. Full-bleed against the sheet's own padding, with a
            rule so the content does not appear to run underneath. */}
        <div className="sticky bottom-0 -mx-4 mt-4 flex items-center gap-2 border-t border-line bg-raised px-4 pt-3 pb-1">
          <button
            type="submit"
            className="h-11 flex-1 rounded-lg bg-ink text-sm font-medium text-surface"
          >
            Save
          </button>
          <button type="button" onClick={onClose} className="h-11 px-3 text-sm text-muted">
            Cancel
          </button>
          <button type="button" onClick={onDelete} className="h-11 px-3 text-sm text-expense">
            Delete
          </button>
        </div>
      </form>
    </Sheet>
  )
}
