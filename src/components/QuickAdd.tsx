import { useMemo, useState, type FormEvent } from 'react'
import { MicIcon } from './Icons'
import { useDictation } from '../hooks/useDictation'
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
  const dictation = useDictation(setText)

  // `day`, not today: an undated entry belongs to the day being viewed.
  const parsed = useMemo(() => parse(text, now, day), [text, now, day])
  const sameDay = parsed === null || parsed.occurredOn === day

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!parsed) return
    onSubmit(parsed)
    setText('')
  }

  return (
    <form onSubmit={submit}>
      <div className="relative">
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
          className={`w-full rounded border border-edge bg-surface px-3 py-2 text-base text-ink outline-none focus:border-ink ${
            dictation.supported ? 'pr-11' : ''
          }`}
        />
        {dictation.supported && (
          <button
            type="button"
            aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
            aria-pressed={dictation.listening}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            className={`absolute inset-y-0 right-0 flex w-11 items-center justify-center ${
              dictation.listening ? 'text-expense' : 'text-faint'
            }`}
          >
            <MicIcon size={18} />
          </button>
        )}
      </div>

      <div className="mt-1 min-h-5 px-1 text-xs">
        {dictation.error !== null ? (
          <span className="text-expense">{dictation.error}</span>
        ) : dictation.listening ? (
          <span className="text-expense">Listening…</span>
        ) : (
          parsed && (
            <span className="text-muted">
              {summarise(parsed, sameDay, now)}
              {!sameDay && (
                <span className="font-medium text-event">
                  {' → saving to '}
                  {relativeDay(parsed.occurredOn, now)}
                </span>
              )}
            </span>
          )
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
              className="rounded-full border border-line px-3 py-1 text-xs text-muted active:bg-raised"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </form>
  )
}
