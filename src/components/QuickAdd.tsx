import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowUpIcon, MicIcon } from './Icons'
import { useDictation } from '../hooks/useDictation'
import { clock, minutes, relativeDay, rupees } from '../lib/format'
import { parse, type ParsedEntry } from '../lib/parser'
import { parseQuestion, phrase, summarise as summariseLog } from '../lib/query'
import type { Entry } from '../types'

const EXAMPLES = ['350 lunch swiggy', '2h client work', 'dentist tomorrow 5pm']

type Props = {
  day: string
  now: Date
  showExamples: boolean
  onSubmit: (parsed: ParsedEntry) => void
  /** Every entry, for answering questions. Null until asked for. */
  corpus: Entry[] | null
  onNeedCorpus: () => void
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

export function QuickAdd({ day, now, showExamples, onSubmit, corpus, onNeedCorpus }: Props) {
  const [text, setText] = useState('')
  const dictation = useDictation(setText)

  // A leading `?` asks rather than logs, the same way a leading `+` overrides
  // the kind. Explicit, because guessing at questions would occasionally
  // swallow an entry someone meant to keep.
  const question = useMemo(() => parseQuestion(text, now), [text, now])

  // `day`, not today: an undated entry belongs to the day being viewed.
  const parsed = useMemo(() => (question ? null : parse(text, now, day)), [question, text, now, day])
  const sameDay = parsed === null || parsed.occurredOn === day

  const asking = question !== null
  useEffect(() => {
    if (asking) onNeedCorpus()
  }, [asking, onNeedCorpus])

  const answer =
    question === null
      ? null
      : corpus === null
        ? '…'
        : phrase(summariseLog(corpus, question), question, now)

  /** There is something worth saving, so the send button takes the mic's place. */
  const ready = parsed !== null && !asking

  function submit(event: FormEvent | KeyboardEvent) {
    event.preventDefault()
    // Re-parsed against the real clock. `now` is held in state and refreshed
    // only on focus, which is fine for a preview but wrong for saving: with the
    // app left open, "in 2 minutes" measured from the last focus can already be
    // in the past, and the reminder is then silently skipped as overdue.
    const fresh = parse(text, new Date(), day)
    if (!fresh) return
    onSubmit(fresh)
    setText('')
  }

  return (
    <form onSubmit={submit}>
      <div className="relative">
        <input
          id="quick-add"
          type="text"
          value={text}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // "send", not "done": on Android the Done action only dismisses the
          // keyboard, which left no way at all to save an entry on a phone.
          enterKeyHint="send"
          placeholder="What happened?"
          aria-label="What happened?"
          onChange={(event) => {
            setText(event.target.value)
            // A stale dictation error otherwise sits over the parse preview.
            if (dictation.error !== null) dictation.clearError()
          }}
          onKeyDown={(event) => {
            // Explicit, because implicit form submission on an IME action key
            // is not something every Android keyboard agrees about.
            if (event.key === 'Enter') {
              event.preventDefault()
              submit(event)
              return
            }
            // The box is autofocused, so without a way out every keyboard
            // shortcut is unreachable. Blur, never clear: a half-typed entry
            // is not worth losing to a stray Escape.
            if (event.key === 'Escape') event.currentTarget.blur()
          }}
          className={`w-full rounded-lg border border-edge bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-ink ${
            ready || dictation.supported ? 'pr-12' : ''
          }`}
        />

        {/* One slot: the mic while the box is empty, send once there is
            something to save. A send affordance has to be visible — on a phone
            the keyboard's action key was the only way in, and it did nothing. */}
        {ready ? (
          <button
            type="submit"
            aria-label="Save entry"
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink"
          >
            <ArrowUpIcon size={20} />
          </button>
        ) : (
          dictation.supported && (
            <button
              type="button"
              aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
              aria-pressed={dictation.listening}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
              className={`absolute inset-y-0 right-0 flex w-12 items-center justify-center ${
                dictation.listening ? 'text-expense' : 'text-faint'
              }`}
            >
              <MicIcon size={18} />
            </button>
          )
        )}
      </div>

      {/* Announced politely: the parse changes as you type, and a screen reader
          should hear the result without losing your place in the field. */}
      <div id="quick-add-preview" role="status" aria-live="polite" className="mt-1.5 min-h-5 px-1 text-xs">
        {dictation.error !== null ? (
          <span className="text-expense">{dictation.error}</span>
        ) : dictation.listening ? (
          <span className="text-expense">Listening…</span>
        ) : answer !== null ? (
          // The answer is the preview. Nothing to submit, nothing to dismiss.
          <span className="text-ink">{answer}</span>
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
