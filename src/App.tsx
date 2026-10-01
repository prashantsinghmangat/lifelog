import { addDays, parseISO, subDays } from 'date-fns'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DayHeader } from './components/DayHeader'
import { EntryEditor } from './components/EntryEditor'
import { EntryRow } from './components/EntryRow'
import { AheadSheet } from './components/AheadSheet'
import { BottomNav, type View } from './components/BottomNav'
import { Calendar } from './components/Calendar'
import { HelpSheet } from './components/HelpSheet'
import { BellIcon, Chevron, InfoIcon, NoteIcon, PersonIcon, SearchIcon } from './components/Icons'
import { Login } from './components/Login'
import { MonthGrid } from './components/MonthGrid'
import { OnThisDay } from './components/OnThisDay'
import { PhotoViewer } from './components/PhotoViewer'
import { AskTopics, QuickAdd } from './components/QuickAdd'
import { Sheet } from './components/Sheet'
import { You } from './components/You'
import { Toast, type ToastState } from './components/Toast'
import { WeekStrip } from './components/WeekStrip'
import { photosOf, usePhotoThumbnails, type Photo } from './hooks/useAttachments'
import { useEntries, type Row } from './hooks/useEntries'
import { useNudges } from './hooks/useNudges'
import { useSession } from './hooks/useSession'
import { useSwipe } from './hooks/useSwipe'
import { useTheme } from './hooks/useTheme'
import { ahead } from './lib/ahead'
import { sweepOrphans } from './lib/attachments'
import { arm as armBack, onHome } from './lib/back'
import { save, shareOrDownload } from './lib/deliver'
import { nextFireAt, passed, stillAhead } from './lib/events'
import {
  clock,
  clockAt,
  dayKey,
  dayLabel,
  minutes,
  relativeDay,
  rowValue,
  rupees,
} from './lib/format'
import { light, medium } from './lib/haptics'
import { byClock, onThisDay } from './lib/history'
import { forget } from './lib/identity'
import { forCalendar, toIcs } from './lib/ics'
import { isOccurrence, occurrencesOn } from './lib/occurrences'
import { isNative } from './lib/platform'
import {
  alarmIds,
  cancel as cancelReminder,
  cancelFollowUps,
  onAction,
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

/**
 * The cut in Today's spine at the current time: a 9px accent dot in a 4px
 * accent glow on the line, a rule fading to the right, and the moment as an
 * accent eyebrow. Entries above it have happened; entries below are coming.
 * It renders from the same `now` the 30-second tick refreshes — placing it is
 * `Day`'s job (see `markerAt`), and it holds no state and no timer of its own.
 */
function NowMarker({ now }: { now: Date }) {
  return (
    <div className="flex h-9 items-center gap-3">
      <span aria-hidden="true" className="relative flex w-7 shrink-0 justify-center">
        <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-accent/25">
          <span className="h-[9px] w-[9px] rounded-full bg-accent" />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="h-px min-w-0 flex-1 bg-linear-to-r from-accent/40 to-transparent"
      />
      <span className="shrink-0 text-[0.6875rem] font-semibold tracking-[0.1em] text-accent uppercase tabular-nums">
        Now · {clockAt(now)}
      </span>
    </div>
  )
}

export default function App() {
  const { identity, loading, startGuest } = useSession()
  // Resolved before the auth gate, so the login screen honours the choice too.
  const { theme, choose, palette, choosePalette, resolved } = useTheme()
  /** A guest who has *asked* to sign in. The log is still there behind this. */
  const [asked, setAsked] = useState(false)

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

  /**
   * Still a guest, and still asking. **Both**, because the second half was
   * missing and it locked people out of their own account.
   *
   * Asking was a flag with one way down: Cancel. A sign-in that *worked* left
   * it set, so the screen stayed exactly where it was — over an app that was by
   * then signed in, with the session stored and the identity swapped. No error,
   * no progress, nothing to act on. The reader is looking at a password box
   * that just accepted their password and is still a password box, so the only
   * reading available is that it silently failed.
   *
   * Derived rather than cleared, so the stuck state cannot be represented: the
   * question is whether there is still a guest here to sign in, and the moment
   * `identity` stops being local the screen has nothing left to ask for and
   * falls away on its own.
   */
  // No `onGuest`: this reader already has a log, and starting a second empty one
  // is not an offer, it is a way to lose the first.
  if (asked && identity.local === true) return <Login onCancel={() => setAsked(false)} />

  return (
    <Day
      email={identity.email}
      userId={identity.id}
      local={identity.local === true}
      theme={theme}
      onTheme={choose}
      palette={palette}
      onPalette={choosePalette}
      resolved={resolved}
      onSignIn={() => setAsked(true)}
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
  palette: ReturnType<typeof useTheme>['palette']
  onPalette: ReturnType<typeof useTheme>['choosePalette']
  resolved: ReturnType<typeof useTheme>['resolved']
  onSignIn: () => void
}

function Day({ email, userId, local, theme, onTheme, palette, onPalette, resolved, onSignIn }: DayProps) {
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
  const [profileOpen, setProfileOpen] = useState(false)
  /**
   * Whether the capture field holds anything, reported by `QuickAdd` — the Ask
   * destination's own empty state lives in the page body and stands down the
   * moment a question is being typed, so the suggestions never sit under a
   * result.
   */
  const [askFilled, setAskFilled] = useState(false)
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

  // Every sheet, not most of them. `helpOpen` was missing, so `/` and `n` moved
  // focus to the capture box *behind* the manual's scrim — invisible, with the
  // sheet still on screen and everything typed going somewhere unseen — while
  // the arrows changed the day underneath it.
  const sheetOpen = profileOpen || aheadOpen || helpOpen || editing !== null

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

  /**
   * Where the now marker cuts the spine: before the first row whose own
   * moment is still ahead — the same comparison `passed()` makes, without its
   * kind gate (see `stillAhead`). Entries above have happened, entries below
   * are coming. Absent on any day that is not today, never parked at an edge;
   * after the last row when everything today has been. Recomputed on the
   * existing 30-second tick because `now` is, with no timer of its own — the
   * same reason `until` has none.
   */
  const cut =
    day === dayKey(now) && shown.length > 0
      ? (() => {
          const at = shown.findIndex((row) => stillAhead(row, now))
          return at === -1 ? shown.length : at
        })()
      : null
  // The fold holds only passed reminders, so the cut is never inside it.
  const markerAt = cut === null ? null : Math.max(0, cut - folded)

  // One batched attachment lookup for every row on screen, never one
  // IndexedDB read per `EntryRow`.
  const visiblePhotoIds = useMemo(
    () => [...shownEntries, ...failedElsewhere].map((row) => row.id),
    [shownEntries, failedElsewhere],
  )
  const photoThumbnails = usePhotoThumbnails(visiblePhotoIds)
  /**
   * A row's photos opened full-size, which is a different act from opening the
   * row. The whole set, not the one thumbnail the row drew: `+2` says there are
   * others and they have to be reachable.
   *
   * These URLs are minted by `photosOf` for this viewer alone, so closing it
   * revokes them — the row's own thumbnail URL belongs to `usePhotoThumbnails`
   * and is not among them.
   */
  const [viewingPhotos, setViewingPhotos] = useState<Photo[] | null>(null)

  function closePhotos() {
    for (const photo of viewingPhotos ?? []) URL.revokeObjectURL(photo.url)
    setViewingPhotos(null)
  }

  function openPhotos(entryId: string) {
    void photosOf(entryId).then((found) => {
      if (found.length > 0) setViewingPhotos(found)
    })
  }

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

  function allowReminders() {
    // The one reminder path with no outcome. `requestPermission` can reject —
    // it is a native call like every other — and the rejection went nowhere:
    // the banner stayed, nothing was said, and the press read as a button that
    // simply does not work.
    void requestPermission()
      .then((granted) => setNotify(granted ? 'granted' : 'denied'))
      .catch((failure: unknown) => {
        setToast({ text: `Could not ask for permission: ${message(failure)}` })
      })
  }

  // Re-armed on every launch as well as on a change, because a reinstall drops
  // the OS alarms while `localStorage` keeps saying the prompts are on.
  useEffect(() => {
    void scheduleNudges(nudges).catch(() => {
      // A prompt that could not be armed is not worth an error on screen.
    })
  }, [nudges])

  /**
   * A notification's button press, delivered whether or not the app is on
   * screen — Capacitor wakes it briefly in the background. `done` rides the
   * exact path the editor's Mark done uses (the write, then the re-arm whose
   * resulting state cancels every remaining alarm, follow-ups included);
   * `got_it` is pure alarm cancellation and touches no row state, which is
   * what keeps a repeat's future occurrences ringing.
   */
  function nagAction(action: 'done' | 'got_it', id: number) {
    const row = all.find((entry) => alarmIds(entry).includes(id))
    if (row === undefined) return
    if (action === 'got_it') {
      void cancelFollowUps(row).catch(() => {
        // A follow-up that could not be cancelled will still be dismissed by
        // the next launch's reconciliation.
      })
      return
    }
    const ticked = { ...row, data: { ...row.data, done: true } }
    update(row, { data: ticked.data })
    rearmRow(ticked, new Date())
  }

  // Registered once; the ref keeps the handler current, or the listener would
  // close over the log as it stood at launch and mark done against stale rows.
  const nagRef = useRef(nagAction)
  useEffect(() => {
    nagRef.current = nagAction
  })
  useEffect(() => {
    void onAction((action, id) => nagRef.current(action, id)).catch(() => {
      // No listener means no buttons work, but every reminder still rings.
    })
  }, [])

  // Re-arms reminders on launch, so an event logged on the web still fires on
  // the phone, and a reinstall does not lose the lot. No-op away from native.
  useEffect(() => {
    void fetchAll()
      .then((all) => {
        setHistory(all)
        // Only from a load that actually completed — never from `.catch`
        // below, so a network hiccup can never read as "every entry gone"
        // and sweep away photos that are still owed a real reconnect.
        void sweepOrphans(all.map((row) => row.id)).catch(() => {
          // Storage that can't be swept this launch gets another chance next one.
        })
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

  /** Returns the saved row, which is what a staged photo has been waiting for. */
  function submit(parsed: ParsedEntry): Row {
    const row = add(parsed)
    void light()
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
        // The moment that was armed, not the date on the row. A yearly repeat
        // is armed for its *next* occurrence, so `deepak birthday 13 feb 2010`
        // was answered with "Reminder set for 9am 13 Feb 2010" — a confident,
        // checkable, false statement about a notification. `nextFireAt` is the
        // one place a day becomes a moment, and the editor already says it
        // this way.
        const fires = nextFireAt(row, current)
        const at =
          fires === null
            ? row.occurred_at === null
              ? `9am ${where}`
              : clock(row.occurred_at)
            : `${clockAt(fires)} ${relativeDay(dayKey(fires), current)}`
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

    return row
  }

  /**
   * `label: item, item, ...` saved as one gesture — see `parseMulti`. Each row
   * is added exactly as `submit` would add it alone, but the toast has to
   * speak for the whole batch at once: a save has never offered Undo, so this
   * does not invent one just because there are several, and reminders are
   * armed silently rather than narrated one at a time, which a single toast
   * could only ever show the last of anyway. A problem across the batch still
   * gets said — silence stays reserved for the case where nothing went wrong.
   */
  function submitMany(parsedList: ParsedEntry[]): Row[] {
    const rows = parsedList.map((parsed) => add(parsed))
    void light()
    setCorpus(null)
    const current = new Date()
    setNow(current)

    const total = rows.reduce((sum, row) => sum + (row.amount_paise ?? 0), 0)
    const events = rows.filter((row) => row.kind === 'event')
    const calendar =
      !isNative() && events.length > 0
        ? { label: 'Add to calendar', run: () => void addToCalendar(events, 'lifelog-events.ics') }
        : undefined

    setToast({
      text: `${rows.length} entries saved${total > 0 ? ` · ${rupees(total)}` : ''}`,
      action: calendar,
    })

    // One combined outcome for the whole batch, not one attempt per row: a
    // toast can only show the last of several anyway, and reporting each
    // failure alongside the save that already succeeded would say less than
    // a single sentence naming the worst thing that happened.
    void Promise.all(
      rows.map((row) =>
        scheduleReminder(row, current)
          .then((result) => result)
          .catch((failure: unknown) => ({ failed: message(failure) })),
      ),
    ).then((results) => {
      const failed = results.find((result) => typeof result === 'object')
      if (failed !== undefined) {
        setToast({ text: `Saved, but a reminder failed: ${failed.failed}` })
      } else if (results.includes('blocked')) {
        setNotify('denied')
        setToast({ text: 'Saved, but some reminders are blocked' })
      }
    })

    return rows
  }

  function deleteRow(row: Row) {
    // Undo has to put the alarm back as well as the row. The delete cancels
    // every id this entry owns, and `restore` only rewrites the log — so a
    // 5pm reminder deleted at 4:55 and undone at 4:56 came back onto the
    // timeline, still saying 5:00 pm, with nothing armed until the next
    // launch. That is the silent reminder this app treats as its worst
    // failure, produced by the button that exists to undo a mistake.
    //
    // `rearm` cancels before scheduling and is idempotent, so running it over
    // an entry whose alarms are already gone is exactly the no-op it looks
    // like — and it covers the race where the delete's own cancel is still in
    // flight when Undo is pressed.
    const undo = {
      label: 'Undo',
      run: () => {
        restore(row)
        rearmRow(row, new Date())
        void light()
      },
    }
    void medium()
    remove(row)
    // Closing is the Delete button's own job now, through `requestClose`,
    // called right after this returns.
    setToast({ text: 'Entry deleted', action: undo })

    // Caught, not voided into nothing. An alarm the plugin refused to cancel is
    // going to ring for a row that is no longer on screen, which is the one
    // reminder failure nobody can explain afterwards. The warning keeps Undo on
    // it: replacing the message must not also take away the way back.
    void cancelReminder(row).catch(() => {
      setToast({ text: 'Deleted, but its reminder may still fire', action: undo })
    })
  }

  /**
   * The only manual backup there is, and on a phone it did nothing at all.
   *
   * It went through a blob `<a download>`, which an Android WebView swallows —
   * no file, no error, no toast. `save` gives native its own route, and the
   * outcome is reported either way: an export that silently does not export is
   * the worst thing this button could be, because the whole point of it is
   * having a copy when the device is gone.
   */
  async function exportJson() {
    try {
      const all = await fetchAll()
      const where = await save(
        `lifelog-${dayKey(new Date())}.json`,
        'application/json',
        JSON.stringify(all, null, 2),
      )
      setProfileOpen(false)
      if (where !== 'cancelled') {
        setToast({ text: `${all.length} ${all.length === 1 ? 'entry' : 'entries'} exported` })
      }
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
    palette,
    onPalette,
    resolved,
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

  /**
   * Tapping a row in an answer opens that row.
   *
   * It used to set the day and clear the question, and nothing else — so the
   * screen stayed on Ask, the box emptied, and the day changed underneath a
   * view that was not showing it. Every report of this was the same: "it just
   * cleared my search". The entry you aimed at is what you get, on the day it
   * lives on, with Today behind it so closing the editor leaves you there.
   *
   * `asStored` first, because an answer can carry a derived occurrence of a
   * repeat and nothing that writes may ever be handed one.
   */
  const openFromAnswer = (row: Entry) => {
    setDay(row.occurred_on)
    setView('today')
    setEditing(asStored(row as Row))
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
        {/* The mock's top chrome (020), compact only — `lg` keeps the
            sidebar. Both controls are wired: search opens Ask, the one place
            the log answers from; the avatar opens You. `order-first` keeps it
            above the box when Ask dissolves the bottom block. */}
        <div className="order-first flex h-12 items-center justify-between lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <NoteIcon size={20} className="shrink-0 text-accent" />
            <span className="truncate text-[17px] font-semibold tracking-tight text-ink">
              {TITLES[view]}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Search your log in Ask"
              onClick={() => setView('ask')}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
            >
              <SearchIcon size={20} />
            </button>
            <button
              type="button"
              aria-label="Account and settings"
              onClick={() => setView('you')}
              className="-mr-1.5 flex h-11 w-11 items-center justify-center"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-surface">
                <PersonIcon size={16} />
              </span>
            </button>
          </div>
        </div>

        {/* The day's own header belongs to the day. The other three name
            themselves at the same size, because whatever the screen is about is
            the one thing on it allowed to be big. */}
        {view === 'today' ? (
          <>
            {/* The quiet row the nav once retired came back as the chrome
                above (020) — but wired this time: search and the avatar are
                second routes to Ask and You, not a wordmark hiding the
                account. The day header is still the first thing that is
                *about* the day. */}
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
          <h2 className="text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
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
        {/* On Ask the block dissolves (`display: contents`) so its children
            order themselves as the mock lays the screen: the box first at the
            top, the nav alone on the floor — still one render site, and no
            height constant anywhere, which is the `--dock` lesson. On every
            other view it stays the one sticky bottom unit it has always
            been. */}
        <div
          className={
            view === 'ask'
              ? 'contents'
              : 'order-last mt-4 sticky bottom-0 z-10 bg-surface pt-2 lg:order-none lg:bottom-auto lg:top-0 lg:pt-1 lg:pb-2'
          }
        >
          {/* First in the block, so it is a sibling *above* the control rather
              than a fixed layer over it. See `Toast` and `index.css`. */}
          {/* Always mounted, message or not: `Toast` is a live region, and a
              live region added in the same commit as its text is one a screen
              reader routinely never reads out. It occupies nothing when empty. */}
          <div className={view === 'ask' ? 'order-first' : ''}>
            <Toast toast={toast} onDismiss={() => setToast(null)} />
          </div>

          {/* Absent on You alone: that screen is about the account, and a
              capture box under it would be an invitation to log the settings.
              The floor moves onto the control whenever the nav is not there to
              hold it — on `lg` the block is at the top and neither does. */}
          {view !== 'you' && (
            <div
              className={
                view === 'ask' ? 'order-first sticky top-0 z-10 bg-surface pt-2 pb-1' : ''
              }
            >
              <QuickAdd
                day={day}
                now={now}
                ask={view === 'ask'}
                onLeaveAsk={() => setView('today')}
                showExamples={view === 'today' && !loading && shown.length === 0}
                firstEver={local && all.length === 0}
                onSubmit={submit}
                onSubmitMulti={submitMany}
                corpus={corpus}
                onNeedCorpus={loadCorpus}
                prefill={prefill}
                onPrefilled={() => setPrefill(null)}
                onHelp={() => setHelpOpen(true)}
                onOpenEntry={openFromAnswer}
                onFilled={setAskFilled}
              />
            </div>
          )}

          {/* Last in the block, so it carries the floor and its own background
              reaches the bottom edge — a bar floating a centimetre above the
              gesture bar reads as a rendering fault.

              It used to stand down the moment the box had any text in it, and
              that cost more than it bought. Logging a line made the bar vanish
              and come back on every entry, which reads as the page flinching;
              and in Ask it was worse than cosmetic — typing a question removed
              the only thing on screen saying which destination you were on, and
              the only way off it, so an answer left you stranded with no way
              out but clearing the box. The bar is 60px and it is the app's
              only navigation: it stays. */}
          <BottomNav
            view={view}
            onGo={setView}
            className={
              view === 'ask' ? `order-last mt-4 sticky bottom-0 z-10 bg-surface pt-2 ${FLOOR}` : FLOOR
            }
          />
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
                  onClick={allowReminders}
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
              {/* The spine: the day as one line, in order — the documented
                  exception in DESIGN §5. It spans the fold and the rows (the
                  fold is part of the day, so the line runs through it) and
                  fades over its last 18% so it never collides with the totals
                  below. Positioned first in the wrapper, so the rows' own
                  positioned nodes paint over it. */}
              <div className="relative">
                {shown.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-[14px] w-px bg-linear-to-b from-line via-line via-[82%] to-transparent"
                  />
                )}

                {/* The day opened on what was already over: struck-through
                    reminders keep full size and position, so the loudest thing
                    at the top was frequently the part that no longer matters.
                    Folded into one line, the day opens on what is still live.

                    Only a *leading run* of them, so nothing is reordered — a
                    passed reminder later in the day stays where it happened.
                    And only from two upwards: hiding a single row behind a tap
                    costs a row and saves none. `passed` is true of events
                    alone, so nothing carrying money or time is ever inside
                    the fold. */}
                {folded > 0 && (
                  <button
                    type="button"
                    aria-expanded={showEarlier}
                    onClick={() => setShowEarlier(true)}
                    className="-mx-2 flex h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-lg border-b border-line px-2 text-left text-xs text-muted transition-colors hover:bg-sunken active:bg-sunken"
                  >
                    <span aria-hidden="true" className="relative flex w-7 shrink-0 justify-center text-faint">
                      <Chevron dir="down" size={16} />
                    </span>
                    {folded} already passed
                  </button>
                )}

                {shownEntries.map((row, at) => (
                  <Fragment key={row.id}>
                    {markerAt === at && <NowMarker now={now} />}
                    <EntryRow
                      row={row}
                      now={now}
                      spine
                      photoUrl={photoThumbnails[row.id]?.url}
                      photoCount={photoThumbnails[row.id]?.count}
                      onOpenPhoto={() => openPhotos(row.id)}
                      onOpen={() => setEditing(asStored(row))}
                      onRetry={retry}
                    />
                  </Fragment>
                ))}
                {markerAt === shownEntries.length && <NowMarker now={now} />}
              </div>

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
                      photoUrl={photoThumbnails[row.id]?.url}
                      photoCount={photoThumbnails[row.id]?.count}
                      onOpenPhoto={() => openPhotos(row.id)}
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

        {/* The screen fills from the top: what Ask is, then what to try.
            Bottom-anchored to the capture control this read as a rendering
            failure — ~700px of nothing over three rows above the box. The
            answer itself still draws inside the control's block: the input
            stays docked, and the result stays beside the thing that made it. */}
        {view === 'ask' && (
          <div className="mt-4 flex flex-1 flex-col">
            {!askFilled && (
              <>
                {/* A true status, or nothing: the mock this follows (spec 017)
                    headed the screen "Neural Sync", which names no feature
                    this app has. What is real is where the answers come from
                    and how much there is to answer from. */}
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    />
                    On-device answers
                  </p>
                  <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-xs text-muted tabular-nums">
                    {all.length} {all.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                <p className="mt-2 max-w-[38ch] text-sm leading-relaxed text-muted">
                  Your log answers questions about itself — arithmetic over your own rows, and
                  nothing leaves this device.
                </p>
                {/* Filled, not submitted: `prefill` lands the text in the box
                    and focuses it, and in Ask the answer computes as you type. */}
                <AskTopics
                  all={all}
                  onPick={(asked) => setPrefill(asked)}
                  onHelp={() => setHelpOpen(true)}
                />
              </>
            )}

            {/* The one thing that belongs low on this screen: pinned above the
                capture control, not floating mid-page. */}
            <p className="mt-auto flex items-center gap-2 pt-6 text-xs text-faint">
              <InfoIcon size={15} className="shrink-0" />
              <span>A leading ? works from Today too, so you never have to come here first.</span>
            </p>
          </div>
        )}

        {/* The extra floor is for the sticky bottom block: while the screen
            scrolls, the nav rides over whatever is above its resting place,
            and the Password block was what it covered. */}
        {view === 'you' && (
          <div className="mt-4 flex-1 pb-8">
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

      {viewingPhotos !== null && (
        <PhotoViewer photos={viewingPhotos} index={0} onClose={closePhotos} />
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
            // Closing is `EntryEditor`'s own job now, through `requestClose` —
            // called right after this, from inside its own `save()`.
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
          // Closing is `AheadSheet`'s own job now, through `requestClose`.
          onPick={(picked) => setDay(picked)}
          onClose={() => setAheadOpen(false)}
        />
      )}

      {helpOpen && (
        <HelpSheet
          // Closing is `HelpSheet`'s own job now, through `requestClose` —
          // this only owns what picking an example actually does.
          onPick={(text) => setPrefill(text)}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  )
}
