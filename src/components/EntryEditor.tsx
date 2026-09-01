import { useState, type FormEvent } from 'react'
import { paiseFrom, withDay } from '../lib/format'
import type { Patch, Row } from '../hooks/useEntries'

type Props = {
  row: Row
  onSave: (patch: Patch) => void
  onDelete: () => void
  onCancel: () => void
}

const FIELD = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-gray-900'

function rupeeText(paise: number | null): string {
  if (paise === null) return ''
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2)
}

export function EntryEditor({ row, onSave, onDelete, onCancel }: Props) {
  const [title, setTitle] = useState(row.title)
  const [day, setDay] = useState(row.occurred_on)
  const [amount, setAmount] = useState(rupeeText(row.amount_paise))
  const [duration, setDuration] = useState(row.duration_minutes === null ? '' : String(row.duration_minutes))

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

  return (
    <form onSubmit={save} className="border-b border-gray-100 bg-gray-50 px-2 py-3">
      <input
        type="text"
        value={title}
        autoFocus
        aria-label="Title"
        onChange={(event) => setTitle(event.target.value)}
        className={FIELD}
      />

      <div className="mt-2 flex gap-2">
        <input
          type="date"
          value={day}
          aria-label="Date"
          onChange={(event) => {
            if (event.target.value) setDay(event.target.value)
          }}
          className={FIELD}
        />
        {showAmount && (
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="₹"
            aria-label="Amount in rupees"
            onChange={(event) => setAmount(event.target.value)}
            className={FIELD}
          />
        )}
        {showDuration && (
          <input
            type="text"
            inputMode="numeric"
            value={duration}
            placeholder="minutes"
            aria-label="Duration in minutes"
            onChange={(event) => setDuration(event.target.value)}
            className={FIELD}
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1.5 text-sm text-gray-500">
          Cancel
        </button>
        <button type="button" onClick={onDelete} className="ml-auto px-2 py-1.5 text-sm text-expense">
          Delete
        </button>
      </div>
    </form>
  )
}
