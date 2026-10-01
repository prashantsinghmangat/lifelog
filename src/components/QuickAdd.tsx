import { format, parseISO } from 'date-fns'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnswerCard } from './AnswerCard'
import {
  ArrowUpIcon,
  CalendarIcon,
  CameraIcon,
  Chevron,
  CloseIcon,
  ImageIcon,
  MicIcon,
} from './Icons'
import { KindMark } from './KindMark'
import { PhotoViewer } from './PhotoViewer'
import { useDictation } from '../hooks/useDictation'
import { expectForegroundReturn } from '../lib/applock'
import { fromFile, put } from '../lib/attachments'
import { available as cameraAvailable, takePhoto } from '../lib/camera'
import { clock, minutes, relativeDay, rupees } from '../lib/format'
import { parse, parseMulti, type ParsedEntry } from '../lib/parser'
import { answer as answerTo, parseQuestion, phrase, summarise as summariseLog } from '../lib/query'
import type { Row } from '../hooks/useEntries'
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

/** One curated question: fills the box, which in Ask is asking. Shared by the
 *  flat list and the topic groups, so the rows can never drift apart. */
function QuestionRow({
  asked,
  first,
  onPick,
}: {
  asked: string
  first: boolean
  onPick: (asked: string) => void
}) {
  return (
    // The hairline sits between rows, on the wrapper — a rule on the
    // inset button would run 8px wider than every other rule on screen.
    <div className={first ? '' : 'border-t border-line'}>
      <button
        type="button"
        onClick={() => onPick(asked)}
        className="-mx-2 flex min-h-[52px] w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-sunken active:bg-sunken"
      >
        <span
          className="flex w-[22px] shrink-0 justify-center text-[15px] leading-none font-semibold text-accent"
          aria-hidden="true"
        >
          ?
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{asked}</span>
        {/* Fills the box, it does not submit — but it does lead
            somewhere, and the chevron says so. */}
        <Chevron dir="right" size={16} className="shrink-0 text-faint" />
      </button>
    </div>
  )
}

/**
 * The same three subject-free questions, offered twice for two different
 * reasons: switching to an empty Ask box, and a question that came back with
 * nothing. Both are the grammar naming what it can answer rather than leaving
 * a dead end — one before anything was typed, one after something was and
 * found nothing. Shared so the two can never drift into different wording.
 */
export function AskSuggestions({
  heading,
  onPick,
  onHelp,
}: {
  heading: string
  onPick: (asked: string) => void
  onHelp: () => void
}) {
  return (
    <div className="mt-[26px]">
      <p className="mb-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
        {heading}
      </p>

      <div>
        {QUESTIONS.map((asked, at) => (
          <QuestionRow key={asked} asked={asked} first={at === 0} onPick={onPick} />
        ))}
      </div>

      {/* The manual's Asking section covers the half these three cannot:
          naming a subject, and a single day. A text button on the rows' own
          left axis, not an underlined web link. */}
      <button
        type="button"
        onClick={onHelp}
        className="flex h-11 items-center text-sm font-medium text-accent"
      >
        all examples
      </button>
    </div>
  )
}

/**
 * The Ask destination's curated questions, grouped by what they are about —
 * spec 017's topic pills, as groups rather than a second control style.
 *
 * Every question stays deliberately **subject-free** and shaped exactly like
 * the three in `QUESTIONS`, because those are the shapes the grammar is known
 * to answer — a topic heading is allowed to organise them, not to promise
 * subjects the log may never have mentioned. Each group is headed by a true
 * figure counted from the same rows the answers will read; the mock's "Neural
 * Sync" badge named a feature that does not exist, and nothing here may.
 */
/** Written out, never interpolated: Tailwind only compiles what it can see. */
const TOPIC_TEXT: Record<'expense' | 'time' | 'event', string> = {
  expense: 'text-expense',
  time: 'text-time',
  event: 'text-event',
}

const TOPICS: { name: string; kind: 'expense' | 'time' | 'event'; questions: string[] }[] = [
  {
    name: 'Spending',
    kind: 'expense',
    questions: ['how much this month', 'how much last week', 'how much this year'],
  },
  {
    name: 'Time & focus',
    kind: 'time',
    questions: ['hours worked this week', 'hours worked last month', 'hours worked this year'],
  },
  {
    name: 'Events & memory',
    kind: 'event',
    questions: ['what happened yesterday', 'what happened last week', 'what happened last month'],
  },
]

export function AskTopics({
  all,
  onPick,
  onHelp,
}: {
  /** The whole local log, for the figure beside each topic. */
  all: Entry[]
  onPick: (asked: string) => void
  onHelp: () => void
}) {
  // One pass for the three captions. Light derivation, not a figure block —
  // the exact arithmetic lives in the answers themselves.
  const held = useMemo(() => {
    let expenses = 0
    let logged = 0
    let events = 0
    for (const row of all) {
      if (row.kind === 'expense') expenses += 1
      if (row.kind === 'time') logged += row.duration_minutes ?? 0
      if (row.kind === 'event') events += 1
    }
    return { expenses, logged, events }
  }, [all])

  const caption: Record<'expense' | 'time' | 'event', string> = {
    expense: `${held.expenses} ${held.expenses === 1 ? 'expense' : 'expenses'}`,
    time: held.logged === 0 ? '0m logged' : `${minutes(held.logged)} logged`,
    event: `${held.events} ${held.events === 1 ? 'event' : 'events'}`,
  }

  return (
    <div>
      {/* The mock's grouping (020): a tinted group card, the topic's name in
          its own kind colour, and the questions as white wrap-chips inside. */}
      {TOPICS.map((topic) => (
        <div key={topic.name} className="mt-3 first:mt-[26px] rounded-2xl bg-sunken p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`flex items-center gap-1.5 text-xs font-semibold ${TOPIC_TEXT[topic.kind]}`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 self-center rounded-full ${DOT[topic.kind]}`}
              />
              {topic.name}
            </p>
            <span className="shrink-0 text-xs text-faint tabular-nums">
              {caption[topic.kind]}
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {topic.questions.map((asked) => (
              <button
                key={asked}
                type="button"
                onClick={() => onPick(asked)}
                className="flex min-h-11 items-center gap-1.5 rounded-lg bg-raised px-3 text-left text-sm text-ink transition-opacity hover:opacity-80 active:opacity-80"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[topic.kind]}`}
                />
                {asked}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* The manual's Asking section covers the half these cannot: naming a
          subject, and a single day. */}
      <button
        type="button"
        onClick={onHelp}
        className="flex h-11 items-center text-sm font-medium text-accent"
      >
        all examples
      </button>
    </div>
  )
}

/**
 * Shown in the preview row while the field is empty and the mode is Log — the
 * same trick the empty-day examples play, folded into one line since this one
 * runs beside the field on every day, not only an empty one. Static text, not
 * a live one: it sits outside `#quick-add-preview` so nothing is announced at
 * launch, the same silence the field itself starts in.
 */
const HINTS = ['350 lunch', '2h client', 'dentist 5pm']

/** Written out, never interpolated: Tailwind only compiles classes it can see. */
const DOT: Record<Kind, string> = {
  expense: 'bg-expense',
  time: 'bg-time',
  event: 'bg-event',
  note: 'bg-note',
}

type Mode = 'log' | 'ask'

/** Whatever was thrown, as something a person can read. */
function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

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
  /** Returns the saved row, so a staged photo can be filed against its real id. */
  onSubmit: (parsed: ParsedEntry) => Row
  /** `label: item, item, ...` — one line, several rows. See `parseMulti`. */
  onSubmitMulti: (parsed: ParsedEntry[]) => Row[]
  /** Every entry, for answering questions. Null until asked for. */
  corpus: Entry[] | null
  onNeedCorpus: () => void
  /** Text dropped in from elsewhere, such as an example tapped in the manual. */
  prefill: string | null
  onPrefilled: () => void
  onHelp: () => void
  /**
   * Whether the field holds anything, reported upward — the Ask destination
   * draws its own empty state in the page body now, and it has to stand down
   * the moment there is text, or the suggestions sit under a result. Told
   * rather than read, like `showExamples`: the text lives here.
   */
  onFilled?: (filled: boolean) => void
  /**
   * A guest whose device has never held a single entry — not just today's.
   * The single most important screen in the app, seen exactly once: the
   * empty-day examples below still do the showing, but a returning reader's
   * "nothing here yet" says nothing about what this box even is.
   */
  firstEver: boolean
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
  onSubmitMulti,
  corpus,
  onNeedCorpus,
  prefill,
  onPrefilled,
  onHelp,
  onOpenEntry,
  onFilled,
  firstEver,
}: Props) {
  const [text, setText] = useState('')
  const dictation = useDictation(setText)
  const box = useRef<HTMLTextAreaElement>(null)
  /** The Ask date trigger's own input — the OS picker, nothing drawn here. */
  const dates = useRef<HTMLInputElement>(null)

  /**
   * Photos picked before the entry exists.
   *
   * Held in memory as the stored JPEG rather than the original `File`: the
   * decode happens once, here, as each photo is chosen. Doing all of them back
   * to back on Save meant several multi-MB originals decoding into the
   * WebView's native heap at once, which is how a second camera photo went
   * missing. Still never written to IndexedDB — there is no entry id to file
   * them under until Save, and a photo stored against a draft would outlive a
   * composition that is abandoned. Nothing is written, so nothing is orphaned.
   */
  const [staged, setStaged] = useState<{ id: string; blob: Blob; url: string }[]>([])
  /**
   * Photos picked but not yet decoded — a count, not identities, because
   * nothing distinguishes one pending file from another until it resolves
   * into a real thumbnail. Lets the strip show *something* the instant files
   * are picked instead of staying empty through the whole decode, which on a
   * camera-resolution original reads as "did this even work?"
   */
  const [pending, setPending] = useState(0)
  const gallery = useRef<HTMLInputElement>(null)
  /** A photo that could not be filed, said separately from the entry's own outcome. */
  const [photoProblem, setPhotoProblem] = useState<string | null>(null)
  /** The staged photo being looked at full-size, if any. */
  const [viewing, setViewing] = useState<number | null>(null)

  /**
   * Unmount only. Every other exit already revokes what it drops — `unstage`
   * one at a time, `clearStaged` on a save — and this is the last one: the app
   * being closed or the composer being torn down mid-composition.
   */
  const held = useRef(staged)
  held.current = staged
  useEffect(() => {
    return () => {
      for (const photo of held.current) URL.revokeObjectURL(photo.url)
    }
  }, [])

  /**
   * Processed here, one at a time, so the heavy work is spread across the taps
   * that chose the photos rather than landing in one burst on Save. A file
   * that cannot be decoded says so now, while the thing it refers to is still
   * on screen, instead of at the end of an entry the user thought was done.
   */
  async function stage(files: FileList) {
    setPhotoProblem(null)
    const picked = [...files]
    setPending((n) => n + picked.length)
    for (const file of picked) {
      try {
        const blob = await fromFile(file)
        setStaged((held) => [
          ...held,
          { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) },
        ])
      } catch (failure) {
        setPhotoProblem(`Couldn't add that photo: ${message(failure)}`)
      } finally {
        setPending((n) => n - 1)
      }
    }
  }

  /**
   * A photo taken rather than picked. It arrives already at the stored size,
   * so it skips the canvas decode `stage` does — cancelling says nothing,
   * because backing out of the camera is a decision and not a fault.
   */
  async function shoot() {
    setPhotoProblem(null)
    expectForegroundReturn()
    const taken = await takePhoto()
    if (taken === 'cancelled') return
    if (taken === 'denied') {
      setPhotoProblem('lifelog needs camera permission to take a photo.')
      return
    }
    if (taken === 'unavailable') {
      setPhotoProblem("Couldn't open the camera.")
      return
    }
    setStaged((held) => [
      ...held,
      { id: crypto.randomUUID(), blob: taken, url: URL.createObjectURL(taken) },
    ])
  }

  function unstage(id: string) {
    setStaged((held) => {
      const going = held.find((photo) => photo.id === id)
      if (going !== undefined) URL.revokeObjectURL(going.url)
      return held.filter((photo) => photo.id !== id)
    })
  }

  /** Clears the strip and its object URLs — a submit that landed, or a field emptied. */
  function clearStaged(held: { url: string }[]) {
    for (const photo of held) URL.revokeObjectURL(photo.url)
    setStaged([])
  }

  /**
   * Files the staged photos against the row that now exists.
   *
   * One at a time, and a failure never touches the entry: it is already saved,
   * already on screen, and telling someone their expense failed because a JPEG
   * would not encode is a lie about the thing they came here to do. The rest
   * still go.
   */
  async function commitStaged(entryId: string, held: { blob: Blob }[]) {
    let failures = 0
    // Carried rather than counted: "1 of 2 photos couldn't be attached" named
    // the arithmetic and not the problem, which is the wrong half to keep when
    // the whole question is why.
    let why = ''
    for (const photo of held) {
      try {
        await put(entryId, photo.blob)
      } catch (failure) {
        failures += 1
        why = message(failure)
      }
    }
    if (failures > 0) {
      setPhotoProblem(
        failures === held.length
          ? `Entry saved, but the photo couldn't be attached: ${why}`
          : `Entry saved, but ${failures} of ${held.length} photos couldn't be attached: ${why}`,
      )
    }
  }

  /**
   * Grows with what's typed or pasted, up to `max-h-40` in the className
   * below — past that it scrolls internally rather than pushing the preview
   * row and the rest of the page down. The reset-to-`auto` step is what lets
   * it shrink back too: reading `scrollHeight` while the old height is still
   * applied would only ever measure "at least as tall as before".
   */
  useEffect(() => {
    const el = box.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

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

  // One boolean, so the effect fires on the empty/filled edge and not on
  // every keystroke's re-render.
  const filled = trimmed !== ''
  /**
   * Deferred a frame, never called inline.
   *
   * `onFilled` drives `askFilled` in `App`, which collapses the whole
   * `AskTopics` block the instant Ask's box goes from empty to filled. That
   * collapse landing in the same render cycle as the keystroke which caused
   * it is how the first character typed in Ask stopped sticking — a layout
   * reflow sharing a tick with the soft keyboard's own commit is a known way
   * for an Android WebView to lose the composition in flight. Waiting one
   * frame lets the keystroke's own commit settle first.
   */
  useEffect(() => {
    const id = requestAnimationFrame(() => onFilled?.(filled))
    return () => cancelAnimationFrame(id)
  }, [filled, onFilled])

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

  /**
   * `label: item, item, ...` — tried ahead of a single parse, and only ever in
   * Log mode: a line that doesn't match reads as `null` and everything below
   * falls through to `parsed` exactly as it did before this existed.
   */
  const multi = useMemo(
    () => (asking || mode === 'ask' ? null : parseMulti(text, now, day)),
    [asking, mode, text, now, day],
  )
  /** The one figure worth surfacing for a batch — a count alone does not say
   *  whether it added up to anything. Zero when nothing in the batch has a
   *  price, which is not shown at all rather than printed as "₹0 total". */
  const multiTotal = multi?.reduce((sum, entry) => sum + (entry.amountPaise ?? 0), 0) ?? 0

  // `day`, not today: an undated entry belongs to the day being viewed.
  const parsed = useMemo(
    () => (asking || mode === 'ask' || multi !== null ? null : parse(text, now, day)),
    [asking, mode, text, now, day, multi],
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

  /**
   * One more question the log can certainly answer: the same one, a period
   * back. A refill exactly like a suggestion row — never an action — and only
   * over the relative periods where "the one before" is well defined; a
   * question about 14 Nov has no obvious predecessor worth offering.
   */
  const followUp = useMemo(() => {
    if (question === null) return null
    if (question.measure !== 'money' && question.measure !== 'hours') return null
    const shifted = text.replace(/\bthis\s+(week|month|year)\b/i, 'last $1')
    return shifted === text ? null : shifted.trim()
  }, [question, text])

  /** There is something worth saving, so the send button takes the mic's place. */
  const ready = (parsed !== null || multi !== null) && !asking

  function submit(event: FormEvent | KeyboardEvent) {
    event.preventDefault()
    // A question is not an entry. Hiding the send button was not enough: the
    // keyboard's own Enter reaches here, and the re-parse below would happily
    // file "? how many times ping me" away as a note.
    if (asking) return
    // Captured before the state is cleared: the commit below is async and
    // would otherwise read an empty strip.
    const held = staged

    // Re-parsed against the real clock, for the same reason the single-entry
    // path below does: `now` is held in state and refreshed only on focus,
    // which is fine for a preview but wrong for saving.
    const freshMulti = parseMulti(text, new Date(), day)
    if (freshMulti !== null) {
      const rows = onSubmitMulti(freshMulti)
      setText('')
      clearStaged(held)
      // The batch shares one line of text, so there is no per-item question to
      // ask about which row a photo belongs to. The first row is a guess;
      // dropping the photos entirely is data loss.
      const first = rows[0]
      if (held.length > 0 && first !== undefined) void commitStaged(first.id, held)
      return
    }
    // With the app left open, "in 2 minutes" measured from the last focus can
    // already be in the past, and the reminder is then silently skipped as
    // overdue.
    const fresh = parse(text, new Date(), day)
    if (!fresh) return
    const row = onSubmit(fresh)
    setText('')
    clearStaged(held)
    if (held.length > 0) void commitStaged(row.id, held)
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
      <div
        className={`capture ${
          // On the Ask destination the box leads the screen (019) — its two
          // halves swap exactly as they already do on `lg`, same mechanism.
          ask ? 'order-first' : 'order-last mt-2 lg:order-first lg:mt-0'
        } rounded-xl border border-edge bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors focus-within:border-muted`}
      >
        <textarea
          id="quick-add"
          ref={box}
          rows={1}
          value={text}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // "done" while asking, since Enter there only dismisses the
          // keyboard — there is nothing to send, the answer is already on
          // screen. Never "send" in Log: submitting is the Save button's job
          // alone now, and a keyboard hinting "send" for a key that breaks
          // the line instead is the exact mismatch this spec exists to fix.
          enterKeyHint={asking ? 'done' : 'enter'}
          placeholder={mode === 'ask' ? 'What do you want to know?' : 'What happened?'}
          aria-label={mode === 'ask' ? 'What do you want to know?' : 'What happened?'}
          onChange={(event) => {
            setText(event.target.value)
            // A stale dictation error otherwise sits over the parse preview.
            if (dictation.error !== null) dictation.clearError()
          }}
          onKeyDown={(event) => {
            // Enter breaks the line, the way every chat app's keyboard does —
            // Save is the only way to send now. `enterKeyHint` below matches:
            // it no longer claims "send" for something Enter no longer does.
            // Explicit, because implicit form submission on an IME action key
            // is not something every Android keyboard agreed about either.
            if (event.key === 'Enter' && asking) {
              event.preventDefault()
              // A question is single-line and the answer is already on
              // screen — it updates as you type — so there is nothing to
              // send and no reason to break its line. Dropping the keyboard
              // is the useful thing Enter can do, because the keyboard is
              // covering it.
              event.currentTarget.blur()
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
          // Grows via the effect above; `max-h-40` is where it stops and
          // starts scrolling internally instead, and `resize-none` keeps
          // that the only way its height ever changes.
          // Asking takes the mock capsule's larger voice; logging keeps 16px.
          className={`max-h-40 w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-2 text-ink outline-none placeholder:text-faint ${
            mode === 'ask' ? 'text-lg' : 'text-base'
          }`}
        />

        {/* Between the text and the controls, because that is where what you
            have attached belongs: part of what you are composing, above the
            row that sends it. Only ever present while something is staged or
            still decoding, so the control keeps its usual height on every
            other keystroke. */}
        {(staged.length > 0 || pending > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {staged.map((photo, position) => (
              <div key={photo.id} className="relative h-14 w-14">
                {/* The thumbnail is the way in to the photo, not decoration
                    beside a remove button — a bill attached and never
                    viewable again is the whole reason this is here. Opens the
                    staged set at this one, so several can be checked over
                    before any of them is saved. */}
                <button
                  type="button"
                  onClick={() => setViewing(position)}
                  aria-label={`View photo ${position + 1}`}
                  className="h-full w-full overflow-hidden rounded-lg border border-edge"
                >
                  {/* `transform-gpu` forces this blob URL onto its own
                      compositing layer so it paints on its first frame — a
                      freshly assigned blob src otherwise can stay blank in
                      this WebView until something unrelated forces a
                      repaint. */}
                  <img src={photo.url} alt="" className="h-full w-full object-cover transform-gpu" />
                </button>
                <button
                  type="button"
                  onClick={() => unstage(photo.id)}
                  aria-label="Remove photo"
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/70 text-surface"
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
            {/* One tile per file still decoding — static, no animation, so
                there's nothing to reconcile against reduced-motion. Its job
                is only to prove the pick was received before the real
                thumbnail exists to prove it instead. Decorative: the one
                status line below says the same thing once for a screen
                reader, rather than each tile announcing itself. */}
            {pending > 0 && (
              <p role="status" className="sr-only">
                Adding {pending} {pending === 1 ? 'photo' : 'photos'}
              </p>
            )}
            {Array.from({ length: pending }).map((_, index) => (
              <div
                key={`pending-${index}`}
                aria-hidden="true"
                className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-edge bg-sunken text-faint"
              >
                <ImageIcon size={18} />
              </div>
            ))}
          </div>
        )}

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
            {/* The hint as three tappable chips (021): the same syntax the
                text taught, now one tap from being edited rather than typed.
                Each chip sits inside the row's own 44px height. */}
            {mode === 'log' && trimmed === '' && !asking && (
              <span className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                <span className="shrink-0 text-faint">e.g.</span>
                {HINTS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => {
                      setText(hint)
                      document.getElementById('quick-add')?.focus()
                    }}
                    className="flex h-11 shrink-0 items-center"
                  >
                    <span className="rounded bg-sunken px-2 py-0.5 text-ink transition-opacity hover:opacity-80">
                      {hint}
                    </span>
                  </button>
                ))}
              </span>
            )}
            {/* The row exists to hold the control's height, so in Ask it says
                what the control does rather than sitting visibly empty. Plain
                text outside the live region, exactly like the hint above. */}
            {mode === 'ask' && trimmed === '' && (
              <span className="flex min-w-0 items-center gap-1.5 text-faint">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {/* Example shapes the grammar certainly answers — never a
                    subject the log may not hold. */}
                <span className="truncate">e.g. “hours worked this week” — answers appear as you type</span>
              </span>
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
              ) : multi ? (
                // One text node, the same discipline the single-entry preview
                // keeps: a count and, only where it means something, a total —
                // never the per-item breakdown, which would be the longest
                // line in the app and unreadable at a glance either way. Every
                // item shares the label's date, so they share this warning too.
                <span className="text-muted tabular-nums">
                  {multi.length} entries
                  {multiTotal > 0 && ` · ${rupees(multiTotal)} total`}
                  {multi[0]?.occurredOn !== day && (
                    <span className="font-medium text-event">
                      {' → saving to '}
                      {relativeDay(multi[0]?.occurredOn ?? day, now)}
                    </span>
                  )}
                </span>
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
          {/* Attaching is only ever about an entry, so it has nothing to offer a
              question — and in Ask the row belongs to the answer. Beside the
              mic and send rather than anywhere near the field: capture is the
              product, and a control that is not in the way costs nothing when
              it is not used. */}
          {/* Two controls, because they are two different acts and the OS
              offers no single dialog for both. Gallery is an ordinary file
              input; Camera cannot be, and the attempt is documented in
              `camera.ts` — a `capture` input opens the picker, so for two
              specs this control could only ever pick an old photo. */}
          {mode === 'log' && (
            <>
              <input
                ref={gallery}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void stage(event.target.files)
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => {
                  expectForegroundReturn()
                  gallery.current?.click()
                }}
                aria-label="Add from gallery"
                className="flex h-11 w-9 shrink-0 items-center justify-center text-faint transition-colors hover:text-muted"
              >
                <ImageIcon size={18} />
              </button>
              {/* Offered only where it can work. In a browser Gallery is the
                  whole story, and a button that always failed would be worse
                  than one that is not there. */}
              {cameraAvailable() && (
                <button
                  type="button"
                  onClick={() => void shoot()}
                  aria-label="Take photo"
                  className="flex h-11 w-9 shrink-0 items-center justify-center text-faint transition-colors hover:text-muted"
                >
                  <CameraIcon size={18} />
                </button>
              )}
            </>
          )}

          {/* Asking about a date without typing it: the OS date picker, whose
              pick lands in the box as text — `d MMM` is a shape the question
              grammar already reads, so an inserted date and a typed one are
              the same question. On an empty box it asks the proven question
              shape whole. */}
          {mode === 'ask' && (
            <>
              <input
                ref={dates}
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                onChange={(event) => {
                  const picked = event.target.value
                  if (picked === '') return
                  const said = format(parseISO(picked), 'd MMM')
                  setText((held) =>
                    held.trim() === '' ? `what happened ${said}` : `${held.trim()} ${said}`,
                  )
                  event.target.value = ''
                  document.getElementById('quick-add')?.focus()
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const input = dates.current
                  if (input === null) return
                  if (typeof input.showPicker === 'function') input.showPicker()
                  else input.click()
                }}
                aria-label="Ask about a date"
                className="flex h-11 w-9 shrink-0 items-center justify-center text-faint transition-colors hover:text-muted"
              >
                <CalendarIcon size={18} />
              </button>
            </>
          )}

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
                className="-mr-0.5 flex h-11 w-11 shrink-0 items-center justify-center"
              >
                {/* The accent disc — Variant E's mic (021); listening turns
                    it the expense red the old plain glyph used. */}
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-surface transition-colors ${
                    dictation.listening ? 'bg-expense' : 'bg-accent'
                  }`}
                >
                  <MicIcon size={16} />
                </span>
              </button>
            )
          )}
        </div>
      </div>

      {viewing !== null && (
        <PhotoViewer photos={staged} index={viewing} onClose={() => setViewing(null)} />
      )}

      {/* The entry itself is saved and on the timeline — this says only that
          its photo is not, which is the one thing the toast must not be made
          to say for it. */}
      {photoProblem !== null && (
        <p role="alert" className="order-last mt-2 text-xs text-expense lg:order-first">
          {photoProblem}
        </p>
      )}

      {/* Keyed on the text: a new question is a new answer, collapsed again.
          The 30-second clock tick must not fold up an answer being read.
          Not for a flat "nothing found": a headline-sized card announcing an
          absence is the dead end this file's own Log-instead button and
          AskSuggestions block exist to replace with a next step. */}
      {answer !== null && answer.lead !== 'nothing found' && (
        <AnswerCard
          key={text}
          answer={answer}
          now={now}
          evidence={summary?.entries}
          money={question?.measure === 'money'}
          onPick={(row) => {
            onOpenEntry(row)
            // The question has been answered and acted on; leaving it in the box
            // would hide the day it just took you to.
            setText('')
          }}
        />
      )}

      {/* Under the answer, not inside it: the card is the answer and this is
          the next question. Fills the box the way every suggestion does. */}
      {answer !== null && answer.lead !== 'nothing found' && followUp !== null && (
        <div className="mt-2.5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
            Follow-ups
          </p>
          <div className="mt-0.5 flex flex-wrap">
            <button
              type="button"
              onClick={() => {
                setText(followUp)
                document.getElementById('quick-add')?.focus()
              }}
              className="flex h-11 items-center"
            >
              <span className="flex min-h-8 items-center gap-1.5 rounded-full bg-sunken px-3 text-xs font-medium text-ink transition-opacity hover:opacity-80">
                <span aria-hidden="true" className="font-semibold text-accent">
                  ?
                </span>
                {followUp.replace(/^\?\s*/, '')}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* A question that found nothing, over text the parser plainly understands
          as something *actionable* — not merely a `note`, which is what parse()
          falls back to for any text it recognises nothing else in, a real
          question among them. Offering "Log instead: note · how much on rent"
          would be filing the question itself away, not a saved step. */}
      {answer !== null &&
        summary !== null &&
        summary.entries === 0 &&
        wouldLog !== null &&
        wouldLog.kind !== 'note' && (
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
          sits under a result. Only where the mode came from the control's own
          toggle (`lg`): on a phone Ask is a destination, and the destination
          fills its screen from the top with the same suggestions — two lists
          at once would say less than either. */}
      {mode === 'ask' && !ask && trimmed === '' && (
        <AskSuggestions
          heading="Try asking"
          onPick={(asked) => {
            setText(asked)
            document.getElementById('quick-add')?.focus()
          }}
          onHelp={onHelp}
        />
      )}

      {/* A question the grammar understood but that matched nothing, and
          could not be offered as Log instead either — the dead end `?` exists
          to avoid. Same fallback as the empty box above: three questions this
          log can certainly answer, in place of a flat "nothing found". */}
      {answer !== null &&
        summary !== null &&
        summary.entries === 0 &&
        (wouldLog === null || wouldLog.kind === 'note') &&
        trimmed !== '' && (
          <AskSuggestions
            heading="Try one of these instead"
            onPick={(asked) => setText(asked)}
            onHelp={onHelp}
          />
        )}

      {/* Only while logging: on an empty day in Ask mode the questions above are
          the useful thing, and both at once is two lists of examples. */}
      {showExamples && mode === 'log' && (
        <div className="mt-5">
          <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
            {/* One line of orientation, first launch only — a returning
                reader's "nothing here yet" says nothing about what this box
                even is, and the examples below can only show the syntax, not
                the concept. */}
            {firstEver ? 'This box is your whole log — try one' : 'Nothing here yet'}
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
                  {/* Monospace, because this is the line to type verbatim — it
                      should look typed, not written. */}
                  <span className="block truncate font-mono text-sm text-muted">
                    {example.typed}
                  </span>
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
