import { isNative } from './platform'
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications'
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

/** An all-day event has no clock time, so it alarms at 9am, as the .ics does. */
const ALL_DAY_HOUR = 9

/**
 * Returns the plugin **inside a wrapper**, which is not decoration.
 *
 * Returning it bare from an async function rejects every call with
 * `"LocalNotifications.then()" is not implemented on android`: resolving an
 * async return value reads `.then` to test whether it is thenable, and
 * Capacitor's proxy forwards any property access to native as a method call.
 * So the mere act of returning it invented a native method named `then`.
 */
async function plugin(): Promise<{ api: LocalNotificationsPlugin } | null> {
  if (!isNative()) return null
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  return { api: LocalNotifications }
}

/**
 * What happened, so the caller can say so. Silence was the original bug: the
 * permission was never granted, nothing was scheduled, and the app reported
 * neither.
 */
export type ScheduleResult = 'scheduled' | 'blocked' | 'skipped'

/**
 * Grant state without asking, for launch-time work that has no user gesture.
 *
 * Never rejects. A rejection here left the state unknown, which the UI then
 * rendered as "not granted", so a plugin that failed to load looked exactly
 * like a permission the user had refused.
 */
export async function permission(): Promise<'granted' | 'denied' | 'unavailable'> {
  try {
    const found = await plugin()
    if (!found) return 'unavailable'
    const current = await found.api.checkPermissions()
    return current.display === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unavailable'
  }
}

/** Asks. Only call this from something the user just did. */
export async function requestPermission(): Promise<boolean> {
  const found = await plugin()
  if (!found) return false
  const asked = await found.api.requestPermissions()
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
  const found = await plugin()
  if (!found) return 'skipped'

  const at = fireAt(entry)
  if (at === null || at.getTime() <= now.getTime()) return 'skipped'

  // Asked here because scheduling follows something the user just did, which
  // is the only moment a permission prompt is not an ambush.
  const state = await permission()
  if (state !== 'granted' && !(await requestPermission())) return 'blocked'

  await found.api.schedule({
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

export async function cancel(entry: Entry): Promise<void> {
  const found = await plugin()
  if (!found) return
  await found.api.cancel({ notifications: [{ id: notificationId(entry.id) }] })
}

/**
 * Re-arms everything on launch. Without this, an event logged on the web would
 * never have a notification on the phone, and a reinstall would lose the lot.
 */
export async function sync(entries: Entry[], now: Date): Promise<void> {
  const found = await plugin()
  if (!found) return

  const due = entries.filter((entry) => {
    const at = fireAt(entry)
    return at !== null && at.getTime() > now.getTime()
  })
  if (due.length === 0) return
  // Checks, never asks: a prompt at launch with no context invites a reflexive
  // refusal, and Android stops offering it after two of those.
  if ((await permission()) !== 'granted') return

  await found.api.schedule({
    notifications: due.map((entry) => ({
      id: notificationId(entry.id),
      title: entry.title,
      body: 'lifelog reminder',
      schedule: { at: fireAt(entry) ?? now, allowWhileIdle: true },
    })),
  })
}
