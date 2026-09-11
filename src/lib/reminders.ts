import { done, weeklyDays } from './events'
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
 * The two daily prompts, and the ids they own.
 *
 * These are not an entry's alarm — nothing in the log corresponds to them —
 * so they need fixed ids of their own, kept out of the range `notificationId`
 * can produce. They repeat forever from one `schedule` call: `on: { hour,
 * minute }` is a cron, not a one-off, so the phone keeps raising them with the
 * app closed and nothing on a server involved.
 */
const NUDGES = [
  {
    id: 1,
    hour: 9,
    title: 'Anything to add for today?',
    body: 'Type it once and it is out of your head.',
  },
  {
    id: 2,
    hour: 21,
    title: 'What happened today?',
    body: 'And anything you want waiting for tomorrow.',
  },
] as const

/**
 * Reminders ring; the daily prompts murmur.
 *
 * On Android 8 and up the **channel** decides the sound and whether a
 * notification pushes itself in front of you — not the notification. The
 * default channel this app had been using was created at normal importance
 * with no sound, which is why every reminder arrived silently. A channel's
 * settings belong to the user once it exists and an app cannot raise them
 * again, so the fix is a *new* channel rather than a change to the old one.
 *
 * Two of them, so muting the 9am prompt in Android's settings does not also
 * mute a reminder you actually asked for.
 */
const REMINDERS = 'lifelog-reminders-v1'
const PROMPTS = 'lifelog-prompts-v1'

let channelled = false

async function channels(api: LocalNotificationsPlugin): Promise<void> {
  if (channelled) return
  try {
    // importance 5 is IMPORTANCE_HIGH: sound, vibration, and a heads-up banner.
    await api.createChannel({
      id: REMINDERS,
      name: 'Reminders',
      description: 'Things you asked to be reminded about',
      importance: 5,
      vibration: true,
      visibility: 1,
    })
    await api.createChannel({
      id: PROMPTS,
      name: 'Daily prompts',
      description: 'The morning and evening nudges to keep the log going',
      importance: 3,
      vibration: false,
      visibility: 1,
    })
    channelled = true
  } catch {
    // Channels are Android-only. Elsewhere the notification's own defaults stand.
    channelled = true
  }
}

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
  // The low ids belong to the daily prompts, so a row can never collide with
  // one and silently replace it.
  return (Math.abs(hash) % 2_147_483_600) + 8
}

/**
 * When an entry should fire, or null if it should not.
 *
 * Ticked off means silent. Every scheduling path runs through here, so marking
 * something done is enough to stop the alarm — otherwise "call mom" would ring
 * at five o'clock to remind you of something you did at three, which is worse
 * than no reminder because it teaches you to ignore them.
 */
export function fireAt(entry: Entry): Date | null {
  if (entry.kind !== 'event') return null
  if (done(entry)) return null
  if (entry.occurred_at !== null) return new Date(entry.occurred_at)

  const [year, month, day] = entry.occurred_on.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  return new Date(year, month - 1, day, ALL_DAY_HOUR, 0, 0, 0)
}

/** A `yyyy-MM-dd` as local midnight, or null if it is not one. */
function localDay(key: string): Date | null {
  const [year, month, day] = key.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

/** The first time a given weekday comes round on or after `start`. */
function firstFall(day: number, start: Date, hour: number, minute: number): Date {
  const when = new Date(start)
  while (when.getDay() !== day) when.setDate(when.getDate() + 1)
  when.setHours(hour, minute, 0, 0)
  return when
}

/**
 * When a `weekday` cron would actually go off first — strictly after now, so a
 * Thursday standup set up on Thursday evening is answered with next Thursday.
 * Anchoring on today instead put its first firing this morning, hours gone by,
 * and every comparison against a start date then read as too early.
 */
function nextFiring(day: number, now: Date, hour: number, minute: number): Date {
  const when = new Date(now)
  when.setHours(hour, minute, 0, 0)
  for (let step = 0; step < 8; step += 1) {
    if (when.getDay() === day && when > now) return when
    when.setDate(when.getDate() + 1)
  }
  return when
}

/** One notification: a moment, or a weekday and a time that comes round again. */
type Alarm = {
  id: number
  at?: Date
  on?: { weekday: number; hour: number; minute: number }
}

/**
 * Every notification an entry should own, and when each of them fires.
 *
 * A weekly repeat is **one row with several alarms** — five for `weekdays` —
 * each scheduled with `on: { weekday, hour, minute }`, which is a cron the OS
 * keeps honouring. That is what lets the log hold one line for a standup that
 * rings every working day, instead of expanding into five rows nobody wants to
 * edit five times.
 */
export function alarms(entry: Entry, now: Date): Alarm[] {
  if (entry.kind !== 'event' || done(entry)) return []

  const weekly = weeklyDays(entry)
  if (weekly !== null) {
    const at = entry.occurred_at === null ? null : new Date(entry.occurred_at)
    const hour = at?.getHours() ?? ALL_DAY_HOUR
    const minute = at?.getMinutes() ?? 0

    // `on: { weekday }` is a cron with no notion of a start, and its first
    // firing is simply the next matching weekday. For a repeat that begins
    // later than that, the cron rang before the entry had begun — a standup set
    // up to start on Monday the 14th went off on Friday the 11th.
    //
    // The bound is per weekday, not per entry: only the weekdays that would
    // fire early need holding back, and those get a one-off at their first real
    // occurrence under the *same* id, so a launch on or after the start date
    // replaces each with its standing cron. Doing it per entry instead turned
    // the ordinary case — typed today, starting tomorrow — into five one-offs
    // that would have stopped repeating after a week.
    const start = localDay(entry.occurred_on)

    return weekly.map((day) => {
      const id = notificationId(`${entry.id}#${day}`)
      const early = start !== null && nextFiring(day, now, hour, minute) < start

      // Capacitor counts Sunday as 1, `Date.getDay()` counts it as 0.
      if (!early) return { id, on: { weekday: day + 1, hour, minute } }
      return { id, at: firstFall(day, start, hour, minute) }
    })
  }

  const at = fireAt(entry)
  if (at === null || at.getTime() <= now.getTime()) return []
  return [{ id: notificationId(entry.id), at }]
}

/**
 * Every id an entry could ever have owned.
 *
 * Cancelling has to cover the repeat an entry *used* to have: edit a weekday
 * standup down to a single Monday and the other four alarms are still armed,
 * with nothing left in the row to derive their ids from.
 */
export function alarmIds(entry: Entry): number[] {
  return [
    notificationId(entry.id),
    ...[0, 1, 2, 3, 4, 5, 6].map((day) => notificationId(`${entry.id}#${day}`)),
  ]
}

function notification(entry: Entry, alarm: Alarm) {
  return {
    id: alarm.id,
    title: entry.title,
    body: 'lifelog reminder',
    channelId: REMINDERS,
    // allowWhileIdle so Doze does not sit on it until the phone is woken.
    schedule:
      alarm.at !== undefined
        ? { at: alarm.at, allowWhileIdle: true }
        : { on: alarm.on, allowWhileIdle: true },
  }
}

export async function schedule(entry: Entry, now: Date): Promise<ScheduleResult> {
  const found = await plugin()
  if (!found) return 'skipped'

  const due = alarms(entry, now)
  if (due.length === 0) return 'skipped'

  // Asked here because scheduling follows something the user just did, which
  // is the only moment a permission prompt is not an ambush.
  const state = await permission()
  if (state !== 'granted' && !(await requestPermission())) return 'blocked'

  await channels(found.api)
  await found.api.schedule({
    notifications: due.map((alarm) => notification(entry, alarm)),
  })

  return 'scheduled'
}

/**
 * Turns the two daily prompts on or off.
 *
 * Cancelled first either way: rescheduling an existing id replaces it on
 * Android but not everywhere, and two copies of a 9am prompt is exactly the
 * kind of thing that gets notifications switched off for good.
 */
export async function scheduleNudges(on: boolean): Promise<ScheduleResult> {
  const found = await plugin()
  if (!found) return 'skipped'

  await found.api.cancel({ notifications: NUDGES.map((nudge) => ({ id: nudge.id })) })
  if (!on) return 'skipped'

  if ((await permission()) !== 'granted') return 'blocked'

  await channels(found.api)
  await found.api.schedule({
    notifications: NUDGES.map((nudge) => ({
      id: nudge.id,
      title: nudge.title,
      body: nudge.body,
      channelId: PROMPTS,
      schedule: { on: { hour: nudge.hour, minute: 0 }, allowWhileIdle: true },
    })),
  })

  return 'scheduled'
}

export async function cancel(entry: Entry): Promise<void> {
  const found = await plugin()
  if (!found) return
  await found.api.cancel({ notifications: alarmIds(entry).map((id) => ({ id })) })
}

/**
 * Re-arms everything on launch. Without this, an event logged on the web would
 * never have a notification on the phone, and a reinstall would lose the lot.
 */
export async function sync(entries: Entry[], now: Date): Promise<void> {
  const found = await plugin()
  if (!found) return

  // Checks, never asks: a prompt at launch with no context invites a reflexive
  // refusal, and Android stops offering it after two of those.
  if ((await permission()) !== 'granted') return

  const due = entries
    .map((entry) => ({ entry, alarms: alarms(entry, now) }))
    .filter((planned) => planned.alarms.length > 0)
  const wanted = new Set(due.flatMap((planned) => planned.alarms.map((alarm) => alarm.id)))

  /**
   * Anything armed that this launch does not want is cancelled first.
   *
   * The OS holds alarms the app has no memory of: a row deleted on another
   * device, an entry whose time moved, or — the reason this exists — an id
   * scheme that changed under a pending alarm, which would leave the old copy
   * to fire beside the new one. Launch is the only place that can see both
   * sides, so it is the place that reconciles them. The daily prompts are left
   * alone; they are not entries and `scheduleNudges` owns them.
   */
  try {
    const pending = await found.api.getPending()
    const stale = pending.notifications
      .map((notification) => notification.id)
      .filter((id) => !wanted.has(id) && !NUDGES.some((nudge) => nudge.id === id))

    if (stale.length > 0) {
      await found.api.cancel({ notifications: stale.map((id) => ({ id })) })
    }
  } catch {
    // Not worth abandoning the re-arm below over.
  }

  if (due.length === 0) return

  await channels(found.api)
  await found.api.schedule({
    notifications: due.flatMap((planned) =>
      planned.alarms.map((alarm) => notification(planned.entry, alarm)),
    ),
  })
}
