import { useState, type FormEvent } from 'react'
import { CheckIcon } from './Icons'
import { Sheet } from './Sheet'
import {
  done as isDone,
  leadWords,
  nextFireAt,
  recurring,
  reminderAt,
  repeatLabel,
  repeatOnly,
} from '../lib/events'
import {
  MAX_PAISE,
  amountFits,
  atTime,
  clockAt,
  dayKey,
  minutesFit,
  paiseFrom,
  relativeDay,
  rupees,
  timeValue,
} from '../lib/format'
import { recurringTitle } from '../lib/parser'
import type { Patch, Row } from '../hooks/useEntries'
import type { Kind } from '../types'

type Props = {
  row: Row
  /** For "next 17 Sep at 10:00 am" — a claim about the clock needs the clock. */
  now: Date
  onSave: (patch: Patch) => void
  onDelete: () => void
  onAddToCalendar: () => void
  onClose: () => void
}

const LABEL = 'mb-1.5 block text-[0.6875rem] font-medium tracking-[0.08em] text-faint uppercase'
const FIELD =
  'w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink outline-none transition-colors focus:border-muted'
// 44px, like everything else. `text-base` with `py-2.5` measured 42 on a Galaxy
// S21 FE — the app's own rule, missed by two pixels in the one place an entry is
// corrected. The height is set rather than the padding, because the same base is
// also the title's textarea, which is sized by its rows.
const INPUT = `${FIELD} h-11`
const AREA = `${FIELD} min-h-20 resize-y py-2.5 leading-relaxed`

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
export function EntryEditor({ row, now, onSave, onDelete, onAddToCalendar, onClose }: Props) {
  const [kind, setKind] = useState<Kind>(row.kind)
  const [title, setTitle] = useState(row.title)
  const [day, setDay] = useState(row.occurred_on)
  const [time, setTime] = useState(row.occurred_at === null ? '' : timeValue(row.occurred_at))
  const [amount, setAmount] = useState(rupeeText(row.amount_paise))
  const [duration, setDuration] = useState(
    row.duration_minutes === null ? '' : String(row.duration_minutes),
  )
  const [finished, setFinished] = useState(isDone(row))
  /**
   * The repeat the user has chosen in this sheet, or null while they have not
   * touched it. A wrapper rather than a bare `string | undefined`, because
   * "chose to have none" and "has not chosen" are different answers and only one
   * of them should override what the entry already carries.
   */
  const [choice, setChoice] = useState<{ rule: string | undefined } | null>(null)
  /**
   * The lead the user has chosen in this sheet, or null while they have not
   * touched it — the same wrapper `choice` uses above, for the same reason:
   * "chose on the day" and "has not chosen" both read as `undefined` minutes
   * and only one of them should override what the entry already carries.
   */
  const [leadChoice, setLeadChoice] = useState<{ minutes: number | undefined } | null>(null)
  /**
   * Why the save did not happen. Pressing Save and having nothing at all occur
   * is the same silence the rest of the app spent three bugs learning to avoid.
   */
  const [problem, setProblem] = useState<string | null>(null)

  // Driven by the chosen kind, not the stored one, so switching to an expense
  // reveals the amount field there and then.
  const showAmount = kind === 'expense' || row.amount_paise !== null
  const showDuration = kind === 'time' || row.duration_minutes !== null

  // The row renders the title as flowing text over two lines, so a newline
  // typed in the editor would show as a gap rather than a break.
  const cleaned = title.trim().replace(/\s+/g, ' ')

  /**
   * The repeat this entry will carry once saved.
   *
   * **The title is read only when a note becomes an event**, which is the one
   * case that needs it: a birthday whose date had passed was parsed as a note,
   * so it never recurred and could not answer "when is it". Correcting the kind
   * should apply the rule the parser would have. Demoting away from an event
   * drops it, since only events recur.
   *
   * It used to be re-read on *every* save, and that is what made a repeat
   * impossible to switch off — clear a birthday's yearly rule and the word
   * `birthday` put it straight back on the next save, so the control could not
   * be built. It also forced the weekly rule into a special case, because
   * `weekdays` is typed as an instruction and survives nowhere in the title, so
   * recomputing it the same way deleted it: a save that merely marked a standup
   * done silently unscheduled five alarms. Deriving only on promotion needs no
   * such exception — an existing event simply keeps what it has, whichever rule
   * that is.
   *
   * The cost is that retitling an existing event to "deepak birthday" no longer
   * makes it yearly by itself. That is what the control below is for, and a
   * repeat you can turn off is worth more than one that appears from a word.
   *
   * Worked out here rather than inside `save` because the line above the fields
   * states when this next happens. Left in `save` the two would have been
   * separate readings of the same fields, free to disagree — and the
   * disagreement would be a sentence saying one thing while the button did
   * another.
   */
  const stored = typeof row.data.rrule === 'string' ? row.data.rrule : undefined
  const promoting = row.kind !== 'event' && kind === 'event'
  const derived = promoting ? (recurringTitle(cleaned) ? 'FREQ=YEARLY' : undefined) : stored
  const rule = kind !== 'event' ? undefined : (choice === null ? derived : choice.rule)

  /**
   * The lead this entry will carry once saved. Absent means on the day, which
   * is also what a demotion away from an event drops it to — a note has
   * nothing to be early for.
   */
  const storedLead =
    typeof row.data.lead === 'number' && row.data.lead > 0 ? row.data.lead : undefined
  const lead = kind !== 'event' ? undefined : (leadChoice === null ? storedLead : leadChoice.minutes)

  const nextData = { ...row.data }
  if (rule === undefined) delete nextData.rrule
  else nextData.rrule = rule
  if (finished) nextData.done = true
  else delete nextData.done
  if (lead === undefined) delete nextData.lead
  else nextData.lead = lead

  /** The entry as this form would save it, which is what the next line describes. */
  const pending: Row = {
    ...row,
    kind,
    occurred_on: day,
    occurred_at: time === '' ? null : atTime(day, time),
    data: nextData,
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!cleaned) {
      setProblem('An entry needs a title.')
      return
    }

    // Rebuilt from both fields every time, so editing either one is enough and
    // clearing the time turns a reminder back into an all-day entry.
    const patch: Patch = {
      kind,
      title: cleaned,
      occurred_on: pending.occurred_on,
      occurred_at: pending.occurred_at,
    }

    if (rule !== row.data.rrule || finished !== isDone(row) || lead !== storedLead)
      patch.data = nextData
    // Refused here rather than saved and owed for ever: these two columns are
    // Postgres `integer`, so a bigger number reaches the server once, is
    // rejected with `22003`, and leaves a row that looks saved, counts into the
    // day's total and can never sync. Saying so costs one line.
    if (showAmount) {
      const paise = paiseFrom(amount)
      if (paise !== null && !amountFits(paise)) {
        setProblem(`The largest amount lifelog can store is ${rupees(MAX_PAISE)}.`)
        return
      }
      patch.amount_paise = paise
    }
    if (showDuration) {
      const value = Number(duration.trim())
      const mins = duration.trim() && Number.isFinite(value) ? Math.round(value) : null
      if (mins !== null && !minutesFit(mins)) {
        setProblem('That is more minutes than an entry can hold.')
        return
      }
      patch.duration_minutes = mins
    }

    setProblem(null)
    onSave(patch)
  }

  // The date and time are editable below, so repeating them here would be noise.
  // The repeat is not: it is the one thing about the entry that no field shows,
  // and the date field alone reads as a one-off. Read off `pending`, so
  // switching the kind to a note stops claiming a repeat the save is about to
  // drop.
  const context = [row.category, repeatLabel(pending)].filter(
    (bit): bit is string => bit !== null && bit !== '',
  )

  /**
   * When this entry next happens, and when its reminder actually comes —
   * shown together, under the chips below, because a reader with only one of
   * the two has to do the date arithmetic themselves to check they line up.
   *
   * A repeat is stored once and expanded nowhere, so `weekdays` on the row was
   * the *only* evidence that anything had taken effect: it names the rule and
   * says nothing about whether a moment is actually coming. Opening the entry
   * and still not knowing when it next lands is how a working repeat reads as
   * broken from the inside, which is what happened with the standup.
   *
   * Deliberately worded as a fact about the calendar rather than about a
   * notification. Whether an alarm reaches you also depends on the OS permission
   * this sheet knows nothing about — and App already says so in its own banner.
   * Promising "rings" from here would be the one kind of claim this app must not
   * make and then fail to keep — truer still of the reminder moment than of the
   * event's own, since a lead makes the promise sound more specific.
   *
   * The two can disagree: a lead long enough to have already gone by leaves
   * `remindAt` null while `nextAt` is not, which gets its own sentence below
   * rather than silently falling back to the single-fact wording.
   */
  const nextAt = nextFireAt(pending, now)
  const remindAt = reminderAt(pending, now)

  // Nothing that repeats can be ticked off. `done` sits on the row, so marking
  // a weekday standup done would silence every future Monday as well as today's
  // — the same reasoning that already keeps `passed` false for a repeat. Read
  // off `pending`, so stopping the repeat offers the tick in the same breath
  // rather than making it a second visit to the sheet.
  const tickable = !recurring(pending)

  /**
   * Turning a repeat off, which nothing could do before this.
   *
   * Typing `weekdays` set one and no control took it away again, so the only way
   * out was to delete the row and retype it — losing the entry's history to
   * change one thing about it. Three states, because the way back matters as
   * much as the way out: what it repeats as, what it used to repeat as, and the
   * yearly rule a title is asking for. Nothing here is saved until Save, so
   * Cancel remains the full undo.
   *
   * Only yearly can be switched *on*. A weekly rule needs its days, and the
   * parser is where those are said — a day-picker here would be a second way to
   * express something the text box already handles in one word.
   */
  // The repeat alone, never the lead: an entry with only a lead has no repeat
  // to stop, and offering to stop one that is not there is the kind of
  // control that does something other than what it says.
  const repeats = repeatOnly(pending)
  const previously = stored === undefined ? null : repeatOnly(row)
  const couldRepeatYearly = kind === 'event' && rule === undefined && recurringTitle(cleaned)

  /**
   * Four values cover nearly every real case, plus a fifth that is not a
   * choice so much as an admission: the text box is the whole app, and a
   * typed `remind 2 hours before` must survive opening the entry it produced.
   * Recognising a value beats deciding one, so the fifth chip only ever shows
   * what is already there — there is no way to type a new one in here — and
   * it is gone the moment any other chip is picked.
   */
  const LEAD_PRESETS: (number | undefined)[] = [undefined, 60 * 24, 60 * 24 * 7, 60 * 24 * 30]
  const leadChips = [
    { minutes: undefined, label: 'On the day' },
    ...LEAD_PRESETS.slice(1).map((minutes) => ({
      minutes,
      label: `${leadWords(minutes as number)} before`,
    })),
    ...(lead !== undefined && !LEAD_PRESETS.includes(lead)
      ? [{ minutes: lead, label: `${leadWords(lead)} before` }]
      : []),
  ]

  return (
    <Sheet label={`Edit ${row.title}`} onClose={onClose}>
      <form onSubmit={save}>
        {/* Editable, because the parser guesses and a wrong guess otherwise
            means deleting and retyping the whole entry. */}
        <div
          role="group"
          aria-label="Kind"
          className="flex gap-1 rounded-xl border border-line bg-sunken p-1"
        >
          {(['expense', 'time', 'event', 'note'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              // 44px, not 36: four of these share a row, and shrinking the
              // target to fit the row is how 44 quietly becomes 36. The track
              // grows instead, exactly as the theme control's already does.
              className={`h-11 flex-1 rounded-lg text-xs transition-colors ${
                kind === option
                  ? `bg-raised font-medium shadow-[0_1px_2px_rgb(0_0_0/0.06)] ${KIND_TINT[option]}`
                  : 'text-muted hover:text-ink'
              }`}
            >
              {KIND_NAME[option]}
            </button>
          ))}
        </div>

        {context.length > 0 && <p className="mt-4 text-xs text-faint">{context.join(' · ')}</p>}

        <div className="mt-5">
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
            className={AREA}
          />
        </div>

        {/* Two per row: date and time, then amount or minutes. Four abreast is
            unusable at 375px. */}
        <div className="mt-4 grid grid-cols-2 gap-3">
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
              className={INPUT}
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
              className={INPUT}
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
                className={INPUT}
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
                className={INPUT}
              />
            </div>
          )}
        </div>

        {/* See `repeats` above. Worded as what it does to the calendar, not as a
            switch: "Stop repeating" says the consequence, where a toggle labelled
            "Repeat" would leave you working out which way is on. */}
        {repeats !== null ? (
          <button
            type="button"
            onClick={() => setChoice({ rule: undefined })}
            className="mt-5 h-11 w-full rounded-lg border border-edge text-sm font-medium text-muted transition-colors hover:bg-sunken"
          >
            Stop repeating
          </button>
        ) : previously !== null ? (
          <button
            type="button"
            onClick={() => setChoice({ rule: stored })}
            className="mt-5 h-11 w-full rounded-lg border border-edge text-sm font-medium text-muted transition-colors hover:bg-sunken"
          >
            Repeat {previously} again
          </button>
        ) : couldRepeatYearly ? (
          <button
            type="button"
            onClick={() => setChoice({ rule: 'FREQ=YEARLY' })}
            className="mt-5 h-11 w-full rounded-lg border border-edge text-sm font-medium text-muted transition-colors hover:bg-sunken"
          >
            Repeat every year
          </button>
        ) : null}

        {/* Only events have anything to be early for. */}
        {kind === 'event' && (
          <fieldset className="mt-5">
            <legend className={LABEL}>Reminder</legend>
            <div className="mt-1.5 flex flex-wrap gap-1 rounded-xl border border-line bg-sunken p-1">
              {leadChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={lead === chip.minutes}
                  onClick={() => setLeadChoice({ minutes: chip.minutes })}
                  className={`h-11 rounded-lg px-3 text-xs whitespace-nowrap transition-colors ${
                    lead === chip.minutes
                      ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <p className={`mt-2 text-xs ${finished ? 'text-faint' : 'text-muted'}`}>
              {finished ? (
                // The consequence of the button below, which is not obvious
                // from it: ticking a reminder off is also how you switch it off.
                'Done — no reminder.'
              ) : nextAt === null ? (
                'Its time has passed.'
              ) : lead === undefined ? (
                <>
                  Next{' '}
                  <span className="font-medium text-ink">
                    {relativeDay(dayKey(nextAt), now)} at {clockAt(nextAt)}
                  </span>
                </>
              ) : remindAt === null ? (
                <>
                  Its reminder has passed. Next{' '}
                  <span className="font-medium text-ink">
                    {relativeDay(dayKey(nextAt), now)} at {clockAt(nextAt)}
                  </span>
                </>
              ) : (
                <>
                  Next{' '}
                  <span className="font-medium text-ink">
                    {relativeDay(dayKey(remindAt), now)} at {clockAt(remindAt)}
                  </span>
                  {', '}
                  {leadWords(lead)} before{' '}
                  <span className="font-medium text-ink">
                    {relativeDay(dayKey(nextAt), now)} at {clockAt(nextAt)}
                  </span>
                </>
              )}
            </p>
          </fieldset>
        )}

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
            className="mt-5 h-11 w-full rounded-lg border border-edge text-sm font-medium text-ink transition-colors hover:bg-sunken"
          >
            Add to calendar
          </button>
        )}

        {problem !== null && (
          <p role="alert" className="mt-4 text-xs text-expense">
            {problem}
          </p>
        )}

        {/* Pinned. The fields scroll behind it, so Save is reachable without
            hunting for it — and on a phone the keyboard used to sit straight
            over this row. Full-bleed against the sheet's own padding, with a
            rule so the content does not appear to run underneath. */}
        {/* Primary first and filled; the two that undo sit back as plain text.
            All three were the same size and weight, so "Delete" had the same
            standing as "Save" on a sheet you open to make a small change. */}
        <div className="sticky bottom-0 -mx-5 mt-5 flex items-center gap-1 border-t border-line bg-raised px-5 pt-3 pb-1">
          <button
            type="submit"
            className="h-11 flex-1 rounded-lg bg-ink text-sm font-medium text-surface transition-opacity hover:opacity-90"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="h-11 rounded-lg px-3 text-sm text-expense transition-colors hover:bg-sunken"
          >
            Delete
          </button>
        </div>
      </form>
    </Sheet>
  )
}
