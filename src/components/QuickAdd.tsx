import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AnswerCard } from './AnswerCard'
import { ArrowUpIcon, MicIcon } from './Icons'
import { KindMark } from './KindMark'
import { useDictation } from '../hooks/useDictation'
import { clock, minutes, relativeDay, rupees } from '../lib/format'
import { parse, type ParsedEntry } from '../lib/parser'
import { answer as answerTo, parseQuestion, phrase, summarise as summariseLog } from '../lib/query'
import type { Entry, Kind } from '../types'

/**
 * What to type, and what it turns into.
 *
 * The transformation is the whole trick and the one thing an empty log cannot
 * show, so a day with nothing on it demonstrates it rather than describing it:
 * three rows that are at once the syntax and its result, drawn like the entries
 * they would become. Tapping one fills the box, so the next move is editing
 * something real instead of starting from a blank field.
 */
const EXAMPLES: { typed: string; becomes: string; kind: Kind }[] = [
  { typed: '350 lunch swiggy', becomes: 'an expense · ₹350 · food', kind: 'expense' },
  { typed: '2h client work', becomes: '2 hours logged', kind: 'time' },
  { typed: 'dentist tomorrow 5pm', becomes: 'a reminder that will ring', kind: 'event' },
]

type Props = {
  day: string
  now: Date
  showExamples: boolean
  onSubmit: (parsed: ParsedEntry) => void
  /** Every entry, for answering questions. Null until asked for. */
  corpus: Entry[] | null
  onNeedCorpus: () => void
  /** Text dropped in from elsewhere, such as an example tapped in the manual. */
  prefill: string | null
  onPrefilled: () => void
  onHelp: () => void
  /** Jumping to the day an answer points at, which is usually why it was asked. */
  onGoToDay: (day: string) => void
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

export function QuickAdd({
  day,
  now,
  showExamples,
  onSubmit,
  corpus,
  onNeedCorpus,
  prefill,
  onPrefilled,
  onHelp,
  onGoToDay,
}: Props) {
  const [text, setText] = useState('')
  const dictation = useDictation(setText)

  // Filled rather than submitted, so an example from the manual can be read,
  // edited and understood before it becomes an entry.
  useEffect(() => {
    if (prefill === null) return
    setText(prefill)
    onPrefilled()
    document.getElementById('quick-add')?.focus()
  }, [prefill, onPrefilled])

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

  const summary = useMemo(
    () => (question === null || corpus === null ? null : summariseLog(corpus, question, now)),
    [question, corpus, now],
  )
  const answer =
    question === null || summary === null ? null : answerTo(summary, question, now)
  // One sentence for the live region: a screen reader should hear the answer,
  // not be walked through the table that shows it.
  const spoken =
    question === null || summary === null ? null : phrase(summary, question, now)

  /** There is something worth saving, so the send button takes the mic's place. */
  const ready = parsed !== null && !asking

  function submit(event: FormEvent | KeyboardEvent) {
    event.preventDefault()
    // A question is not an entry. Hiding the send button was not enough: the
    // keyboard's own Enter reaches here, and the re-parse below would happily
    // file "? how many times ping me" away as a note.
    if (asking) return
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
      {/* One control, two rows: what you typed, then how it parsed.
          The parse line used to sit outside and below, reserving its height
          whether or not it had anything to say — about 90px of dead space
          above the first entry on every populated day. It cannot simply
          collapse, because it is a live region and a line that changes height
          makes the whole timeline jump on every keystroke. Inside the field the
          height is fixed by the control itself, so nothing below it ever
          moves, and the preview reads as part of what you are typing rather
          than as an orphaned caption. */}
      <div className="rounded-lg border border-edge bg-surface focus-within:border-ink">
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
          className="w-full bg-transparent px-3.5 pt-3 pb-2 text-base text-ink outline-none"
        />

        <div className="flex items-center gap-2 border-t border-line px-3.5 py-1.5">
          {/* Announced politely: the parse changes as you type, and a screen
              reader should hear the result without losing your place in the
              field. `min-h-5` holds the row open when there is nothing to say,
              which is what keeps the control one fixed height. */}
          <div
            id="quick-add-preview"
            role="status"
            aria-live="polite"
            className="min-h-5 min-w-0 flex-1 truncate text-xs"
          >
            {dictation.error !== null ? (
              <span className="text-expense">{dictation.error}</span>
            ) : dictation.listening ? (
              <span className="text-expense">Listening…</span>
            ) : spoken !== null ? (
              // The card below is the answer. This is the same thing said aloud.
              <span className="sr-only">{spoken}</span>
            ) : asking ? (
              <span className="text-faint">…</span>
            ) : parsed ? (
              <span className="text-muted">
                {summarise(parsed, sameDay, now)}
                {!sameDay && (
                  <span className="font-medium text-event">
                    {' → saving to '}
                    {relativeDay(parsed.occurredOn, now)}
                  </span>
                )}
              </span>
            ) : (
              // The placeholder above already says what the box is for, so this
              // row earns its space by teaching the one thing that is not
              // guessable and lives nowhere else on screen.
              <span className="text-faint">Start with ? to ask</span>
            )}
          </div>

          {/* One slot: the mic while the box is empty, send once there is
              something to save. A send affordance has to be visible — on a
              phone the keyboard's action key was the only way in, and it did
              nothing. */}
          {ready ? (
            <button
              type="submit"
              aria-label="Save entry"
              className="-my-1.5 flex h-11 w-8 shrink-0 items-center justify-center text-ink"
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
                className={`-my-1.5 flex h-11 w-8 shrink-0 items-center justify-center ${
                  dictation.listening ? 'text-expense' : 'text-faint'
                }`}
              >
                <MicIcon size={18} />
              </button>
            )
          )}
        </div>
      </div>

      {/* Keyed on the text: a new question is a new answer, collapsed again.
          The 30-second clock tick must not fold up an answer being read. */}
      {answer !== null && (
        <AnswerCard
          key={text}
          answer={answer}
          now={now}
          onPick={(picked) => {
            onGoToDay(picked)
            // The question has been answered and acted on; leaving it in the box
            // would hide the day it just took you to.
            setText('')
          }}
        />
      )}

      {showExamples && (
        <div className="mt-4">
          <p className="px-1 text-xs text-faint">Nothing here yet — try one of these.</p>

          <div className="mt-1">
            {EXAMPLES.map((example) => (
              <button
                key={example.typed}
                type="button"
                // Fills the input instead of submitting, so the syntax is learned by editing.
                onClick={() => setText(example.typed)}
                className="flex min-h-12 w-full items-center gap-3 border-b border-line py-2 text-left active:bg-raised"
              >
                {/* Faded, because these are not entries — they are what an entry
                    would look like if you typed the line beside them. */}
                <span className="opacity-60">
                  <KindMark kind={example.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-muted">{example.typed}</span>
                  <span className="mt-0.5 block truncate text-xs text-faint">
                    becomes {example.becomes}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Three examples teach the shape; the manual teaches the rest. Someone
              new never opens a settings sheet to find out how to type. */}
          <button
            type="button"
            onClick={onHelp}
            className="mt-1 flex h-11 items-center px-1 text-xs text-muted underline"
          >
            all examples
          </button>
        </div>
      )}
    </form>
  )
}
