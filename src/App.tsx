import { addDays, parseISO, subDays } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DayHeader } from './components/DayHeader'
import { EntryEditor } from './components/EntryEditor'
import { EntryRow } from './components/EntryRow'
import { AheadSheet } from './components/AheadSheet'
import { BottomNav, type View } from './components/BottomNav'
import { Calendar } from './components/Calendar'
import { HelpSheet } from './components/HelpSheet'
import { BellIcon, Chevron, PersonIcon } from './components/Icons'
import { Login } from './components/Login'
import { MonthGrid } from './components/MonthGrid'
import { OnThisDay } from './components/OnThisDay'
import { QuickAdd } from './components/QuickAdd'
import { Sheet } from './components/Sheet'
import { You } from './components/You'
import { Toast, type ToastState } from './components/Toast'
import { WeekStrip } from './components/WeekStrip'
import { useEntries, type Row } from './hooks/useEntries'
import { useNudges } from './hooks/useNudges'
import { useSession } from './hooks/useSession'
import { useSwipe } from './hooks/useSwipe'
import { useTheme } from './hooks/useTheme'
import { ahead } from './lib/ahead'
import { arm as armBack, onHome } from './lib/back'
import { download, shareOrDownload } from './lib/deliver'
import { passed } from './lib/events'
import { clock, dayKey, dayLabel, minutes, relativeDay, rowValue, rupees } from './lib/format'
import { byClock, onThisDay } from './lib/history'
import { forget } from './lib/identity'
import { forCalendar, toIcs } from './lib/ics'
import { isOccurrence, occurrencesOn } from './lib/occurrences'
import { isNative } from './lib/platform'
import {
  cancel as cancelReminder,
  permission as reminderPermission,
  rearm as rearmReminder,
  requestPermission,
  schedule as scheduleReminder,
  scheduleNudges,
  sync,
} from './lib/reminders'
import { supabase } from './lib/supabase'
import type { ParsedEntry } from './lib/parser'
import type { Entry } from './types'

/**
 * The bottom edge, held off the gesture bar.
 *
 * A real number and not only the inset: `env(safe-area-inset-bottom)` measures 0
 * in the Android WebView on one handset and 48px on another, and both readings
 * are real. Written once and used by whatever is *last* in the bottom block —
 * the nav when it is up, the capture control when it has stood down — so the
 * floor belongs to the thing standing on it rather than to a constant two files
 * have to keep agreeing about.
 */
const FLOOR = 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'

/** What each destination calls itself, on the screen and out loud. */
const TITLES: Record<View, string> = {
  today: 'Today',
  calendar: 'Calendar',
  ask: 'Ask',
  you: 'You',
}

/** Whatever was thrown, as something a person can read. */
function message(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

export default function App() {
  const { identity, loading, startGuest } = useSession()
  // Resolved before the auth gate, so the login screen honours the choice too.
  const { theme, choose } = useTheme()
  /** A guest who has asked to sign in. The log is still there behind this. */
  const [signingIn, setSigningIn] = useState(false)

  // Armed here rather than inside `Day`, so it covers the sign-in screen too
  // and survives a guest signing in — which unmounts and remounts `Day`.
  // Nothing happens away from native.
  useEffect(() => {
    let live = true
    let disarm: (() => void) | null = null
    void armBack().then((off) => {
      // The listener can land after this effect has already been torn down,
      // which is exactly what a StrictMode double-mount does in development.
      if (live) disarm = off
      else off()
    })
    return () => {
      live = false
      disarm?.()
    }
  }, [])

  if (loading) return <div className="p-4 text-sm text-faint">…</div>
  if (identity === null) return <Login onGuest={startGuest} />
  // No `onGuest`: this reader already has a log, and starting a second empty one
  // is not an offer, it is a way to lose the first.
  if (signingIn) return <Login onCancel={() => setSigningIn(false)} />

  return (
    <Day
      email={identity.email}
      userId={identity.id}
      local={identity.local === true}
      theme={theme}
      onTheme={choose}
      onSignIn={() => setSigningIn(true)}
    />
  )
}

type DayProps = {
  email: string
  /** Keys this device's copy of the log, so two accounts cannot see each other's. */
  userId: string
  /** No account behind the log, so nothing here may claim to be syncing. */
  local: boolean
  theme: ReturnType<typeof useTheme>['theme']
  onTheme: ReturnType<typeof useTheme>['choose']
  onSignIn: () => void
}

function Day({ email, userId, local, theme, onTheme, onSignIn }: DayProps) {
  const { nudges, choose: chooseNudges } = useNudges()
  const [now, setNow] = useState(() => new Date())
  const [day, setDay] = useState(() => dayKey(new Date()))
  const [editing, setEditing] = useState<Row | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  /**
   * Which of the four destinations is on screen.
   *
   * State, not a route: there is no router here and nothing to put in one. It
   * lives beside `day` rather than above `Day` so that switching destination
   * cannot remount `useEntries` — going to You and back must not refetch the
   * log, and must certainly not lose the day being looked at.
   *
   * On `lg` it never leaves `today`: the nav is hidden there and nothing else
   * sets it, so the wide layout is exactly what it was.
   */
  const [view, setView] = useState<View>('today')
  /**
   * Whether the capture field has anything in it.
   *
   * The nav stands down the moment it does, and that is what lets a bottom bar
   * and a five-second capture share one edge: mid-entry the control takes the
   * whole bottom edge back, so nothing has been added to the one act the app
   * exists for. Reported by `QuickAdd`, which owns the text.
   */
  const [typing, setTyping] = useState(false)
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
  } = useEntries(day, userId, local)

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

  /**
   * Away from Today, Android's back button comes home before it minimises.
   *
   * Registered only while there is somewhere to come back *from*, which is what
   * keeps the decision in `back()` rather than in a listener holding a `view`
   * that has since changed. Below the sheets, so the editor opened from the
   * calendar closes onto the calendar.
   */
  useEffect(() => {
    if (view === 'today') return
    return onHome(() => setView('today'))
  }, [view])

  /**
   * A wide screen is always on Today, and has to be *put* there rather than
   * assumed there.
   *
   * The nav is `lg:hidden`, so nothing visible on a wide screen can change the
   * destination — which is why the view never leaves Today there. What it does
   * not cover is *arriving*: a window dragged wider while on Calendar or You, or
   * a tablet rotated into the wide layout, strands the reader on a screen with
   * no nav to leave it and the sidebar's own calendar sitting beside it. Seen at
   * 1440px in the device's WebView, not reasoned about.
   *
   * Watched rather than read once, because crossing the breakpoint is the only
   * way in.
   */
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const settle = () => {
      if (wide.matches) setView('today')
    }
    settle()
    wide.addEventListener('change', settle)
    return () => wide.removeEventListener('change', settle)
  }, [])

  // Every day opens folded: unfolding one is about that day, not a preference.
  useEffect(() => setShowEarlier(false), [day])

  const sheetOpen = profileOpen || aheadOpen || editing !== null

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

  /**
   * The row as it is actually stored, for anything that writes.
   *
   * A derived occurrence carries the day it was *drawn* on, not the day the
   * repeat starts. Handing one to the editor therefore saved that day back onto
   * the row: opening Tuesday's standup and pressing Save moved the series start
   * from Monday to Tuesday, and opening a birthday logged in 2010 from this
   * year's view rewrote its year to this one — the original date gone, with
   * nothing on screen to say so. Delete and Undo went the same way, since Undo
   * restores whatever row it was handed.
   *
   * One row, one thing to edit, one thing to delete: reading is what may be
   * derived, writing is not.
   */
  const asStored = useCallback(
    (row: Row): Row => (isOccurrence(row) ? (all.find((held) => held.id === row.id) ?? row) : row),
    [all],
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

  /**
   * Re-arms an edited entry, and says so when it could not.
   *
   * Every other scheduling path reports its outcome — `reminders.ts` returns one
   * precisely because three bugs here were invisible for as long as their
   * promises rejected into nothing. The editor was the one that did not: an edit
   * that moved a reminder's time cancelled the old alarm and then failed to set
   * the new one in silence, leaving an entry on screen with a time and no alarm
   * behind it. The ordering inside the re-arm is `reminders.ts`'s problem.
   */
  function rearmRow(row: Row, at: Date) {
    void rearmReminder(row, at)
      .then((result) => {
        if (result === 'blocked') {
          setNotify('denied')
          setToast({ text: 'Saved, but reminders are blocked' })
        } else if (result === 'stale') {
          setToast({ text: 'Saved, but an old reminder may still fire' })
        }
      })
      .catch((failure: unknown) => {
        setToast({ text: `Reminder failed: ${message(failure)}` })
      })
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
        setToast({ text: `Reminder failed: ${message(failure)}` })
      })
  }

  function deleteRow(row: Row) {
    const undo = { label: 'Undo', run: () => restore(row) }
    remove(row)
    setEditing(null)
    setToast({ text: 'Entry deleted', action: undo })

    // Caught, not voided into nothing. An alarm the plugin refused to cancel is
    // going to ring for a row that is no longer on screen, which is the one
    // reminder failure nobody can explain afterwards. The warning keeps Undo on
    // it: replacing the message must not also take away the way back.
    void cancelReminder(row).catch(() => {
      setToast({ text: 'Deleted, but its reminder may still fire', action: undo })
    })
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

  /**
   * The account screen's props, shared by its two surfaces.
   *
   * A destination in the bottom nav on a phone; the same component inside a
   * `Sheet` on `lg`, where there is no nav and the sidebar is what carries the
   * account. One component and one set of props either way — the alternative
   * was two copies of this list, which is how two screens that are supposed to
   * be the same come to differ.
   */
  const youProps = {
    email,
    local,
    theme,
    onTheme,
    onSignIn,
    onHelp: () => setHelpOpen(true),
    onExport: () => void exportJson(),
    nudges,
    onNudges: chooseNudges,
    onExportCalendar: () => void exportCalendar(),
    // Forgotten here as well as on the event, because signing out with no
    // network never reaches Supabase — and an offline sign-out that does not
    // sign you out is worse than no button at all.
    onSignOut: () => {
      forget(localStorage)
      void supabase.auth.signOut()
    },
  }

  /** Picking a day in the calendar is asking to read it, so it lands on Today. */
  const pick = (picked: string) => {
    setDay(picked)
    setView('today')
  }

  return (
    // The columns are sized, then centred as a pair — otherwise capping the
    // timeline just moves the empty space to the right edge of a 1440px screen.
    // Safe-area padding, not decoration: Android draws the WebView edge-to-edge
    // from targetSdk 35, and an installed iOS PWA has no browser chrome either,
    // so without this the day header sits underneath the status bar.
    //
    // The *bottom* padding is `lg:` only, and that was found on the emulator:
    // the bottom block is sticky inside this container, so a padding here is
    // floor the block cannot reach past — the nav sat 24px above the screen
    // edge with page colour under it, which reads as a rendering fault rather
    // than as a bar. On compact the block owns the bottom edge and `FLOOR` is
    // the only thing holding it off the gesture bar.
    <div className="mx-auto grid min-h-dvh w-full max-w-6xl grid-cols-1 gap-10 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] lg:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] lg:grid-cols-[17rem_minmax(0,42rem)] lg:justify-center lg:px-8 lg:pt-8">
      {/* The only h1. The sidebar wordmark below is hidden on compact, where
          display:none would take the page's heading with it. */}
      <h1 className="sr-only">lifelog</h1>

      {/* Wide screens get the calendar permanently: navigation at zero taps.
          Narrow screens reach the same component through the header button. */}
      <aside className="hidden lg:flex lg:flex-col">
        <p className="mb-6 text-[0.8125rem] font-semibold tracking-[0.02em] text-muted">lifelog</p>
        <MonthGrid day={day} now={now} loadDays={fetchDays} onPick={setDay} />

        {/* Fills the space with something that removes interactions rather than
            adding them. Keys only, no controls. */}
        <dl className="mt-8 space-y-2 border-t border-line pt-5 text-xs text-faint">
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

        {/* Pushed to the foot of the column: an account is the least of what
            this screen is for, and it is where the eye leaves rather than
            where it lands. */}
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="-mx-2 mt-auto flex h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 text-xs text-faint transition-colors hover:text-ink"
        >
          <PersonIcon size={16} className="shrink-0" />
          {/* A guest has no address, and an icon with an empty span beside it is
              a button with no name — to a screen reader and to the eye alike. */}
          <span className="min-w-0 truncate">{local ? 'Guest' : email}</span>
        </button>
      </aside>

      {/* Capped: across 900px the eye cannot connect a title on the left to its
          amount on the right. A reading measure, not the whole column. */}
      <main {...(view === 'today' ? swipe : {})} className="swipe-area mx-auto flex w-full min-w-0 max-w-2xl flex-col">
        {/* The day's own header belongs to the day. The other three name
            themselves at the same size, because whatever the screen is about is
            the one thing on it allowed to be big. */}
        {view === 'today' ? (
          <>
            {/* The quiet row that used to sit here — the wordmark and a 20px
                account glyph — is what paid for the bar along the bottom. It
                named the app on a screen nobody reaches without opening the app,
                and it hid the account in the least looked-at corner there is.
                Both of those are the nav's now, and the day header is the first
                thing on the screen. */}
            <DayHeader
              day={day}
              now={now}
              onChange={setDay}
              onOpenCalendar={() => setView('calendar')}
              actions={
                // Only when there is something to show: a bell that is always
                // empty is a control that teaches you to ignore it.
                upcoming.length > 0 ? (
                  <button
                    type="button"
                    aria-label={`What is coming — ${upcoming.length} ${
                      upcoming.length === 1 ? 'reminder' : 'reminders'
                    }`}
                    onClick={() => setAheadOpen(true)}
                    className="mr-0.5 flex h-11 shrink-0 items-center gap-1 rounded-lg px-1.5 text-faint transition-colors hover:text-ink active:text-ink"
                  >
                    <BellIcon size={17} />
                    <span className="text-xs tabular-nums">{upcoming.length}</span>
                  </button>
                ) : null
              }
            />

            {/* Under the header, above the box: navigation, not capture, so it
                scrolls away with the day rather than sitting over it. */}
            <div className="mt-3">
              <WeekStrip day={day} now={now} loadDays={fetchDays} onPick={setDay} />
            </div>
          </>
        ) : (
          // An eyebrow, not a headline: the nav already says which destination
          // is live, and each of these screens has something of its own that
          // deserves the size — the month's spend, an answer's number, the name
          // on the account. Two big things on one screen is one too many.
          <h2 className="text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase">
            {TITLES[view]}
          </h2>
        )}

        {/* The bottom block: the toast, then the capture control — in flow, in
            that order, with nothing fixed.

            Docked to the thumb on a phone, kept at the top on a wide screen.

            Capture is the whole product, so the control must never scroll out of
            reach — sticky either way. What changed is *which* edge: on a 6.4in
            phone the top third is the hardest place to reach one-handed, and
            this is the control the app exists for. It is also where the keyboard
            comes from, so docked it rises with the keyboard instead of leaving a
            gap between the two.

            One render site and no `MobileQuickAdd`: `main` is a flex column, so
            the order swaps in CSS. QuickAdd reverses its own two halves the same
            way, which keeps the answer and the examples *above* the field rather
            than off the bottom of the screen. On `lg` there is no reach problem
            and the reading order is top-down, so nothing moves.

            `pb` is a real number, not only the inset: `env(safe-area-inset-bottom)`
            measures 0 in the Android WebView while the gesture bar is about 24px,
            so an inset-only floor puts the send button underneath it.

            The toast lives *here* rather than fixed to the viewport, and that is
            what retired `--dock`. A message over the control is not a cosmetic
            overlap — `Undo` and `Save` sat on top of each other once and the tap
            hit the wrong one — and the answer was a constant in `index.css` that
            the toast subtracted from the bottom edge. Every change to this block
            had to remember to change that number too, and it was wrong by two
            paddings the first time. As siblings, clearing each other is not
            something either of them has to do. */}
        <div className="order-last mt-4 sticky bottom-0 z-10 bg-surface pt-2 lg:order-none lg:bottom-auto lg:top-0 lg:pt-1 lg:pb-2">
          {/* First in the block, so it is a sibling *above* the control rather
              than a fixed layer over it. See `Toast` and `index.css`. */}
          {toast !== null && <Toast toast={toast} onDismiss={() => setToast(null)} />}

          {/* Absent on You alone: that screen is about the account, and a
              capture box under it would be an invitation to log the settings.
              The floor moves onto the control whenever the nav is not there to
              hold it — on `lg` the block is at the top and neither does. */}
          {view !== 'you' && (
            <div className={typing ? `${FLOOR} lg:pb-0` : undefined}>
              <QuickAdd
                day={day}
                now={now}
                ask={view === 'ask'}
                onLeaveAsk={() => setView('today')}
                onTyping={setTyping}
                showExamples={view === 'today' && !loading && shown.length === 0}
                onSubmit={submit}
                corpus={corpus}
                onNeedCorpus={loadCorpus}
                prefill={prefill}
                onPrefilled={() => setPrefill(null)}
                onHelp={() => setHelpOpen(true)}
                onGoToDay={setDay}
              />
            </div>
          )}

          {/* Last in the block, so it carries the floor and its own background
              reaches the bottom edge — a bar floating a centimetre above the
              gesture bar reads as a rendering fault. */}
          {!typing && <BottomNav view={view} onGo={setView} className={FLOOR} />}
        </div>

        {view === 'today' && (
          <>
            {/* Asked for in the app, not left to the OS: a reinstall silently
                revokes this, and a reminder that cannot fire is worse than no
                reminder because it was trusted. */}
            {notify === 'denied' && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-sunken px-3.5 py-2.5">
                <p className="min-w-0 flex-1 text-xs text-muted">
                  Allow notifications, or reminders cannot reach you.
                </p>
                {/* 44px like everything else. It was 36 to keep the banner short,
                    which is the one trade this app does not make — and it is the
                    only control on the screen the *native* app actually depends on,
                    since nothing rings without it. Negative margins keep the banner
                    the height it was. */}
                <button
                  type="button"
                  onClick={() => void allowReminders()}
                  className="-my-1 flex h-11 shrink-0 items-center rounded-lg bg-ink px-3.5 text-xs font-medium text-surface transition-opacity hover:opacity-90"
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
              <p className="mt-4 text-xs text-faint">
                Offline
                {owed > 0
                  ? ` · ${owed} ${owed === 1 ? 'entry' : 'entries'} saved here, waiting to sync`
                  : ' · reading this device’s copy'}
              </p>
            ) : (
              error !== null && <p className="mt-4 text-xs text-expense">{error}</p>
            )}

            <div className="mt-4 flex-1" aria-busy={loading}>
              {/* Placeholders, not a spinner: the rows land where these sat, so
                  nothing jumps when the fetch resolves. */}
              {loading && shown.length === 0 && (
                <div aria-hidden="true">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="flex items-center gap-3 border-b border-line py-4">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-line" />
                      <span
                        className="h-3 flex-1 rounded bg-line"
                        style={{ opacity: 1 - index * 0.3 }}
                      />
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
                  className="-mx-2 flex h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-lg border-b border-line px-2 text-left text-xs text-muted transition-colors hover:bg-sunken active:bg-sunken"
                >
                  <span aria-hidden="true" className="flex w-5 shrink-0 justify-center text-faint">
                    <Chevron dir="down" size={16} />
                  </span>
                  {folded} already passed
                </button>
              )}

              {shownEntries.map((row) => (
                <EntryRow
                  key={row.id}
                  row={row}
                  now={now}
                  onOpen={() => setEditing(asStored(row))}
                  onRetry={retry}
                />
              ))}

              {/* Under the rows, not over them: read as a header it looked like a
                  label for the box you were about to type into, when it is a
                  summary of the day you have just finished reading. The last row's
                  own border is the rule above it. */}
              {/* The figures lead and their names sit back, the same way an answer's
                  extras read — as values with labels attached rather than as a
                  sentence. Flat 12px muted, this line was the quietest thing on the
                  screen while carrying the only number that sums the day: smaller
                  than the per-row amounts it totals, which is exactly backwards. The
                  count stays quiet, because it names the list rather than measuring
                  it. */}
              {shown.length > 0 && (
                <p className="mt-3.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-faint">
                  {/* Not `> 0`: a day whose only money is a refund has a total, and
                      hiding it says the day carried none at all. */}
                  {spent !== 0 && (
                    <span>
                      <span className="text-sm font-medium text-ink tabular-nums">{rupees(spent)}</span>{' '}
                      spent
                    </span>
                  )}
                  {logged > 0 && (
                    <span>
                      <span className="text-sm font-medium text-ink tabular-nums">
                        {minutes(logged)}
                      </span>{' '}
                      logged
                    </span>
                  )}
                  <span className="text-faint tabular-nums">
                    {shown.length} {shown.length === 1 ? 'entry' : 'entries'}
                  </span>
                </p>
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
          </>
        )}

        {/* Picking a day is asking to read it, so it lands on Today — the
            calendar is navigation and never a place to stay. */}
        {view === 'calendar' && (
          <div className="mt-4 flex-1">
            <Calendar day={day} now={now} all={all} loadDays={fetchDays} onPick={pick} />
          </div>
        )}

        {/* Nothing of its own: the answer and the suggestions are drawn by the
            capture control, above the field, which on a phone is the block along
            the bottom edge. This is what keeps the block pushed down to it. */}
        {view === 'ask' && <div className="flex-1" />}

        {view === 'you' && (
          <div className="mt-4 flex-1">
            <You {...youProps} />
          </div>
        )}
      </main>

      {/* `lg` has no nav to hold a destination, and the sidebar is where the
          account already lives — so on a wide screen the same component is a
          sheet opened from there. One component, two surfaces; there is no
          `ProfileSheet` any more, because it was only ever this. */}
      {profileOpen && (
        <Sheet label="Profile and settings" onClose={() => setProfileOpen(false)}>
          <You {...youProps} />
        </Sheet>
      )}

      {editing !== null && (
        <EntryEditor
          row={editing}
          now={now}
          onSave={(patch) => {
            update(editing, patch)
            // Re-arm against the edited values, or the old time still fires.
            // Against the real clock, not the state one: `now` is refreshed on a
            // 30-second tick, and `alarms` drops anything already due.
            rearmRow({ ...editing, ...patch }, new Date())
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
    </div>
  )
}
