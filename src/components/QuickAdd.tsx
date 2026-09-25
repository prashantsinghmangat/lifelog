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

/**
 * What the box can be asked, for the moment it is switched to Ask.
 *
 * The toggle says the box has a second job and then hands over a blank field and
 * a placeholder, which names the job without saying what it can do — so the half
 * of the app that answers questions was reachable and unknowable at the same
 * time. These are the same thing the empty day does for logging: the feature
 * demonstrated rather than described.
 *
 * Every one of them is deliberately **subject-free** — a period and a measure,
 * nothing else. A suggestion naming a merchant or a person would answer "nothing
 * found" on a log that has never mentioned them, which is the worst possible
 * first impression of the thing being introduced. These answer from whatever the
 * log happens to hold.
 *
 * Tapping fills the box rather than submitting, as the log examples do — but
 * here that *is* asking, because the answer is computed as you type. The text
 * stays put afterwards, so the question can be edited into the next one.
 */
const QUESTIONS = ['how much this month', 'hours worked this week', 'what happened last week']

/**
 * Shown in the preview row while the field is empty and the mode is Log — the
 * same trick the empty-day examples play, folded into one line since this one
 * runs beside the field on every day, not only an empty one. Static text, not
 * a live one: it sits outside `#quick-add-preview` so nothing is announced at
 * launch, the same silence the field itself starts in.
 */
const HINT = '350 lunch · 2h client · dentist 5pm'

/** Written out, never interpolated: Tailwind only compiles classes it can see. */
const DOT: Record<Kind, string> = {
  expense: 'bg-expense',
  time: 'bg-time',
  event: 'bg-event',
  note: 'bg-note',
}

type Mode = 'log' | 'ask'

/** The text as the question grammar wants it: exactly one leading `?`. */
function asQuestion(text: string): string {
  return `? ${text.replace(/^\s*\?+\s*/, '')}`
}

/** The same text as something to log: the question mark is not part of it. */
function asEntry(text: string): string {
  return text.replace(/^\s*\?+\s*/, '')
}

type Props = {
  day: string
  now: Date
  /**
   * Asking, because the destination says so.
   *
   * On a phone Ask is one of the four places the nav goes, so the mode is not
   * this component's to decide. The toggle survives for `lg`, where there is no
   * nav and the box's second job would otherwise have nowhere to be said.
   */
  ask: boolean
  /** Ask was left from inside the box — Escape — so the destination has to follow. */
  onLeaveAsk: () => void
  /**
   * Whether there is anything in the field, which is what makes the bottom nav
   * stand down. Told rather than read: the text lives here, and a nav that went
   * looking for it through the DOM would be one more thing to keep in step.
   */
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
  /** Open an entry an answer led to — see `AnswerCard`'s `onPick`. */
  onOpenEntry: (row: Entry) => void
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
  ask,
  onLeaveAsk,
  showExamples,
  onSubmit,
  corpus,
  onNeedCorpus,
  prefill,
  onPrefilled,
  onHelp,
  onOpenEntry,
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

  const [toggled, setToggled] = useState<Mode>('log')

  // Every day starts in Log. Arriving somewhere — including by tapping a row in
  // an answer — is about reading that day, and logging is the primary act.
  useEffect(() => setToggled('log'), [day])

  /**
   * One mode, said two ways.
   *
   * The destination wins where there is one, and on `lg` there is not: the nav
   * is hidden there and the toggle inside the control is the only thing that
   * can say the box has a second job. They never disagree, because `ask` is
   * only ever true on a screen with a nav.
   */
  const mode: Mode = ask ? 'ask' : toggled

  /** Leaving Ask, from whichever of the two said so. */
  function leaveAsk() {
    setToggled('log')
    setText('')
    onLeaveAsk()
  }

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
    () => (mode === 'ask' && trimmed !== '' ? parse(asEntry(text), new Date(now), day) : null),
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
    // A column so the two halves can swap. Docked to the bottom on a phone, the
    // field has to be the *last* thing in the form or the answer and the
    // examples sit below the screen edge; at the top on a wide screen it has to
    // be the first. Ordering rather than two render sites — see `App`.
    <form onSubmit={submit} className="flex flex-col">
      {/* One control, two rows: what you typed, then how it parsed.
          The parse line used to sit outside and below, reserving its height
          whether or not it had anything to say — about 90px of dead space
          above the first entry on every populated day. It cannot simply
          collapse, because it is a live region and a line that changes height
          makes the whole timeline jump on every keystroke. Inside the field the
          height is fixed by the control itself, so nothing below it ever
          moves, and the preview reads as part of what you are typing rather
          than as an orphaned caption. */}
      {/* `capture` is read by one rule in `index.css`, which moves the focus
          ring from the field onto the control — see there. Raised off the page
          rather than drawn on it: this is the strongest interactive thing on
          the screen and the only one that has to be found without looking. */}
      <div className="capture order-last mt-2 rounded-xl border border-edge bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors focus-within:border-muted lg:order-first lg:mt-0">
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
              if (mode === 'ask') leaveAsk()
              else event.currentTarget.blur()
            }
          }}
          className="w-full bg-transparent px-4 pt-3 pb-2 text-base text-ink outline-none placeholder:text-faint"
        />

        {/* The second row of the control: what the box does, then how it read
            what you typed, then the way to send it. The mode lives here rather
            than under the control because this row has to exist anyway — it is
            what keeps the height fixed — and an empty strip inside a bordered
            box reads as a rendering fault. 44px targets, so the row is 44px.

            That 44 is **stated here rather than inherited from whatever is in
            the row**, and the difference was worth a device to find: the height
            used to come from the toggle's own `h-11` buttons, so hiding the
            toggle on compact — where the mode is a destination now — collapsed
            the row to 1px and took the control's fixed height with it. Nothing
            else in the row has a height of its own. The preview is empty until
            you type, and the send button only appears once there is something
            to save, with no mic beside it on native. */}
        <div className="flex h-11 items-center border-t border-line px-2">
          {/* Two words, and which one is live has to be obvious at a glance:
              weight alone was doing that job, and weight alone is what a
              disabled control also looks like. The selected word now sits in a
              filled pill. The pill is 28px and the button around it is 44 —
              the target is not allowed to shrink to fit the decoration. */}
          {/* The mode lives in the bottom nav on a phone, so the toggle is here
              for `lg` alone — where the nav is hidden and this is the only place
              the box's second job can be said. */}
          <div
            role="group"
            aria-label="What the box does"
            className="hidden shrink-0 items-center lg:flex"
          >
            {(['log', 'ask'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => {
                  setToggled(option)
                  document.getElementById('quick-add')?.focus()
                }}
                className="flex h-11 items-center px-0.5"
              >
                <span
                  // `min-h`, not `h`: the pill is sized by the word inside it,
                  // and at Android's 2× font scale a fixed height clips it.
                  className={`flex min-h-7 items-center rounded-full px-2.5 py-1 text-xs transition-colors ${
                    mode === option
                      ? 'bg-sunken font-medium text-ink'
                      : 'text-faint hover:text-muted'
                  }`}
                >
                  {option === 'log' ? 'Log' : 'Ask'}
                </span>
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1 truncate px-2 text-xs">
            {/* Plain text, never inside the live region below: the field is
                autofocused, so this is the first thing on screen and a screen
                reader must hear nothing about it on launch. Gone the moment
                there is anything to say instead. */}
            {mode === 'log' && trimmed === '' && !asking && (
              <span className="text-faint">{HINT}</span>
            )}
            {/* Announced politely: the parse changes as you type, and a screen
                reader should hear the result without losing your place in the
                field. */}
            <span id="quick-add-preview" role="status" aria-live="polite">
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
                // The whole line is one text node on purpose — it is read aloud as
                // one phrase, and splitting it into coloured parts would turn a
                // reassurance into a debug dump. The accent is a 5px dot in the
                // kind's colour, carrying no meaning the word beside it does not.
                <span className="text-muted tabular-nums">
                  <span
                    aria-hidden="true"
                    className={`mr-1.5 mb-px inline-block h-[5px] w-[5px] rounded-full align-middle ${
                      DOT[parsed.kind]
                    }`}
                  />
                  {summarise(parsed, sameDay, now)}
                  {!sameDay && (
                    <span className="font-medium text-event">
                      {' → saving to '}
                      {relativeDay(parsed.occurredOn, now)}
                    </span>
                  )}
                </span>
              ) : null}
            </span>
          </div>

          {/* One slot: the mic while the box is empty, send once there is
              something to save. A send affordance has to be visible — on a
              phone the keyboard's action key was the only way in, and it did
              nothing.

              Filled once it is live. An outline arrow the same weight as the
              mic beside it said "there is a button here"; it did not say that
              pressing it is the thing you came to do. */}
          {ready ? (
            <button
              type="submit"
              aria-label="Save entry"
              className="-mr-0.5 flex h-11 w-11 shrink-0 items-center justify-center"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-surface">
                <ArrowUpIcon size={17} />
              </span>
            </button>
          ) : (
            dictation.supported && (
              <button
                type="button"
                aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
                aria-pressed={dictation.listening}
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                className={`-mr-0.5 flex h-11 w-11 shrink-0 items-center justify-center transition-colors ${
                  dictation.listening ? 'text-expense' : 'text-faint hover:text-muted'
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
          onPick={(row) => {
            onOpenEntry(row)
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
            // Re-parsed against the real clock for the same reason `submit`
            // does: `now` is a 30-second tick, and a reminder measured from a
            // stale one can already be due and is then silently skipped. The
            // preview above is allowed to be a tick behind; what gets saved is
            // not.
            onSubmit(parse(asEntry(text), new Date(), day) ?? wouldLog)
            leaveAsk()
          }}
          className="mt-2 flex h-11 w-full items-center gap-2 rounded-lg border border-edge px-3 text-xs transition-colors hover:bg-sunken active:bg-sunken"
        >
          <ArrowUpIcon size={14} className="shrink-0 text-muted" />
          <span className="shrink-0 font-medium text-muted">Log instead</span>
          {/* The same words the preview would have used, so what the button is
              about to record is on the button. */}
          <span className="min-w-0 truncate text-faint">
            {summarise(wouldLog, wouldLog.occurredOn === day, now)}
          </span>
        </button>
      )}

      {/* Switched to Ask with nothing typed yet — the one moment where saying
          what the box can answer costs nothing, because there is no answer on
          screen to push down. Gone as soon as there is any text, so it never
          sits under a result. */}
      {mode === 'ask' && trimmed === '' && (
        <div className="mt-5">
          <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
            Try asking
          </p>

          <div className="mt-1.5">
            {QUESTIONS.map((asked) => (
              <button
                key={asked}
                type="button"
                onClick={() => {
                  setText(asked)
                  document.getElementById('quick-add')?.focus()
                }}
                className="-mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-lg border-b border-line px-2 py-2 text-left transition-colors hover:bg-sunken active:bg-sunken"
              >
                {/* The glyph, not a drawn icon — the same call `KindMark` makes
                    for the rupee, and it sits in the same 20px gutter so these
                    line up with the rows they are standing in for. */}
                <span className="flex w-5 shrink-0 justify-center text-faint" aria-hidden="true">
                  <span className="text-[0.9375rem] leading-none font-semibold">?</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{asked}</span>
              </button>
            ))}
          </div>

          {/* The manual's Asking section covers the half these three cannot:
              naming a subject, and a single day. */}
          <button
            type="button"
            onClick={onHelp}
            className="-ml-1 mt-1 flex h-11 items-center px-1 text-xs text-muted underline decoration-edge underline-offset-2 hover:decoration-muted"
          >
            all examples
          </button>
        </div>
      )}

      {/* Only while logging: on an empty day in Ask mode the questions above are
          the useful thing, and both at once is two lists of examples. */}
      {showExamples && mode === 'log' && (
        <div className="mt-5">
          <p className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
            Nothing here yet
          </p>

          <div className="mt-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example.typed}
                type="button"
                // Fills the input instead of submitting, so the syntax is learned by editing.
                onClick={() => setText(example.typed)}
                className="-mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-lg border-b border-line px-2 py-2 text-left transition-colors hover:bg-sunken active:bg-sunken"
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

          <div className="mt-1 flex items-baseline justify-between gap-3">
            {/* Three examples teach the shape; the manual teaches the rest.
                Someone new never opens a settings sheet to find out how to
                type. */}
            <button
              type="button"
              onClick={onHelp}
              className="-ml-1 flex h-11 items-center px-1 text-xs text-muted underline decoration-edge underline-offset-2 hover:decoration-muted"
            >
              all examples
            </button>

            {/* The one thing the examples cannot say: how to get to another day.
                It belongs *here* rather than under the timeline, because with
                the control docked to the bottom the timeline's empty space sits
                between the two — the hint was left stranded at the top of the
                screen, a paragraph away from the block it completes. */}
            <p className="shrink-0 text-xs text-faint">Swipe sideways for another day.</p>
          </div>
        </div>
      )}
    </form>
  )
}
