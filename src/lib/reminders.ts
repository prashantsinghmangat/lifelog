import { isNative } from './platform'
import type { Entry } from '../types'

/**
 * Notifications raised by the app itself, scheduled on the device.
 *
 * Native only. This is the one thing the web genuinely cannot do: no shipped
 * web API raises a notification while the app is closed, so on the web the
 * calendar hand-off in `ics.ts` remains the answer. Here the OS holds the
 * alarm, so it fires with the app closed, offline, and whatever Supabase is
 * doing.
 *
 * Both imports are dynamic on purpose: nothing from Capacitor then reaches the
 * browser bundle, and this module stays importable under vitest.
 */

/** An all-day event has no clock time, so it alarms at 9am — as the .ics does. */
const ALL_DAY_HOUR = 9

async function plugin() {
  if (!isNative()) return null
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  return LocalNotifications
}

/**
 * What happened, so the caller can say so. Silence was the original bug: the
 * permission was never granted, nothing was scheduled, and the app reported
 * neither.
 */
export type ScheduleResult = 'scheduled' | 'blocked' | 'skipped'

/** Grant state without asking, for launch-time work that has no user gesture. */
export async function permission(): Promise<'granted' | 'denied' | 'unavailable'> {
  const api = await plugin()
  if (!api) return 'unavailable'
  const current = await api.checkPermissions()
  return current.display === 'granted' ? 'granted' : 'denied'
}

/** Asks. Only call this from something the user just did. */
export async function requestPermission(): Promise<boolean> {
  const api = await plugin()
  if (!api) return false
  const asked = await api.requestPermissions()
  return asked.display === 'granted'
}

/**
 * The plugin keys notifications by 32-bit integer, but rows are uuids. Hashing
 * has to be deterministic or a reminder could never be cancelled again.
 */
export function notificationId(uuid: string): number {
  let hash = 0
  for (let index = 0; index < uuid.length; index += 1) {
    hash = (Math.imul(hash, 31) + uuid.charCodeAt(index)) | 0
  }
  // Zero is a valid id but a poor sentinel, so keep it out of range.
  return (Math.abs(hash) % 2_147_483_646) + 1
}

/** When an entry should fire, or null if it should not. */
export function fireAt(entry: Entry): Date | null {
  if (entry.kind !== 'event') return null
  if (entry.occurred_at !== null) return new Date(entry.occurred_at)

  const [year, month, day] = entry.occurred_on.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  return new Date(year, month - 1, day, ALL_DAY_HOUR, 0, 0, 0)
}

export async function schedule(entry: Entry, now: Date): Promise<ScheduleResult> {
  const api = await plugin()
  if (!api) return 'skipped'

  const at = fireAt(entry)
  if (at === null || at.getTime() <= now.getTime()) return 'skipped'

  // Asked here because scheduling follows something the user just did, which
  // is the only moment a permission prompt is not an ambush.
  const state = await permission()
  if (state !== 'granted' && !(await requestPermission())) return 'blocked'

  await api.schedule({
    notifications: [
      {
        id: notificationId(entry.id),
        title: entry.title,
        body: 'lifelog reminder',
        // allowWhileIdle so Doze does not sit on it until the phone is woken.
        schedule: { at, allowWhileIdle: true },
      },
    ],
  })

  return 'scheduled'
}

/**
 * Fires a notification ten seconds out and says what happened, including the
 * plugin's own error text. Exists because a reminder that does not arrive gives
 * no clue whether the parser, the permission or the plugin is at fault, and
 * waiting minutes per attempt to find out is not a diagnosis.
 */
export async function test(): Promise<string> {
  const api = await plugin()
  if (!api) return 'Only available in the app, not the browser.'

  const state = await permission()
  if (state !== 'granted' && !(await requestPermission())) {
    return 'Notifications are blocked for this app.'
  }

  try {
    await api.schedule({
      notifications: [
        {
          id: 999_999,
          title: 'lifelog test',
          body: 'Reminders are working.',
          schedule: { at: new Date(Date.now() + 10_000), allowWhileIdle: true },
        },
      ],
    })
    return 'Scheduled. It should arrive in ten seconds.'
  } catch (failure) {
    return `Failed: ${failure instanceof Error ? failure.message : String(failure)}`
  }
}

export async function cancel(entry: Entry): Promise<void> {
  const api = await plugin()
  if (!api) return
  await api.cancel({ notifications: [{ id: notificationId(entry.id) }] })
}

/**
 * Re-arms everything on launch. Without this, an event logged on the web would
 * never have a notification on the phone, and a reinstall would lose the lot.
 */
export async function sync(entries: Entry[], now: Date): Promise<void> {
  const api = await plugin()
  if (!api) return

  const due = entries.filter((entry) => {
    const at = fireAt(entry)
    return at !== null && at.getTime() > now.getTime()
  })
  if (due.length === 0) return
  // Checks, never asks: a prompt at launch with no context invites a reflexive
  // refusal, and Android stops offering it after two of those.
  if ((await permission()) !== 'granted') return

  await api.schedule({
    notifications: due.map((entry) => ({
      id: notificationId(entry.id),
      title: entry.title,
      body: 'lifelog reminder',
      schedule: { at: fireAt(entry) ?? now, allowWhileIdle: true },
    })),
  })
}
