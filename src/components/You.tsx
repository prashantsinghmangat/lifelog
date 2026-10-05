import { useEffect, useState, type ReactNode } from 'react'
import {
  AutoIcon,
  BellIcon,
  BookIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  LockIcon,
  MoonIcon,
  MusicIcon,
  SunIcon,
} from './Icons'
import { Segmented } from './Segmented'
import { LOCK_AFTER } from '../lib/applock'
import { openReminderChannelSettings } from '../lib/openSettings'
import { PALETTES, type PaletteName } from '../lib/palettes'
import { isNative } from '../lib/platform'
import { permission, requestPermission } from '../lib/reminders'
import { supabase } from '../lib/supabase'
import type { Theme } from '../hooks/useTheme'
import { PRODUCT } from '../lib/product'

const THEMES: { value: Theme; label: string; icon?: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <AutoIcon size={15} /> },
  { value: 'light', label: 'Light', icon: <SunIcon size={15} /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon size={15} /> },
]

/**
 * A section heading with the grouping space built in: the gap above a section
 * must be visibly larger than the gaps inside it, which is what makes the
 * groups read as groups. Bold sentence case since the mock clone (020).
 */
function Eyebrow({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-[26px] mb-2.5 text-[15px] font-semibold text-ink">
      {children}
    </p>
  )
}

/** The settings rows' leading mark: a sunken tile with an accent glyph. */
function Tile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sunken text-accent"
    >
      {children}
    </span>
  )
}

/**
 * One grouped list: a single raised card whose rows are separated by
 * hairlines, with none after the last. The border is for the `lg` surface,
 * where this screen sits inside an equally-raised sheet and the card would
 * otherwise vanish into it.
 */
function Group({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised">
      {children}
    </div>
  )
}

/** A tappable row: 52px, or 56px when it carries a second line. */
function Row({
  title,
  detail,
  icon,
  right,
  onClick,
  ...aria
}: {
  title: string
  detail?: string
  icon?: ReactNode
  right?: ReactNode
  onClick: () => void
  role?: string
  'aria-checked'?: boolean
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...aria}
      className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition-colors hover:bg-sunken active:bg-sunken ${
        detail === undefined ? 'min-h-[52px]' : 'min-h-14'
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        {icon !== undefined && <Tile>{icon}</Tile>}
        <span className="min-w-0">
          <span className="block text-sm text-ink">{title}</span>
          {detail !== undefined && (
            <span className="mt-0.5 block truncate text-xs text-faint">{detail}</span>
          )}
        </span>
      </span>
      {right !== undefined && <span className="flex shrink-0 items-center">{right}</span>}
    </button>
  )
}


type Props = {
  email: string
  /** No account behind the log. See `guest` in `identity.ts`. */
  local: boolean
  theme: Theme
  onTheme: (theme: Theme) => void
  palette: PaletteName
  onPalette: (palette: PaletteName) => void
  /** The mode actually on screen, so each swatch shows the variant being looked at. */
  resolved: 'light' | 'dark'
  nudges: boolean
  onNudges: (on: boolean) => void
  /** Whether the evening recap may print figures. Defaults to the inverse of App Lock. */
  recapFigures: boolean
  onRecapFigures: (on: boolean) => void
  /**
   * App Lock, native only. `usable` is whether the OS has anything to verify
   * with — biometrics or a screen lock; null while the app is still asking.
   */
  lock: { on: boolean; after: number; usable: boolean | null }
  onLockToggle: () => void
  onLockAfter: () => void
  onHelp: () => void
  onExport: () => void
  /** Photos and documents onto storage that survives the app, native only. */
  onExportAttachments: () => void
  onExportCalendar: () => void
  onSignIn: () => void
  onSignOut: () => void
}

/**
 * Everything about the account rather than about the day: who the log belongs
 * to, the theme, the daily prompts, notification permission, the exports and the
 * manual.
 *
 * Three groups — Appearance, Reminders, Your log — each one raised card of
 * hairline-separated rows. The account block at the top is metadata, not a
 * headline: the largest text on this screen used to be the email address.
 *
 * Content only, with no surface of its own, because it is shown two ways. On a
 * phone it is a destination in the bottom nav; on a wide screen it stays a
 * sheet opened from the sidebar. One component either way: there is no
 * `MobileProfile`.
 */
export function You({
  email,
  local,
  theme,
  onTheme,
  palette,
  onPalette,
  resolved,
  nudges,
  recapFigures,
  onRecapFigures,
  onNudges,
  lock,
  onLockToggle,
  onLockAfter,
  onHelp,
  onExport,
  onExportAttachments,
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

  // The address's own name is the closest thing an account here has to one; a
  // guest is called what the sidebar already calls them. No status badge —
  // there is no tier to display, and "signed in" is one word on the meta line.
  const name = local ? 'Guest' : (email.split('@')[0] ?? email)
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase() || '?'

  return (
    <>
      {/* The account block in its own raised card (018) — still metadata,
          not a headline: the card gives it a surface, not a louder voice. */}
      <div className="rounded-2xl border border-line bg-raised p-3.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold text-surface"
          >
            {initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[17px] leading-snug font-semibold text-ink">
              {name}
            </span>
            <span className="block truncate text-xs text-muted">
              {local ? 'This log is on this device only' : `${email} · signed in`}
            </span>
          </span>
        </div>

        {/* Offered as the thing that actually applies: an account, which is what
            carries the log to a second device. */}
        {local && (
          <>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-4 h-11 w-full rounded-lg bg-ink text-sm font-medium text-surface transition-opacity hover:opacity-90"
            >
              Sign in to sync
            </button>
            <p className="mt-1.5 text-xs text-faint">
              Everything logged here comes with you. Nothing is lost by waiting.
            </p>
          </>
        )}

        {/* The manual, where the mock keeps it (019). Quiet on purpose — the
            account card gives it a place, not a louder voice. */}
        <button
          type="button"
          onClick={onHelp}
          className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sunken text-sm font-medium text-accent transition-opacity hover:opacity-80"
        >
          <BookIcon size={18} />
          How to use {PRODUCT.name}
        </button>
      </div>

      <Eyebrow id="appearance">Appearance</Eyebrow>
      <div className="rounded-2xl border border-line bg-raised p-3.5">
        <Segmented
          label="Appearance"
          value={theme}
          options={THEMES}
          onChange={onTheme}
        />

        {/* The palette, orthogonal to the mode above: every palette carries a
            light and a dark block, so System keeps resolving whichever is
            picked. Swatches render from the same constant the CSS blocks are
            tested against. */}
        {/* The mock's 3-wide dot grid (020). The dot is that palette's own
            accent in the resolved mode, straight from the table the CSS
            blocks are tested against — so the swatch cannot lie. */}
        <div role="radiogroup" aria-label="Palette" className="mt-3 grid grid-cols-3 gap-2">
          {PALETTES.map((option) => {
            const tokens = resolved === 'dark' ? option.dark : option.light
            const selected = palette === option.name
            return (
              <button
                key={option.name}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onPalette(option.name)}
                className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 transition-colors ${
                  selected ? 'border-accent bg-sunken' : 'border-line hover:border-edge'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ backgroundColor: tokens.accent }}
                >
                  {selected && (
                    <span className="flex" style={{ color: tokens.surface }}>
                      <CheckIcon size={12} />
                    </span>
                  )}
                </span>
                <span className={`truncate text-xs text-ink ${selected ? 'font-semibold' : ''}`}>
                  {option.label}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-2.5 text-xs text-faint">
          Every palette has a light and a dark set, so System keeps working.
        </p>
      </div>

      {/* Only meaningful in the native app; the web has no reminders to grant. */}
      {isNative() && (
        <>
          <Eyebrow>Reminders</Eyebrow>
          <Group>
            {/* Permission is passive status, so it reads as a row rather than
                as the loudest element in its section. */}
            {reminders === 'granted' && (
              <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <Tile>
                    <BellIcon size={18} />
                  </Tile>
                  <span className="text-sm text-ink">Notifications</span>
                </span>
                <span className="text-sm text-muted">Allowed</span>
              </div>
            )}
            {reminders === 'denied' && (
              <Row
                title="Notifications"
                detail="If tapping does nothing, Android has stopped asking — its own settings has the switch"
                icon={<BellIcon size={18} />}
                right={<span className="text-sm font-medium text-accent">Allow</span>}
                onClick={() => void allowReminders()}
              />
            )}
            {reminders === 'unavailable' && (
              <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <Tile>
                    <BellIcon size={18} />
                  </Tile>
                  <span className="text-sm text-ink">Notifications</span>
                </span>
                <span className="text-sm text-muted">Not available here</span>
              </div>
            )}

            {/* Two prompts a day, raised by the phone with nothing on a server
                involved. The whole row is the switch — the drawn control is
                decoration inside a target that stays row-sized. */}
            {reminders === 'granted' && (
              <Row
                role="switch"
                aria-checked={nudges}
                aria-label="Daily prompts"
                title="Daily prompts"
                detail="9am and 9pm"
                icon={<ClockIcon size={18} />}
                right={
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${
                      nudges
                        ? 'bg-accent'
                        : 'bg-sunken shadow-[inset_0_0_0_1px_var(--color-edge)]'
                    }`}
                  >
                    <span
                      className={`h-6 w-6 rounded-full bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform ${
                        nudges ? 'translate-x-5' : ''
                      }`}
                    />
                  </span>
                }
                onClick={() => onNudges(!nudges)}
              />
            )}

            {/* The evening prompt reads the day back — a spend figure and the
                next thing coming — and a notification is the one part of this
                app readable without unlocking the phone. Whether Android
                redacts it is Android's to decide and cannot be set from here,
                so the words themselves are the only control there is. Off by
                default once App Lock is on, since that switch already said the
                contents are not for whoever is holding the phone. */}
            {reminders === 'granted' && nudges && isNative() && (
              <Row
                role="switch"
                aria-checked={recapFigures}
                aria-label="Figures in the evening recap"
                title="Figures in the evening recap"
                detail={recapFigures ? 'Spend and hours at 9pm' : 'The 9pm prompt only asks'}
                icon={<ClockIcon size={18} />}
                right={
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${
                      recapFigures
                        ? 'bg-accent'
                        : 'bg-sunken shadow-[inset_0_0_0_1px_var(--color-edge)]'
                    }`}
                  >
                    <span
                      className={`h-6 w-6 rounded-full bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform ${
                        recapFigures ? 'translate-x-5' : ''
                      }`}
                    />
                  </span>
                }
                onClick={() => onRecapFigures(!recapFigures)}
              />
            )}

            {/* The sound and vibration a channel uses are Android's to set, not
                this app's — there is no API for either, only this deep link to
                the screen that can. Offered regardless of permission, since it
                is just as useful for finding the channel to turn back on. */}
            <Row
              title="Reminder sound"
              detail="Opens Android's settings for this channel"
              icon={<MusicIcon size={18} />}
              onClick={() => void openReminderChannelSettings()}
            />
          </Group>

          <Eyebrow id="privacy">Privacy &amp; Security</Eyebrow>
          <Group>
            {/* One OS verification arms it; after that the OS dialog owns both
                fingerprint and the device PIN/pattern fallback, so there is no
                app passcode to manage. A device with no screen lock has nothing
                to verify with — the row says so and goes inert rather than
                offering a lock that cannot hold. */}
            <Row
              role="switch"
              aria-checked={lock.on}
              aria-disabled={lock.usable === false}
              aria-label="App Lock"
              title="App Lock"
              detail={
                lock.usable === false
                  ? 'Set a screen lock first'
                  : lock.on
                    ? 'Fingerprint or screen lock · screenshots off while on'
                    : 'Fingerprint or screen lock'
              }
              icon={<LockIcon size={18} />}
              right={
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors ${
                    lock.on
                      ? 'bg-accent'
                      : 'bg-sunken shadow-[inset_0_0_0_1px_var(--color-edge)]'
                  }`}
                >
                  <span
                    className={`h-6 w-6 rounded-full bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform ${
                      lock.on ? 'translate-x-5' : ''
                    }`}
                  />
                </span>
              }
              onClick={() => {
                if (lock.usable !== false) onLockToggle()
              }}
            />
            {/* Cycles rather than opening a sheet: three values, one tap each. */}
            {lock.on && (
              <Row
                title="Lock after"
                detail={
                  LOCK_AFTER.find((option) => option.ms === lock.after)?.label ?? '1 minute'
                }
                icon={<ClockIcon size={18} />}
                onClick={onLockAfter}
              />
            )}
          </Group>
        </>
      )}

      <Eyebrow id="your-log">Your log</Eyebrow>
      <Group>
        <Row
          title="Export a copy"
          detail="JSON"
          icon={<DownloadIcon size={18} />}
          onClick={onExport}
        />

        {/* The log's rows come back from the server; photos and documents have
            never had anywhere to come back from — not the nightly backup, not
            Export JSON, not Android's own, which this app opts out of. An
            uninstall took every photo on the phone on 5 Oct 2026, which is why
            this row exists. Documents rather than app storage: app storage dies
            with the app, and surviving that is the entire point. */}
        {isNative() && (
          <Row
            title="Export photos & documents"
            detail="To Documents/lifelog on this phone"
            icon={<DownloadIcon size={18} />}
            onClick={onExportAttachments}
          />
        )}

        {/* The web's answer only: on the web no API can raise an alarm with
            the app closed, so the OS calendar has to; natively the reminder is
            already scheduled, and handing the same events to the calendar is
            asking for a step the app has taken. */}
        {!isNative() && (
          <Row
            title="Send events to calendar"
            detail="Upcoming events and birthdays, each with its own reminder"
            icon={<CalendarIcon size={18} />}
            onClick={onExportCalendar}
          />
        )}

        {/* Setting a password goes through `updateUser`, which needs a session
            a guest does not have. */}
        {!local && (
          <div className="px-3.5 py-3">
            <p
              id="password-label"
              className="text-[0.6875rem] font-semibold tracking-[0.08em] text-faint uppercase"
            >
              Password
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                aria-labelledby="password-label"
                placeholder="Set a password"
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 py-2.5 text-base text-ink"
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
          </div>
        )}
      </Group>

      {/* Nothing to sign out of as a guest, and the button would read as
          "delete my log" — the one thing it must not do to the only copy. */}
      <div className="mt-[26px] flex flex-col items-center gap-0.5 pb-2 text-center">
        {!local && (
          <button
            type="button"
            onClick={onSignOut}
            className="h-11 rounded-lg px-4 text-sm font-medium text-expense transition-colors hover:bg-sunken"
          >
            Sign out
          </button>
        )}
        <p className="text-xs text-faint">Designed with clarity and restraint.</p>
      </div>
    </>
  )
}
