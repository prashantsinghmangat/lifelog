import { useEffect, useState, type ReactNode } from 'react'
import { CheckIcon, Chevron } from './Icons'
import { Segmented } from './Segmented'
import { openReminderChannelSettings } from '../lib/openSettings'
import { PALETTES, type PaletteName, type TokenBlock } from '../lib/palettes'
import { isNative } from '../lib/platform'
import { permission, requestPermission } from '../lib/reminders'
import { supabase } from '../lib/supabase'
import type { Theme } from '../hooks/useTheme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * A section eyebrow with the grouping space built in: the gap above a section
 * must be visibly larger than the gaps inside it, which is what makes the
 * groups read as groups.
 */
function Eyebrow({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      className="mt-[26px] mb-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase"
    >
      {children}
    </p>
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
    <div className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-raised">
      {children}
    </div>
  )
}

/** A tappable row: 52px, or 56px when it carries a second line. */
function Row({
  title,
  detail,
  right,
  onClick,
  ...aria
}: {
  title: string
  detail?: string
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
      <span className="min-w-0">
        <span className="block text-sm text-ink">{title}</span>
        {detail !== undefined && (
          <span className="mt-0.5 block truncate text-xs text-faint">{detail}</span>
        )}
      </span>
      {right !== undefined && <span className="flex shrink-0 items-center">{right}</span>}
    </button>
  )
}

/**
 * A palette's swatch is a miniature of the screen, not three colour bands: the
 * palette's own surface, an accent dot, two rules of ink standing in for rows,
 * and a raised bar pinned along the bottom the way the capture control is. It
 * reads as "this is what that theme looks like". Inline styles because these
 * are another palette's tokens, not the live one's — the same table the CSS
 * blocks are tested against, so the swatch cannot lie about its product.
 */
function Swatch({ tokens }: { tokens: TokenBlock }) {
  return (
    <span
      aria-hidden="true"
      className="relative block h-7 w-[38px] shrink-0 overflow-hidden rounded-[5px] border border-line"
      style={{ backgroundColor: tokens.surface }}
    >
      <span
        className="absolute top-1 left-1 h-1 w-1 rounded-full"
        style={{ backgroundColor: tokens.accent }}
      />
      <span
        className="absolute top-[11px] left-1 h-[2px] w-[18px] rounded-full opacity-30"
        style={{ backgroundColor: tokens.ink }}
      />
      <span
        className="absolute top-[15px] left-1 h-[2px] w-[13px] rounded-full opacity-30"
        style={{ backgroundColor: tokens.ink }}
      />
      <span
        className="absolute inset-x-[3px] bottom-[3px] h-[7px] rounded-[3px]"
        style={{ backgroundColor: tokens.raised, boxShadow: `inset 0 0 0 1px ${tokens.line}` }}
      />
    </span>
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

  // The address's own name is the closest thing an account here has to one; a
  // guest is called what the sidebar already calls them. No status badge —
  // there is no tier to display, and "signed in" is one word on the meta line.
  const name = local ? 'Guest' : (email.split('@')[0] ?? email)

  return (
    <>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-surface"
        >
          {(name[0] ?? '?').toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-snug font-medium text-ink">
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

      <Eyebrow id="appearance">Appearance</Eyebrow>
      <div className="rounded-[14px] border border-line bg-raised p-3.5">
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
        <div role="radiogroup" aria-label="Palette" className="mt-3 grid grid-cols-2 gap-2">
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
                className={`flex h-14 items-center gap-2.5 rounded-[10px] border-[1.5px] px-3 text-left transition-colors ${
                  selected ? 'border-accent' : 'border-line hover:border-edge'
                }`}
              >
                <Swatch tokens={tokens} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{option.label}</span>
                {selected && <CheckIcon size={14} className="shrink-0 text-accent" />}
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
              <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5">
                <span className="text-sm text-ink">Notifications</span>
                <span className="text-sm text-muted">Allowed</span>
              </div>
            )}
            {reminders === 'denied' && (
              <Row
                title="Notifications"
                detail="If tapping does nothing, Android has stopped asking — its own settings has the switch"
                right={<span className="text-sm font-medium text-accent">Allow</span>}
                onClick={() => void allowReminders()}
              />
            )}
            {reminders === 'unavailable' && (
              <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5">
                <span className="text-sm text-ink">Notifications</span>
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
                right={
                  <span
                    aria-hidden="true"
                    className={`flex h-[25px] w-[42px] items-center rounded-full p-[3px] transition-colors ${
                      nudges
                        ? 'bg-accent'
                        : 'bg-sunken shadow-[inset_0_0_0_1px_var(--color-edge)]'
                    }`}
                  >
                    <span
                      className={`h-[19px] w-[19px] rounded-full bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform ${
                        nudges ? 'translate-x-[17px]' : ''
                      }`}
                    />
                  </span>
                }
                onClick={() => onNudges(!nudges)}
              />
            )}

            {/* The sound and vibration a channel uses are Android's to set, not
                this app's — there is no API for either, only this deep link to
                the screen that can. Offered regardless of permission, since it
                is just as useful for finding the channel to turn back on. */}
            <Row
              title="Reminder sound"
              detail="Opens Android's settings for this channel"
              onClick={() => void openReminderChannelSettings()}
            />
          </Group>
        </>
      )}

      <Eyebrow id="your-log">Your log</Eyebrow>
      <Group>
        {/* The least-used item on the screen, so it is an ordinary row now
            rather than the loudest control — it was a full-width outlined
            button above everything it should have sat under. */}
        <Row
          title="How to use lifelog"
          detail="The manual — every example fills the box"
          right={<Chevron dir="right" size={16} className="text-faint" />}
          onClick={onHelp}
        />
        <Row title="Export a copy" detail="JSON" onClick={onExport} />

        {/* The web's answer only: on the web no API can raise an alarm with
            the app closed, so the OS calendar has to; natively the reminder is
            already scheduled, and handing the same events to the calendar is
            asking for a step the app has taken. */}
        {!isNative() && (
          <Row
            title="Send events to calendar"
            detail="Upcoming events and birthdays, each with its own reminder"
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
      {!local && (
        <button
          type="button"
          onClick={onSignOut}
          className="-ml-2 mt-[26px] h-11 rounded-lg px-2 text-sm text-expense transition-colors hover:bg-sunken"
        >
          Sign out
        </button>
      )}
    </>
  )
}
