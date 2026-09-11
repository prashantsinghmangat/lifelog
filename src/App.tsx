import { addDays, parseISO, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DayHeader } from './components/DayHeader'
import { EntryEditor } from './components/EntryEditor'
import { EntryRow } from './components/EntryRow'
import { AheadSheet } from './components/AheadSheet'
import { HelpSheet } from './components/HelpSheet'
import { BellIcon, Chevron, PersonIcon } from './components/Icons'
import { Login } from './components/Login'
import { MonthGrid } from './components/MonthGrid'
import { MonthSheet } from './components/MonthSheet'
import { OnThisDay } from './components/OnThisDay'
import { ProfileSheet } from './components/ProfileSheet'
import { QuickAdd } from './components/QuickAdd'
import { Toast, type ToastState } from './components/Toast'
import { WeekStrip } from './components/WeekStrip'
import { useEntries, type Row } from './hooks/useEntries'
import { useNudges } from './hooks/useNudges'
import { useSession } from './hooks/useSession'
import { useSwipe } from './hooks/useSwipe'
import { useTheme } from './hooks/useTheme'
import { ahead } from './lib/ahead'
import { download, shareOrDownload } from './lib/deliver'
import { passed } from './lib/events'
import { clock, dayKey, dayLabel, minutes, relativeDay, rowValue, rupees } from './lib/format'
import { byClock, onThisDay } from './lib/history'
import { forget } from './lib/identity'
import { forCalendar, toIcs } from './lib/ics'
import { occurrencesOn } from './lib/occurrences'
import { isNative } from './lib/platform'
import {
  cancel as cancelReminder,
  permission as reminderPermission,
  requestPermission,
  schedule as scheduleReminder,
  scheduleNudges,
  sync,
} from './lib/reminders'
import { supabase } from './lib/supabase'
import type { ParsedEntry } from './lib/parser'
import type { Entry } from './types'

export default function App() {
  const { identity, loading } = useSession()
  // Resolved before the auth gate, so the login screen honours the choice too.
  const { theme, choose } = useTheme()

  if (loading) return <div className="p-4 text-sm text-faint">…</div>
  if (identity === null) return <Login />

  return <Day email={identity.email} userId={identity.id} theme={theme} onTheme={choose} />
}

type DayProps = {
  email: string
  /** Keys this device's copy of the log, so two accounts cannot see each other's. */
  userId: string
  theme: ReturnType<typeof useTheme>['theme']
  onTheme: ReturnType<typeof useTheme>['choose']
}

function Day({ email, userId, theme, onTheme }: DayProps) {
  const { nudges, choose: chooseNudges } = useNudges()
  const [now, setNow] = useState(() => new Date())
  const [day, setDay] = useState(() => dayKey(new Date()))
  const [editing, setEditing] = useState<Row | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [aheadOpen, setAheadOpen] = useState(false)
  // Whether the day's already-passed reminders have been unfolded.
  const [showEarlier, setShowEarlier] = useState(false)
  const [prefill, setPrefill] = useState<string | null>(null)
  const [notify, setNotify] = useState<'granted' | 'denied' | 'unavailable' | null>(null)
  // Every entry, fetched only once a question is actually asked, and dropped
  // whenever the log changes so an answer is never quietly out of date.
  const [corpus, setCorpus] = useState<Entry[] | null>(null)
  // Kept from the fetch reminders already make on launch, rather than asked for
  // again. Held apart from `corpus` on purpose: an answer must never be computed
  // from a stale log, while a memory of an earlier year cannot go stale from
  // anything typed today.
  const [history, setHistory] = useState<Entry[] | null>(null)
  const loading_ = useRef(false)
  const {
    entries,
    all,
    failedElsewhere,
    loading,
    error,
    reachable,
    owed,
    add,
    update,
    remove,
    restore,
    retry,
    fetchAll,
    fetchDays,
  } = useEntries(day, userId)

  // A tab left open overnight would keep parsing `today` as yesterday. The
  // interval matters as much as the events: with the app simply left open,
  // nothing fires, and the preview for "in 2 minutes" would be measured from
  // whenever it was last focused.
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const ticking = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(ticking)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const loadCorpus = useCallback(() => {
    if (corpus !== null || loading_.current) return
    loading_.current = true
    void fetchAll()
      .then(setCorpus)
      .catch(() => setCorpus([]))
      .finally(() => {
        loading_.current = false
      })
  }, [corpus, fetchAll])

  const goNext = useCallback(() => setDay((current) => dayKey(addDays(parseISO(current), 1))), [])
  const goPrevious = useCallback(
    () => setDay((current) => dayKey(subDays(parseISO(current), 1))),
    [],
  )
  const swipe = useSwipe(goNext, goPrevious)

  // Names the tab, which matters once the app is installed alongside others.
  useEffect(() => {
    document.title = `${dayLabel(day, now)} · lifelog`
  }, [day, now])

  // Every day opens folded: unfolding one is about that day, not a preference.
  useEffect(() => setShowEarlier(false), [day])

  const sheetOpen = calendarOpen || profileOpen || aheadOpen || editing !== null

  // Desktop navigation without reaching for the mouse. Deliberately inert while
  // typing or while a sheet is open, where these keys already mean something.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || sheetOpen) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable]')) return

      if (event.key === 'ArrowLeft') goPrevious()
      else if (event.key === 'ArrowRight') goNext()
      else if (event.key === 't') setDay(dayKey(new Date()))
      else if (event.key === '/' || event.key === 'n') {
        event.preventDefault()
        document.getElementById('quick-add')?.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrevious, sheetOpen])

  // A repeat is stored once and drawn on every day it lands on. Without this a
  // standup ringing Monday to Friday appeared on Monday alone, and the other
  // four days read as empty while the phone was armed to go off — a working
  // repeat that looked broken from inside the app.
  const shown = useMemo(
    () => [...entries, ...occurrencesOn(all, day)].sort(byClock),
    [entries, all, day],
  )

  // Totalled from the stored rows only. A derived occurrence is the same entry
  // seen from another day, so counting it would say a repeating entry cost five
  // times what it did.
  const spent = entries.reduce((total, row) => total + (row.amount_paise ?? 0), 0)
  const logged = entries.reduce((total, row) => total + (row.duration_minutes ?? 0), 0)

  // How many reminders at the head of the day have already been and gone.
  // Counted rather than filtered, so the rows keep their order.
  let over = 0
  for (const row of shown) {
    if (!passed(row, now)) break
    over += 1
  }
  const folded = showEarlier || over < 2 ? 0 : over
  const shownEntries = folded === 0 ? shown : shown.slice(folded)

  /** Hands the entry to the OS calendar, which is what actually raises the alarm. */
  async function addToCalendar(rows: Row[], name: string) {
    try {
      await shareOrDownload(name, 'text/calendar', toIcs(rows, now))
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : 'Could not share' })
    }
  }

  // A reinstall resets the permission, so the state has to be read on launch
  // rather than assumed — otherwise reminders quietly stop working and the app
  // is the last to know.
  useEffect(() => {
    let live = true
    void reminderPermission().then((state) => {
      if (live) setNotify(state)
    })
    return () => {
      live = false
    }
  }, [])

  async function allowReminders() {
    setNotify((await requestPermission()) ? 'granted' : 'denied')
  }

  // Re-armed on every launch as well as on a change, because a reinstall drops
  // the OS alarms while `localStorage` keeps saying the prompts are on.
  useEffect(() => {
    void scheduleNudges(nudges).catch(() => {
      // A prompt that could not be armed is not worth an error on screen.
    })
  }, [nudges])

  // Re-arms reminders on launch, so an event logged on the web still fires on
  // the phone, and a reinstall does not lose the lot. No-op away from native.
  useEffect(() => {
    void fetchAll()
      .then((all) => {
        setHistory(all)
        return sync(all, new Date())
      })
      .catch(() => {
        // A reminder that could not be re-armed is not worth an error on screen.
      })
  }, [fetchAll])

  const recalled = useMemo(
    () => (history === null ? [] : onThisDay(history, day)),
    [history, day],
  )

  /**
   * What the phone is going to raise, read from this device's log rather than
   * from the launch fetch the memories use. The distinction matters in one
   * direction only: a memory of an earlier year cannot be made stale by
   * anything typed today, but what is *coming* very much can — set up a standup
   * and the bell went on listing what was true when the app opened, which is
   * the one question it exists to answer. Costs no query either way.
   *
   * Cheap enough to recompute on the clock tick, which is what keeps "today"
   * and "tomorrow" honest as the evening wears on.
   */
  const upcoming = useMemo(() => ahead(all, now), [all, now])

  function submit(parsed: ParsedEntry) {
    const row = add(parsed)
    // Answers are computed from a cached copy of the log, so a new entry has to
    // invalidate it or the next question quietly ignores what was just added.
    setCorpus(null)
    // The real clock, for the same reason QuickAdd re-parses against it: a
    // reminder compared with a stale `now` looks overdue and is dropped.
    const current = new Date()
    setNow(current)

    const elsewhere = row.occurred_on !== day
    const where = relativeDay(row.occurred_on, current)

    // The calendar is only offered where the app cannot do it itself. Natively
    // the reminder is already scheduled, so pushing the calendar as well would
    // be asking for a step the app just took.
    const calendar =
      !isNative() && row.kind === 'event'
        ? { label: 'Add to calendar', run: () => void addToCalendar([row], 'lifelog-event.ics') }
        : undefined

    setToast({
      text: elsewhere
        ? `Saved to ${where}`
        : `Added ${[row.title, rowValue(row)].filter(Boolean).join(' · ')}`,
      action:
        calendar ??
        (elsewhere ? { label: 'View', run: () => setDay(row.occurred_on) } : undefined),
    })

    // Inside the submit gesture, which is where a permission prompt is allowed.
    // A blocked reminder has to say so: silence here is why nothing fired.
    void scheduleReminder(row, current).then((result) => {
      if (result === 'scheduled') {
        const at = row.occurred_at === null ? `9am ${where}` : clock(row.occurred_at)
        setToast({ text: `Reminder set for ${at}` })
      } else if (result === 'blocked') {
        setNotify('denied')
        setToast({ text: 'Saved, but reminders are blocked' })
      }
    })
      // Without this the promise rejects into nothing: a plugin that throws
      // looked exactly like a reminder that worked.
      .catch((failure: unknown) => {
        setToast({
          text: `Reminder failed: ${failure instanceof Error ? failure.message : String(failure)}`,
        })
      })
  }

  function deleteRow(row: Row) {
    remove(row)
    void cancelReminder(row)
    setEditing(null)
    setToast({ text: 'Entry deleted', action: { label: 'Undo', run: () => restore(row) } })
  }

  async function exportJson() {
    try {
      const all = await fetchAll()
      // A download, not a share: a backup belongs on disk, not in a share sheet.
      download(`lifelog-${dayKey(new Date())}.json`, 'application/json', JSON.stringify(all, null, 2))
      setProfileOpen(false)
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : 'Export failed' })
    }
  }

  async function exportCalendar() {
    try {
      const all = await fetchAll()
      const wanted = forCalendar(all, now)
      if (wanted.length === 0) {
        setToast({ text: 'No upcoming events to export' })
        return
      }
      setProfileOpen(false)
      await addToCalendar(wanted, 'lifelog.ics')
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : 'Export failed' })
    }
  }

  const pick = (picked: string) => {
    setDay(picked)
    setCalendarOpen(false)
  }

  return (
    // The columns are sized, then centred as a pair — otherwise capping the
    // timeline just moves the empty space to the right edge of a 1440px screen.
    // Safe-area padding, not decoration: Android draws the WebView edge-to-edge
    // from targetSdk 35, and an installed iOS PWA has no browser chrome either,
    // so without this the day header sits underneath the status bar.
    <div className="mx-auto grid min-h-dvh w-full max-w-6xl grid-cols-1 gap-10 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] lg:grid-cols-[17rem_minmax(0,42rem)] lg:justify-center lg:px-8 lg:pt-8">
      {/* The only h1. The sidebar wordmark below is hidden on compact, where
          display:none would take the page's heading with it. */}
      <h1 className="sr-only">lifelog</h1>

      {/* Wide screens get the calendar permanently: navigation at zero taps.
          Narrow screens reach the same component through the header button. */}
      <aside className="hidden lg:block">
        <p className="mb-5 text-sm font-semibold tracking-wide">lifelog</p>
        <MonthGrid day={day} now={now} loadDays={fetchDays} onPick={setDay} />

        {/* Fills the space with something that removes interactions rather than
            adding them. Keys only, no controls. */}
        <dl className="mt-8 space-y-1.5 border-t border-line pt-5 text-xs text-faint">
          {[
            ['esc', 'leave the box'],
            ['← →', 'previous / next day'],
            ['t', 'jump to today'],
            ['/', 'back to the box'],
          ].map(([key, what]) => (
            <div key={key} className="flex items-baseline gap-3">
              <dt className="w-12 shrink-0 font-medium text-muted">{key}</dt>
              <dd className="min-w-0">{what}</dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="mt-8 flex h-11 w-full items-center gap-2 text-xs text-muted"
        >
          <PersonIcon size={16} />
          <span className="min-w-0 truncate">{email}</span>
        </button>
      </aside>

      {/* Capped: across 900px the eye cannot connect a title on the left to its
          amount on the right. A reading measure, not the whole column. */}
      <main {...swipe} className="swipe-area mx-auto flex w-full min-w-0 max-w-2xl flex-col">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <DayHeader
              day={day}
              now={now}
              onChange={setDay}
              onOpenCalendar={() => setCalendarOpen(true)}
            />
          </div>
          {/* Only when there is something to show: a bell that is always
              empty is a control that teaches you to ignore it. */}
          {upcoming.length > 0 && (
            <button
              type="button"
              aria-label={`What is coming — ${upcoming.length} ${
                upcoming.length === 1 ? 'reminder' : 'reminders'
              }`}
              onClick={() => setAheadOpen(true)}
              className="-mr-1 flex h-11 shrink-0 items-center gap-1 px-1 text-faint active:text-ink"
            >
              <BellIcon size={18} />
              <span className="text-xs tabular-nums">{upcoming.length}</span>
            </button>
          )}

          <button
            type="button"
            aria-label="Profile and settings"
            onClick={() => setProfileOpen(true)}
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-faint active:text-ink lg:hidden"
          >
            <PersonIcon size={18} />
          </button>
        </div>

        {/* Under the header, above the box: navigation, not capture, so it
            scrolls away with the day rather than sitting over it. */}
        <div className="mt-1">
          <WeekStrip day={day} now={now} loadDays={fetchDays} onPick={setDay} />
        </div>

        {/* Sticky: on a long day the capture box must never scroll out of
            reach, since capture is the whole product. */}
        <div className="sticky top-0 z-10 mt-4 bg-surface pt-1 pb-2">
          <QuickAdd
            day={day}
            now={now}
            showExamples={!loading && shown.length === 0}
            onSubmit={submit}
            corpus={corpus}
            onNeedCorpus={loadCorpus}
            prefill={prefill}
            onPrefilled={() => setPrefill(null)}
            onHelp={() => setHelpOpen(true)}
            onGoToDay={setDay}
          />
        </div>

        {/* Asked for in the app, not left to the OS: a reinstall silently
            revokes this, and a reminder that cannot fire is worse than no
            reminder because it was trusted. */}
        {notify === 'denied' && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2.5">
            <p className="min-w-0 flex-1 text-xs text-muted">
              Allow notifications, or reminders cannot reach you.
            </p>
            <button
              type="button"
              onClick={() => void allowReminders()}
              className="h-9 shrink-0 rounded-md bg-ink px-3 text-xs font-medium text-surface"
            >
              Allow
            </button>
          </div>
        )}

        {/* Offline is a state, not an error: everything still works, so it is
            said quietly and the raw fetch failure behind it is not shown. What
            does need saying is how much this device is still holding, because
            an entry that exists nowhere else is the one thing worth knowing.
            Driven by whether a request got an answer, never by
            `navigator.onLine` — on Android that reports a connection the device
            does not have. */}
        {!reachable ? (
          <p className="mt-3 text-xs text-muted">
            Offline
            {owed > 0
              ? ` · ${owed} ${owed === 1 ? 'entry' : 'entries'} saved here, waiting to sync`
              : ' · reading this device’s copy'}
          </p>
        ) : (
          error !== null && <p className="mt-3 text-xs text-expense">{error}</p>
        )}

        <div className="mt-3 flex-1" aria-busy={loading}>
          {/* Placeholders, not a spinner: the rows land where these sat, so
              nothing jumps when the fetch resolves. */}
          {loading && shown.length === 0 && (
            <div aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex items-center gap-3 border-b border-line py-4">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-line" />
                  <span className="h-3 flex-1 rounded bg-line" style={{ opacity: 1 - index * 0.3 }} />
                </div>
              ))}
            </div>
          )}

          {/* The day opened on what was already over: struck-through reminders
              keep full size and position, so the loudest thing at the top was
              frequently the part that no longer matters. Folded into one line,
              the day opens on what is still live.

              Only a *leading run* of them, so nothing is reordered — a passed
              reminder later in the day stays where it happened. And only from
              two upwards: hiding a single row behind a tap costs a row and
              saves none. `passed` is true of events alone, so nothing carrying
              money or time is ever inside the fold. */}
          {folded > 0 && (
            <button
              type="button"
              aria-expanded={showEarlier}
              onClick={() => setShowEarlier(true)}
              className="flex h-11 w-full items-center gap-3 border-b border-line text-left text-xs text-muted active:text-ink"
            >
              <span aria-hidden="true" className="flex w-5 shrink-0 justify-center text-faint">
                <Chevron dir="down" />
              </span>
              {folded} already passed
            </button>
          )}

          {shownEntries.map((row) => (
            <EntryRow
              key={row.id}
              row={row}
              now={now}
              onOpen={() => setEditing(row)}
              onRetry={retry}
            />
          ))}

          {/* Under the rows, not over them: read as a header it looked like a
              label for the box you were about to type into, when it is a
              summary of the day you have just finished reading. The last row's
              own border is the rule above it. */}
          {shown.length > 0 && (
            <p className="mt-2.5 text-xs text-muted">
              {[
                spent > 0 ? `${rupees(spent)} spent` : null,
                logged > 0 ? `${minutes(logged)} logged` : null,
                `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {/* The examples above already say the day is empty and show what to
              type. This adds only the thing they cannot: how to get elsewhere. */}
          {!loading && shown.length === 0 && (
            <p className="px-1 text-xs text-faint">Swipe sideways to move between days.</p>
          )}

          <OnThisDay found={recalled} onPick={setDay} />


          {failedElsewhere.length > 0 && (
            <div className="mt-6">
              <p className="mb-1 text-xs font-medium text-expense">Did not save</p>
              {failedElsewhere.map((row) => (
                <EntryRow
                  key={row.id}
                  row={row}
                  now={now}
                  offDay
                  onOpen={() => setDay(row.occurred_on)}
                  onRetry={retry}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {calendarOpen && (
        <MonthSheet
          day={day}
          now={now}
          loadDays={fetchDays}
          onPick={pick}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          email={email}
          theme={theme}
          onTheme={onTheme}
          onHelp={() => {
            setProfileOpen(false)
            setHelpOpen(true)
          }}
          onExport={() => void exportJson()}
          nudges={nudges}
          onNudges={chooseNudges}
          onExportCalendar={() => void exportCalendar()}
          // Forgotten here as well as on the event, because signing out with no
          // network never reaches Supabase — and an offline sign-out that does
          // not sign you out is worse than no button at all.
          onSignOut={() => {
            forget(localStorage)
            void supabase.auth.signOut()
          }}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {editing !== null && (
        <EntryEditor
          row={editing}
          onSave={(patch) => {
            update(editing, patch)
            // Re-arm against the edited values, or the old time still fires.
            const updated = { ...editing, ...patch }
            void cancelReminder(updated).then(() => scheduleReminder(updated, now))
            setEditing(null)
          }}
          onDelete={() => deleteRow(editing)}
          onAddToCalendar={() => void addToCalendar([editing], 'lifelog-event.ics')}
          onClose={() => setEditing(null)}
        />
      )}

      {aheadOpen && (
        <AheadSheet
          upcoming={upcoming}
          now={now}
          onPick={(picked) => {
            setDay(picked)
            setAheadOpen(false)
          }}
          onClose={() => setAheadOpen(false)}
        />
      )}

      {helpOpen && (
        <HelpSheet
          onPick={(text) => {
            setPrefill(text)
            setHelpOpen(false)
          }}
          onClose={() => setHelpOpen(false)}
        />
      )}

      {toast !== null && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
