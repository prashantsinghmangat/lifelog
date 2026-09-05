import { useEffect, useState } from 'react'
import { Sheet } from './Sheet'
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
  theme: Theme
  onTheme: (theme: Theme) => void
  onHelp: () => void
  onExport: () => void
  onExportCalendar: () => void
  onSignOut: () => void
  onClose: () => void
}

export function ProfileSheet({
  email,
  theme,
  onTheme,
  onHelp,
  onExport,
  onExportCalendar,
  onSignOut,
  onClose,
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
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setNote(error.message)
      return
    }
    setPassword('')
    setNote('Password saved. Use it to sign in on any device.')
  }

  return (
    <Sheet label="Profile and settings" onClose={onClose}>
      <p className="truncate text-sm font-medium">{email}</p>
      <p className="text-xs text-faint">Signed in</p>

      <button
        type="button"
        onClick={onHelp}
        className="mt-4 h-11 w-full rounded-lg border border-edge text-sm font-medium text-ink"
      >
        How to use lifelog
      </button>

      <p className="mt-5 mb-2 text-xs text-muted" id="appearance">
        Appearance
      </p>
      <div role="group" aria-labelledby="appearance" className="flex gap-1 rounded-lg border border-line p-1">
        {THEMES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={theme === option.value}
            onClick={() => onTheme(option.value)}
            className={`h-11 flex-1 rounded px-2 text-sm ${
              theme === option.value ? 'bg-ink font-medium text-surface' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Only meaningful in the native app; the web has no reminders to grant. */}
      {isNative() && (
        <>
          <p className="mt-5 mb-2 text-xs text-muted">Reminders</p>
          {reminders === 'granted' && <p className="text-sm text-time">Notifications allowed.</p>}

          {reminders === 'denied' && (
            <>
              <button
                type="button"
                onClick={() => void allowReminders()}
                className="h-11 w-full rounded-lg bg-ink text-sm font-medium text-surface"
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
        </>
      )}

      <p className="mt-5 mb-2 text-xs text-muted" id="password-label">
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

      <button
        type="button"
        onClick={onExportCalendar}
        className="mt-5 h-11 w-full rounded-lg border border-edge text-sm font-medium text-ink"
      >
        Send events to calendar
      </button>
      <p className="mt-1.5 text-xs text-faint">
        Upcoming events and birthdays, each with its own reminder. Birthdays repeat yearly and
        alarm at 9am.
      </p>

      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={onExport} className="h-11 text-sm text-muted underline">
          Export JSON
        </button>
        <button type="button" onClick={onSignOut} className="h-11 px-1 text-sm text-expense">
          Sign out
        </button>
      </div>
    </Sheet>
  )
}
