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

type Mode = 'log' | 'ask'

/** The text as the question grammar wants it: exactly one leading `?`. */
function asQuestion(text: string): string {
  return `? ${text.replace(/^\s*\?+\s*/, '')}`
}

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

  const [mode, setMode] = useState<Mode>('log')

  // Every day starts in Log. Arriving somewhere — including by tapping a row in
  // an answer — is about reading that day, and logging is the primary act.
  useEffect(() => setMode('log'), [day])

  const trimmed = text.trim()

  /**
   * Asking is a mode *and* a prefix.
   *
   * The toggle is how the behaviour is discovered — nobody should have to be
   * told that a leading `?` turns the box into a question. But `?` still works
   * from Log mode, because it costs nothing to keep, it is faster than reaching
   * for a control, and removing it would break the one habit the log's owner
   * already has.
   */
  const question = useMemo(() => {
    if (trimmed === '') return null
    if (mode !== 'ask' && !trimmed.startsWith('?')) return null
    return parseQuestion(asQuestion(text), now)
  }, [mode, text, trimmed, now])

  const asking = question !== null

  // `day`, not today: an undated entry belongs to the day being viewed.
  const parsed = useMemo(
    () => (asking || mode === 'ask' ? null : parse(text, now, day)),
    [asking, mode, text, now, day],
  )
  const sameDay = parsed === null || parsed.occurredOn === day

  /**
   * What this text would have logged, worked out only while asking.
   *
   * This is the one failure the toggle introduces that the prefix could not:
   * type `350 lunch swiggy` with Ask selected and the honest answer is "nothing
   * found", which is a dead end in front of something the app plainly
   * understands. So the dead end offers the obvious alternative — held behind a
   * button, never acted on by itself.
   */
  const wouldLog = useMemo(
    () => (mode === 'ask' && trimmed !== '' ? parse(text, new Date(now), day) : null),
    [mode, trimmed, text, now, day],
  )
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
          placeholder={mode === 'ask' ? 'What do you want to know?' : 'What happened?'}
          aria-label={mode === 'ask' ? 'What do you want to know?' : 'What happened?'}
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
              // The answer is already on screen — it updates as you type — so
              // there is nothing to send. Dropping the keyboard is the useful
              // thing Enter can do, because the keyboard is covering it.
              if (asking) event.currentTarget.blur()
              else submit(event)
              return
            }
            // The box is autofocused, so without a way out every keyboard
            // shortcut is unreachable. Blur, never clear: a half-typed entry
            // is not worth losing to a stray Escape.
            if (event.key === 'Escape') {
              if (mode === 'ask') {
                setMode('log')
                setText('')
              } else {
                event.currentTarget.blur()
              }
            }
          }}
          className="w-full bg-transparent px-3.5 pt-3 pb-2 text-base text-ink outline-none"
        />

        {/* The second row of the control: what the box does, then how it read
            what you typed, then the way to send it. The mode lives here rather
            than under the control because this row has to exist anyway — it is
            what keeps the height fixed — and an empty strip inside a bordered
            box reads as a rendering fault. 44px targets, so the row is 44px. */}
        <div className="flex items-center border-t border-line px-2">
          <div role="group" aria-label="What the box does" className="flex shrink-0 items-center">
            {(['log', 'ask'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => {
                  setMode(option)
                  document.getElementById('quick-add')?.focus()
                }}
                className={`flex h-11 items-center px-1.5 text-xs ${
                  mode === option ? 'font-medium text-ink' : 'text-faint'
                }`}
              >
                {option === 'log' ? 'Log' : 'Ask'}
              </button>
            ))}
          </div>

          {/* Announced politely: the parse changes as you type, and a screen
              reader should hear the result without losing your place in the
              field. */}
          <div
            id="quick-add-preview"
            role="status"
            aria-live="polite"
            className="min-w-0 flex-1 truncate px-1.5 text-xs"
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
            ) : null}
          </div>

          {/* One slot: the mic while the box is empty, send once there is
              something to save. A send affordance has to be visible — on a
              phone the keyboard's action key was the only way in, and it did
              nothing. */}
          {ready ? (
            <button
              type="submit"
              aria-label="Save entry"
              className="flex h-11 w-9 shrink-0 items-center justify-center text-ink"
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
                className={`flex h-11 w-9 shrink-0 items-center justify-center ${
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

      {/* A question that found nothing, over text the parser plainly understands.
          One tap rather than "switch mode and type it again". */}
      {answer !== null && summary !== null && summary.entries === 0 && wouldLog !== null && (
        <button
          type="button"
          onClick={() => {
            onSubmit(wouldLog)
            setText('')
            setMode('log')
          }}
          className="mt-2 flex h-11 w-full items-center gap-2 rounded-lg border border-edge px-3 text-xs active:bg-raised"
        >
          <ArrowUpIcon size={14} className="shrink-0 text-muted" />
          <span className="shrink-0 text-muted">Log instead</span>
          {/* The same words the preview would have used, so what the button is
              about to record is on the button. */}
          <span className="min-w-0 truncate text-faint">
            {summarise(wouldLog, wouldLog.occurredOn === day, now)}
          </span>
        </button>
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
