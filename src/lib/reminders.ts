import { ALL_DAY_HOUR, done, monthlyDay, nextOccurrence, recurring, weeklyDays, withLead } from './events'
import { PRODUCT } from './product'
import { GENERIC, type Recap } from './recap'
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

/**
 * The morning prompt, and the id it owns.
 *
 * Not an entry's alarm — nothing in the log corresponds to it — so it needs a
 * fixed id of its own, kept out of the range `notificationId` can produce. It
 * repeats forever from one `schedule` call: `on: { hour, minute }` is a cron,
 * not a one-off, so the phone keeps raising it with the app closed and nothing
 * on a server involved.
 */
const MORNING = {
  id: 1,
  hour: 9,
  title: 'Anything to add for today?',
  body: 'Type it once and it is out of your head.',
} as const

/**
 * The evening recap cannot be a cron, and that is what the six ids are for.
 *
 * A cron fires forever from one call but carries the text it was armed with,
 * and the recap's whole point is to carry *today's* figures — which are not
 * known until the day has happened. So the evening is a one-off per night
 * instead, and every arming rebuilds the window: tonight with real figures,
 * the nights after it with the generic wording, because this device cannot
 * yet say what will happen on them.
 *
 * Six of them because a one-off that is never re-armed is a prompt that stops
 * the first day the app is not opened — which is the day it matters most. Six
 * nights is how long the prompt survives an unopened app, and `notificationId`
 * starts at 8, so the block is free.
 */
const RECAP_IDS = [2, 3, 4, 5, 6, 7] as const
const RECAP_HOUR = 21

/** Every id the prompts own, which `sync` must leave alone. */
const NUDGE_IDS: readonly number[] = [MORNING.id, ...RECAP_IDS]

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
 *
 * Reminders are on `-v2` because `-v1` was created with `visibility: 1`
 * (PUBLIC) — an explicit opt-out of Android's own lock-screen content hiding,
 * so entry titles printed on a locked phone. The same immutability rule above
 * applies: the fix is the next id, never a change to the old one. The prompts
 * channel stays on `-v1`, and spec 046 made its declared `visibility: 1` a
 * lie it did not used to be: the evening recap puts an amount and an entry
 * title in a prompt. The field is inert either way — measured, above — so what
 * redacts a prompt is the same Android per-notification default that redacts a
 * reminder, and spec 046's own controls (figures off under App Lock, and the
 * switch beside it) are what actually govern the words. A `-v2` prompts
 * channel declaring `visibility: 0` is the honest config and is its own spec:
 * a new channel id drops the sound and vibration the user chose on this one.
 */
const REMINDERS = 'lifelog-reminders-v2'
const PROMPTS = 'lifelog-prompts-v1'

let channelled = false

async function channels(api: LocalNotificationsPlugin): Promise<void> {
  if (channelled) return

  // Each on its own, because one shared `try` meant the *second* channel was
  // never attempted once the first threw — and the catch latched `channelled`,
  // so it was never attempted again either. A reminders channel that created
  // fine and a prompts channel that never existed is a plausible half-state,
  // and the prompts would then have gone out on Capacitor's `default` channel:
  // importance 3, no sound, which is the exact bug this pair exists to fix.
  // The old public-visibility channel goes first: deleted, it stops appearing
  // in Android's settings, and a notification scheduled onto a deleted channel
  // is silently dropped — which is fine, because the launch `sync` re-schedules
  // every wanted alarm onto the new channel anyway. That re-arm is the whole
  // migration.
  try {
    await api.deleteChannel({ id: 'lifelog-reminders-v1' })
  } catch {
    // Never existed here, or not Android.
  }

  await one(api, {
    id: REMINDERS,
    name: 'Reminders',
    description: 'Things you asked to be reminded about',
    // importance 5 is IMPORTANCE_HIGH: sound, vibration, and a heads-up banner.
    importance: 5,
    vibration: true,
    // 0 is VISIBILITY_PRIVATE. Measured truth, Android 16 emulator: this field
    // never survives — the plugin's channels land as VISIBILITY_NO_OVERRIDE,
    // and so does a channel created natively with setLockscreenVisibility, so
    // no app can pin it. What actually protects the title is that Android
    // notifications default to PRIVATE *per notification*: on a secured lock
    // screen the OS redacts them whenever the user's own "sensitive
    // notifications" setting says to. v1's `visibility: 1` was equally inert —
    // the v2 move is kept for the honest config and the clean slate.
    visibility: 0,
  })
  await one(api, {
    id: PROMPTS,
    name: 'Daily prompts',
    description: 'The morning and evening nudges to keep the log going',
    importance: 3,
    vibration: false,
    visibility: 1,
  })

  // Latched either way: channels are Android-only, and elsewhere every attempt
  // throws identically for ever. Asking again on each schedule buys nothing.
  channelled = true
}

/** One channel, whose failure is not the other one's business. */
async function one(
  api: LocalNotificationsPlugin,
  channel: Parameters<LocalNotificationsPlugin['createChannel']>[0],
): Promise<void> {
  try {
    await api.createChannel(channel)
  } catch {
    // Not Android, or the OS refused. The notification's own defaults stand.
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
 *
 * A day becomes a moment here, and a lead subtracts from it in this one place
 * — `withLead`, shared with `reminderAt` in `events.ts` — or the editor's
 * confirmation line and the alarm actually set would eventually disagree.
 * Whether the shifted moment has already gone by is left to the caller, which
 * already checks `at.getTime() <= now.getTime()` against whatever this
 * returns: that comparison now covers the shifted moment for free, which is
 * what makes a lead landing in the past schedule nothing.
 */
export function fireAt(entry: Entry): Date | null {
  if (entry.kind !== 'event') return null
  if (done(entry)) return null
  if (entry.occurred_at !== null) return withLead(entry, new Date(entry.occurred_at))

  const [year, month, day] = entry.occurred_on.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  return withLead(entry, new Date(year, month - 1, day, ALL_DAY_HOUR, 0, 0, 0))
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
  on?: { weekday?: number; day?: number; hour: number; minute: number }
}

/**
 * The six follow-up rings a nagged entry owns, ten minutes apart.
 *
 * Bounded, because unbounded nagging is how an app gets muted. Opt-in per
 * event as `data.nag`, off by default — nothing sums it, so no column and no
 * migration, the same rule `data.done` follows.
 */
const NAG_STEPS = [1, 2, 3, 4, 5, 6] as const

function nagged(entry: Entry): boolean {
  return entry.data.nag === true
}

function nagId(uuid: string, step: number): number {
  return notificationId(`${uuid}#nag${step}`)
}

/**
 * The follow-ups chase the ring, not the calendar: each sits ten minutes after
 * the moment the base alarm fires — the lead-shifted one, or the two would
 * drift apart on any entry reminded early. Past steps are dropped rather than
 * scheduled behind you, which is what lets a launch mid-run keep the rest of a
 * one-off's chase alive instead of ringing for minutes already gone.
 */
function followUps(entry: Entry, anchor: Date, now: Date): Alarm[] {
  if (!nagged(entry)) return []
  return NAG_STEPS.map((step) => ({
    id: nagId(entry.id, step),
    at: new Date(anchor.getTime() + step * 10 * 60_000),
  })).filter((alarm) => alarm.at.getTime() > now.getTime())
}

/**
 * Which button a nagged entry's notifications carry, or none when it does not
 * nag. This is the contract the App handler dispatches on: `done` marks the
 * row, and a repeat — which deliberately cannot be marked done, since `done`
 * sits on the row and would silence every future occurrence — gets `got_it`,
 * which only cancels today's remaining follow-ups.
 */
export function actionType(entry: Entry): 'done' | 'got_it' | undefined {
  if (!nagged(entry)) return undefined
  return recurring(entry) ? 'got_it' : 'done'
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

    const planned = weekly.map((day) => {
      const id = notificationId(`${entry.id}#${day}`)
      const soonest = nextFiring(day, now, hour, minute)
      const early = start !== null && soonest < start

      // Capacitor counts Sunday as 1, `Date.getDay()` counts it as 0.
      if (!early) return { alarm: { id, on: { weekday: day + 1, hour, minute } }, soonest }
      const held = firstFall(day, start, hour, minute)
      return { alarm: { id, at: held }, soonest: held }
    })

    // The crons stay exactly as they were; a nag layers six one-offs onto the
    // *next* occurrence only — whichever weekday comes round first — and the
    // launch re-arm converges on the one after, the yearly shape. The repeat
    // itself is never expanded into one-offs.
    const next = planned.reduce((a, b) => (a.soonest <= b.soonest ? a : b)).soonest
    return [...planned.map((p) => p.alarm), ...followUps(entry, next, now)]
  }

  /**
   * A monthly repeat on days 1–28 is one OS cron, `on: { day, hour, minute }`,
   * held back behind its start date exactly the way the weekly crons are. Days
   * 29–31 are not: what `on: { day: 31 }` does in February is the OS's secret,
   * and a wrong-day ring is the one thing this app must never produce — so
   * those arm like the yearly branch instead, a one-off at the next real
   * occurrence (`nextOccurrence` already skips the short months) that `sync`
   * re-arms on every launch under the same id.
   */
  const monthDay = monthlyDay(entry)
  if (monthDay !== null) {
    const at = entry.occurred_at === null ? null : new Date(entry.occurred_at)
    const hour = at?.getHours() ?? ALL_DAY_HOUR
    const minute = at?.getMinutes() ?? 0
    const id = notificationId(entry.id)

    const next = nextOccurrence(entry, now)
    if (next === null) return []
    const when = new Date(next)
    when.setHours(hour, minute, 0, 0)

    if (monthDay <= 28) {
      const soonest = new Date(now.getFullYear(), now.getMonth(), monthDay, hour, minute)
      if (soonest.getTime() <= now.getTime()) soonest.setMonth(soonest.getMonth() + 1)
      const start = localDay(entry.occurred_on)
      if (start === null || soonest >= start)
        return [{ id, on: { day: monthDay, hour, minute } }, ...followUps(entry, soonest, now)]
    }
    return [{ id, at: when }, ...followUps(entry, when, now)]
  }

  /**
   * A birthday is armed for its *next* occurrence, not for the date on the row.
   *
   * `fireAt` answers with the stored date, which for an anniversary is almost
   * always in the past — so `alarms` returned nothing and a yearly reminder was
   * never scheduled at all. Everything else about it worked, which is what made
   * it invisible: the bell listed it, the day it lands on drew it, the .ics
   * carried `RRULE:FREQ=YEARLY`, and the README promised "9am on the day, every
   * year". Only the notification, the one part that has to work, was missing.
   *
   * A one-off at the next occurrence rather than a yearly cron, deliberately:
   * `{ at }` is the mechanism already proven here, and `sync` re-arms it on
   * every launch under the same id — the same converge-on-next-launch shape the
   * held-back weekday crons use. An app opened once a year would drift; one
   * that prompts twice a day does not.
   */
  if (entry.data.rrule === 'FREQ=YEARLY') {
    const next = nextOccurrence(entry, now)
    if (next === null) return []

    const clock = entry.occurred_at === null ? null : new Date(entry.occurred_at)
    const when = new Date(next)
    when.setHours(clock?.getHours() ?? ALL_DAY_HOUR, clock?.getMinutes() ?? 0, 0, 0)

    // A lead applies to the *next* occurrence, not the stored date — a
    // birthday's own date is almost always in the past, and shifting that
    // would answer with a moment from a year no reminder should fire in.
    const shifted = withLead(entry, when)
    if (shifted.getTime() <= now.getTime()) return []

    return [{ id: notificationId(entry.id), at: shifted }, ...followUps(entry, shifted, now)]
  }

  const at = fireAt(entry)
  if (at === null) return []
  // The base alarm goes only while its moment is ahead; a nag's still-future
  // follow-ups survive it passing, so opening the app mid-run does not silence
  // the chase the run exists for.
  const base = at.getTime() > now.getTime() ? [{ id: notificationId(entry.id), at }] : []
  return [...base, ...followUps(entry, at, now)]
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
    ...NAG_STEPS.map((step) => nagId(entry.id, step)),
  ]
}

/**
 * The two buttons a nagged notification can carry, registered once. Latched
 * like `channels`, and for the same reason: elsewhere every attempt throws
 * identically for ever, and a notification without its button still rings.
 */
let actioned = false

async function actionTypes(api: LocalNotificationsPlugin): Promise<void> {
  if (actioned) return
  try {
    await api.registerActionTypes({
      types: [
        { id: 'done', actions: [{ id: 'done', title: 'Done' }] },
        { id: 'got_it', actions: [{ id: 'got_it', title: 'Got it' }] },
      ],
    })
  } catch {
    // Not a platform with action buttons. The reminder itself still fires.
  }
  actioned = true
}

function notification(entry: Entry, alarm: Alarm) {
  const action = actionType(entry)
  return {
    id: alarm.id,
    title: entry.title,
    body: `${PRODUCT.name} reminder`,
    channelId: REMINDERS,
    // Every notification of a nagged entry carries the button, the base ring
    // included — ending the run from the first ring is the point of it.
    ...(action === undefined ? {} : { actionTypeId: action }),
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
  await actionTypes(found.api)
  await found.api.schedule({
    notifications: due.map((alarm) => notification(entry, alarm)),
  })

  return 'scheduled'
}

/**
 * Turns the daily prompts on or off, and re-arms the evening window.
 *
 * Cancelled first either way: rescheduling an existing id replaces it on
 * Android but not everywhere, and two copies of a 9am prompt is exactly the
 * kind of thing that gets notifications switched off for good. Since the
 * evening ids are rebuilt on every launch and every pause, that cancel is also
 * what keeps a stale figure from outliving the day it describes.
 */
export async function scheduleNudges(
  on: boolean,
  recap: Recap = GENERIC,
  now: Date = new Date(),
): Promise<ScheduleResult> {
  const found = await plugin()
  if (!found) return 'skipped'

  await found.api.cancel({ notifications: NUDGE_IDS.map((id) => ({ id })) })
  if (!on) return 'skipped'

  if ((await permission()) !== 'granted') return 'blocked'

  await channels(found.api)
  await found.api.schedule({
    notifications: [
      {
        id: MORNING.id,
        title: MORNING.title,
        body: MORNING.body,
        channelId: PROMPTS,
        schedule: { on: { hour: MORNING.hour, minute: 0 }, allowWhileIdle: true },
      },
      ...nights(now).map(({ id, at, today }) => ({
        id,
        title: today ? recap.title : GENERIC.title,
        body: today ? recap.body : GENERIC.body,
        channelId: PROMPTS,
        schedule: { at, allowWhileIdle: true },
      })),
    ],
  })

  return 'scheduled'
}

/**
 * The evenings worth arming, soonest first.
 *
 * Tonight is dropped once 9pm has gone by — the OS treats a past `at` as due
 * immediately, which would fire the recap the moment the app was opened. Only
 * the night that is actually today may carry figures; the others are armed
 * before the days they describe have happened.
 */
function nights(now: Date): { id: number; at: Date; today: boolean }[] {
  const tonight = new Date(now)
  tonight.setHours(RECAP_HOUR, 0, 0, 0)
  // The OS treats a past `at` as due immediately, which would fire the recap
  // the moment the app was opened, so a gone 9pm starts the window tomorrow.
  const first = tonight.getTime() > now.getTime() ? 0 : 1

  return RECAP_IDS.map((id, index) => {
    const at = new Date(tonight)
    at.setDate(at.getDate() + first + index)
    return { id, at, today: first + index === 0 }
  })
}

export async function cancel(entry: Entry): Promise<void> {
  const found = await plugin()
  if (!found) return
  await found.api.cancel({ notifications: alarmIds(entry).map((id) => ({ id })) })
}

/**
 * "Got it": today's remaining follow-ups, and nothing else.
 *
 * Pure alarm cancellation — no row state, so a repeat's future occurrences
 * are untouched, and its standing crons are not in this list to begin with.
 */
export async function cancelFollowUps(entry: Entry): Promise<void> {
  const found = await plugin()
  if (!found) return
  await found.api.cancel({
    notifications: NAG_STEPS.map((step) => ({ id: nagId(entry.id, step) })),
  })
}

/**
 * Everything this app has armed, cancelled — entry alarms, follow-ups and the
 * daily prompts alike. Sign-out is the caller: a weekly repeat is a standing
 * cron the OS keeps for ever, so without this a signed-out phone went on
 * raising the account's entry titles to whoever was holding it.
 */
export async function cancelAll(): Promise<void> {
  const found = await plugin()
  if (!found) return
  try {
    const pending = await found.api.getPending()
    if (pending.notifications.length === 0) return
    await found.api.cancel({
      notifications: pending.notifications.map((armed) => ({ id: armed.id })),
    })
  } catch {
    // Best effort: a sign-out must never fail over a notification.
  }
}

/**
 * Delivers a notification's button press to the app. Capacitor wakes the app
 * briefly in the background to run this — that is how the event reaches JS —
 * so the handler must not assume anything is on screen.
 */
export async function onAction(
  handle: (action: 'done' | 'got_it', id: number) => void,
): Promise<void> {
  const found = await plugin()
  if (!found) return
  await found.api.addListener('localNotificationActionPerformed', (fired) => {
    const action = fired.actionId
    if (action === 'done' || action === 'got_it') handle(action, fired.notification.id)
  })
}

/**
 * What a re-arm ended as. `stale` is the one outcome `schedule` cannot produce:
 * the entry wants no alarm any more and the old one could not be cleared, so
 * something is still going to ring for a row that should be silent.
 */
export type RearmResult = ScheduleResult | 'stale'

/**
 * An edited entry's alarms, replaced.
 *
 * **Cancelling is best effort and must never decide whether the new alarm is
 * set.** Chained as `cancel().then(schedule)`, a cancel that rejected skipped
 * the schedule altogether — so the failure that merely *might* leave an extra
 * notification instead reliably lost the reminder the user had just edited,
 * which is the worse of the two by a distance and the one nobody would notice.
 *
 * Scheduling after a failed cancel is safe rather than noisy: the ids come from
 * the entry, so re-scheduling replaces each alarm in place rather than adding a
 * second copy. Only an id the *new* plan has dropped — a weekday removed from a
 * standup — can survive, and launch reconciliation in `sync` is what already
 * exists to clear those.
 *
 * `stale` therefore means the narrow case where nothing replaces anything: the
 * entry schedules nothing now, and the old alarms are still armed.
 */
export async function rearm(entry: Entry, now: Date): Promise<RearmResult> {
  const found = await plugin()
  if (!found) return 'skipped'

  let cleared = true
  try {
    await found.api.cancel({ notifications: alarmIds(entry).map((id) => ({ id })) })
  } catch {
    cleared = false
  }

  // Left to throw. A reminder that could not be set has to say so — that is
  // the whole reason these paths report anything at all.
  const result = await schedule(entry, now)
  return !cleared && result === 'skipped' ? 'stale' : result
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
      .filter((id) => !wanted.has(id) && !NUDGE_IDS.includes(id))

    if (stale.length > 0) {
      await found.api.cancel({ notifications: stale.map((id) => ({ id })) })
    }
  } catch {
    // Not worth abandoning the re-arm below over.
  }

  if (due.length === 0) return

  await channels(found.api)
  await actionTypes(found.api)
  await found.api.schedule({
    notifications: due.flatMap((planned) =>
      planned.alarms.map((alarm) => notification(planned.entry, alarm)),
    ),
  })
}
