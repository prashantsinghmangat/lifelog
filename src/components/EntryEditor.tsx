import { useState, type FormEvent } from 'react'
import { Sheet } from './Sheet'
import { clock, dayLabel, paiseFrom, withDay } from '../lib/format'
import type { Patch, Row } from '../hooks/useEntries'

type Props = {
  row: Row
  now: Date
  onSave: (patch: Patch) => void
  onDelete: () => void
  onAddToCalendar: () => void
  onClose: () => void
}

const LABEL = 'mb-1 block text-xs text-muted'
const FIELD =
  'w-full rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-ink'

const KIND_NAME = { expense: 'Expense', time: 'Time log', event: 'Event', note: 'Note' }

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
export function EntryEditor({ row, now, onSave, onDelete, onAddToCalendar, onClose }: Props) {
  const [title, setTitle] = useState(row.title)
  const [day, setDay] = useState(row.occurred_on)
  const [amount, setAmount] = useState(rupeeText(row.amount_paise))
  const [duration, setDuration] = useState(
    row.duration_minutes === null ? '' : String(row.duration_minutes),
  )

  const showAmount = row.kind === 'expense' || row.amount_paise !== null
  const showDuration = row.kind === 'time' || row.duration_minutes !== null

  function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return

    const patch: Patch = { title: trimmed, occurred_on: day }
    if (row.occurred_at !== null && day !== row.occurred_on) {
      patch.occurred_at = withDay(row.occurred_at, day)
    }
    if (showAmount) patch.amount_paise = paiseFrom(amount)
    if (showDuration) {
      const value = Number(duration.trim())
      patch.duration_minutes = duration.trim() && Number.isFinite(value) ? Math.round(value) : null
    }
    onSave(patch)
  }

  const context = [
    dayLabel(row.occurred_on, now),
    row.occurred_at === null ? null : clock(row.occurred_at),
    row.category,
  ].filter((bit): bit is string => bit !== null && bit !== '')

  return (
    <Sheet label={`Edit ${row.title}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className={`text-xs font-medium ${KIND_TINT[row.kind]}`}>{KIND_NAME[row.kind]}</p>
        <p className="mt-0.5 text-xs text-faint">{context.join(' · ')}</p>

        <div className="mt-4">
          <label className={LABEL} htmlFor="entry-title">
            Title
          </label>
          <input
            id="entry-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={FIELD}
          />
        </div>

        <div className="mt-3 flex gap-3">
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

        <div className="mt-4 flex items-center gap-2">
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
