import { useEffect, useState } from 'react'
import { isNative } from '../lib/platform'
import { permission, requestPermission } from '../lib/reminders'
import { supabase } from '../lib/supabase'
import type { Theme } from '../hooks/useTheme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

type Props = {
  email: string
  /** No account behind the log. See `guest` in `identity.ts`. */
  local: boolean
  theme: Theme
  onTheme: (theme: Theme) => void
  nudges: boolean
  onNudges: (on: boolean) => void
  onHelp: () => void
  onExport: () => void
  onExportCalendar: () => void
  onSignIn: () => void
  onSignOut: () => void
}

/**
 * Everything about the account rather than about the day: who the log belongs
 * to, the theme, the daily prompts, notification permission, the exports and the
 * manual.
 *
 * Content only, with no surface of its own, because it is shown two ways. On a
 * phone it is a destination in the bottom nav — the account used to be a 20px
 * glyph in the quietest row on the screen, which is not where somebody looks for
 * the one warning that matters here. On a wide screen the nav does not exist and
 * the sidebar already carries the account, so it stays a sheet opened from
 * there. One component either way: there is no `MobileProfile`.
 */
export function You({
  email,
  local,
  theme,
  onTheme,
  nudges,
  onNudges,
  onHelp,
  onExport,
  onExportCalendar,
  onSignIn,
  onSignOut,
}: Props) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [reminders, setReminders] = useState<'granted' | 'denied' | 'unavailable' | null>(null)

  useEffect(() => {
    let live = true
    void permission().then((state) => {
      if (live) setReminders(state)
    })
    return () => {
      live = false
    }
  }, [])

  async function allowReminders() {
    const granted = await requestPermission()
    setReminders(granted ? 'granted' : 'denied')
  }

  /**
   * Sets a password on the account from inside an existing session, which is
   * what makes password sign-in usable here at all: creating an account with a
   * password normally needs a confirmation email, and this project cannot send
   * a usable one. Once set, any device signs in without email.
   */
  async function savePassword() {
    if (password.length < 6) {
      setNote('At least six characters.')
      return
    }

    setBusy(true)
    setNote(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setNote(error.message)
        return
      }
      setPassword('')
      setNote('Password saved. Use it to sign in on any device.')
    } catch (failure) {
      // Cleared in a `finally`, because a throw that skipped `setBusy(false)`
      // left Save disabled for good with nothing said — and this is the only
      // way to set the password that makes the other sign-in routes usable.
      setNote(failure instanceof Error ? failure.message : 'Could not reach the account service')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    {/* A guest has no address to show and is not signed out either — the log
        is simply on this phone. Said plainly, because the one thing worth
        knowing about this state is what happens if the phone is lost. */}
    <p className="truncate text-base font-semibold tracking-tight">
      {local ? 'No account' : email}
    </p>
    <p className="mt-0.5 text-xs text-faint">
      {local ? 'This log is on this device only' : 'Signed in'}
    </p>

    <button
      type="button"
      onClick={onHelp}
      className="mt-5 h-11 w-full rounded-lg border border-edge text-sm font-medium text-ink transition-colors hover:bg-sunken"
    >
      How to use lifelog
    </button>

    <p className="mt-6 mb-2 text-[0.6875rem] font-medium tracking-[0.08em] text-faint uppercase" id="appearance">
      Appearance
    </p>
    <div
      role="group"
      aria-labelledby="appearance"
      className="flex gap-1 rounded-xl border border-line bg-sunken p-1"
    >
      {THEMES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => onTheme(option.value)}
          className={`h-11 flex-1 rounded-lg px-2 text-sm transition-colors ${
            theme === option.value
              ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
              : 'text-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>

    {/* Only meaningful in the native app; the web has no reminders to grant. */}
    {isNative() && (
      <>
        <p className="mt-6 mb-2 text-[0.6875rem] font-medium tracking-[0.08em] text-faint uppercase">Reminders</p>
        {reminders === 'granted' && <p className="text-sm text-time">Notifications allowed.</p>}

        {reminders === 'denied' && (
          <>
            <button
              type="button"
              onClick={() => void allowReminders()}
              className="h-11 w-full rounded-lg bg-ink text-sm font-medium text-surface transition-opacity hover:opacity-90"
            >
              Allow notifications
            </button>
            <p className="mt-1.5 text-xs text-faint">
              If nothing happens, Android has stopped asking. Settings → Apps → lifelog →
              Notifications, and turn them on there.
            </p>
          </>
        )}

        {reminders === 'unavailable' && (
          <p className="text-sm text-muted">Reminders are not available here.</p>
        )}

        {/* Two prompts a day, raised by the phone with nothing on a server
            involved. A log nobody is reminded to keep is a log that stops
            after a fortnight — but a daily notification is also the fastest
            way to get an app muted, so it says exactly when it will arrive
            and can be switched off in one tap. */}
        {reminders === 'granted' && (
          <button
            type="button"
            aria-pressed={nudges}
            onClick={() => onNudges(!nudges)}
            className="mt-3 flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-edge px-3 text-left"
          >
            <span className="min-w-0">
              <span className="block text-sm text-ink">Daily prompts</span>
              <span className="block text-xs text-faint">9am and 9pm</span>
            </span>
            <span
              aria-hidden="true"
              className={`shrink-0 text-xs font-medium ${nudges ? 'text-time' : 'text-faint'}`}
            >
              {nudges ? 'On' : 'Off'}
            </span>
          </button>
        )}
      </>
    )}

    {/* Setting a password goes through `updateUser`, which needs a session
        there is none of here. Offered as the thing that actually applies: an
        account, which is what carries the log to a second device. */}
    {local && (
      <>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-6 h-11 w-full rounded-lg bg-ink text-sm font-medium text-surface transition-opacity hover:opacity-90"
        >
          Sign in to sync
        </button>
        <p className="mt-1.5 text-xs text-faint">
          Everything logged here comes with you. Nothing is lost by waiting.
        </p>
      </>
    )}

    {!local && (
      <>
    <p className="mt-6 mb-2 text-[0.6875rem] font-medium tracking-[0.08em] text-faint uppercase" id="password-label">
      Password
    </p>
    <div className="flex gap-2">
      <input
        type="password"
        autoComplete="new-password"
        value={password}
        aria-labelledby="password-label"
        placeholder="Set a password"
        onChange={(event) => setPassword(event.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-ink"
      />
      <button
        type="button"
        disabled={busy || password === ''}
        onClick={() => void savePassword()}
        className="h-11 shrink-0 rounded-lg bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
      >
        {busy ? '…' : 'Save'}
      </button>
    </div>
    <p role="status" aria-live="polite" className="mt-1.5 min-h-4 text-xs text-muted">
      {note}
    </p>
      </>
    )}

    {/* The web's answer only, and it is offered nowhere else for the same
        reason the per-entry "Add to calendar" is not: on the web no API can
        raise an alarm with the app closed, so the OS calendar has to; in the
        native app the reminder is already scheduled, and handing the same
        events to the calendar as well is asking for a step the app has taken.
        It was shown here on native regardless — and did nothing when pressed,
        because there is no share sheet in a WebView to hand an .ics to. */}
    {!isNative() && (
      <>
        <button
          type="button"
          onClick={onExportCalendar}
          className="mt-6 h-11 w-full rounded-lg border border-edge text-sm font-medium text-ink transition-colors hover:bg-sunken"
        >
          Send events to calendar
        </button>
        <p className="mt-1.5 text-xs text-faint">
          Upcoming events and birthdays, each with its own reminder. Birthdays repeat yearly and
          alarm at 9am.
        </p>
      </>
    )}

    {/* The things you leave by, set apart from the things you come here to
        change. A rule and a quieter row, rather than three more full-width
        buttons that read as equal in weight to the theme you actually use. */}
    <div className="mt-6 flex items-center justify-between border-t border-line pt-2">
      <button
        type="button"
        onClick={onExport}
        className="-ml-2 h-11 rounded-lg px-2 text-sm text-muted transition-colors hover:bg-sunken hover:text-ink"
      >
        Export JSON
      </button>
      {/* Nothing to sign out of, and the button would read as "delete my log"
          — which is the one thing it must not do to the only copy there is. */}
      {!local && (
        <button
          type="button"
          onClick={onSignOut}
          className="-mr-2 h-11 rounded-lg px-2 text-sm text-expense transition-colors hover:bg-sunken"
        >
          Sign out
        </button>
      )}
    </div>
    </>
  )
}
