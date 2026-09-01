import { useMemo, useState, type FormEvent } from 'react'
import { clock, minutes, relativeDay, rupees } from '../lib/format'
import { parse, type ParsedEntry } from '../lib/parser'

const EXAMPLES = ['350 lunch swiggy', '2h client work', 'dentist tomorrow 5pm']

type Props = {
  day: string
  now: Date
  showExamples: boolean
  onSubmit: (parsed: ParsedEntry) => void
}

/** `expense · ₹350 · food · today` — the date token is dropped when it needs its own warning. */
function summarise(parsed: ParsedEntry, sameDay: boolean, now: Date): string {
  const bits: string[] = [parsed.kind]
  if (parsed.amountPaise !== undefined) bits.push(rupees(parsed.amountPaise))
  if (parsed.durationMinutes !== undefined) bits.push(minutes(parsed.durationMinutes))
  if (parsed.occurredAt !== undefined) bits.push(clock(parsed.occurredAt))
  if (parsed.category !== undefined) bits.push(parsed.category)
  if (sameDay) bits.push(relativeDay(parsed.occurredOn, now))
  return bits.join(' · ')
}

export function QuickAdd({ day, now, showExamples, onSubmit }: Props) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parse(text, now), [text, now])
  const sameDay = parsed === null || parsed.occurredOn === day

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!parsed) return
    onSubmit(parsed)
    setText('')
  }

  return (
    <form onSubmit={submit}>
      <input
        type="text"
        value={text}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="350 lunch swiggy"
        aria-label="Quick add"
        onChange={(event) => setText(event.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
      />

      <div className="mt-1 min-h-5 px-1 text-xs">
        {parsed && (
          <span className="text-gray-500">
            {summarise(parsed, sameDay, now)}
            {!sameDay && (
              <span className="font-medium text-event">
                {' → saving to '}
                {relativeDay(parsed.occurredOn, now)}
              </span>
            )}
          </span>
        )}
      </div>

      {showExamples && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              // Fills the input instead of submitting, so the syntax is learned by editing.
              onClick={() => setText(example)}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500 active:bg-gray-100"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </form>
  )
}
