import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  actionType,
  alarmIds,
  alarms,
  cancelAll,
  fireAt,
  notificationId,
  schedule,
  scheduleNudges,
} from './reminders'
import { GENERIC } from './recap'
import { isNative } from './platform'
import type { Entry } from '../types'

const getPending = vi.fn()
const cancelled = vi.fn()
const checkPermissions = vi.fn()
const createChannel = vi.fn()
const deleteChannel = vi.fn()
const scheduled = vi.fn()
const registerActionTypes = vi.fn()

vi.mock('./platform', () => ({ isNative: vi.fn(() => false) }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: (...args: unknown[]) => getPending(...args),
    cancel: (...args: unknown[]) => cancelled(...args),
    checkPermissions: (...args: unknown[]) => checkPermissions(...args),
    createChannel: (...args: unknown[]) => createChannel(...args),
    deleteChannel: (...args: unknown[]) => deleteChannel(...args),
    schedule: (...args: unknown[]) => scheduled(...args),
    registerActionTypes: (...args: unknown[]) => registerActionTypes(...args),
  },
}))

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'event',
    occurred_on: '2026-09-02',
    occurred_at: null,
    title: 'ping',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
    ...over,
  }
}

describe('notificationId', () => {
  it('is stable for the same uuid, or a reminder could never be cancelled', () => {
    const uuid = 'd8f9e44f-fd15-480b-8f7b-5815d44e6b15'
    expect(notificationId(uuid)).toBe(notificationId(uuid))
  })

  it('differs between uuids', () => {
    expect(notificationId('a1b2c3d4-0000-0000-0000-000000000001')).not.toBe(
      notificationId('a1b2c3d4-0000-0000-0000-000000000002'),
    )
  })

  it('stays a positive 32-bit integer, which is what the plugin accepts', () => {
    for (const uuid of [
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '00000000-0000-0000-0000-000000000000',
      'd8f9e44f-fd15-480b-8f7b-5815d44e6b15',
      '85e0055d-4ee2-487f-9920-f45ed0ee6e5e',
    ]) {
      const id = notificationId(uuid)
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThan(0)
      expect(id).toBeLessThan(2_147_483_648)
    }
  })
})

describe('fireAt', () => {
  it('uses the clock time when there is one', () => {
    const at = fireAt(entry({ id: 'a', occurred_at: '2026-09-02T17:00:00+05:30' }))
    expect(at?.getHours()).toBe(17)
    expect(at?.getMinutes()).toBe(0)
  })

  it('falls back to 9am local for an all-day event', () => {
    const at = fireAt(entry({ id: 'a', occurred_on: '2026-11-14' }))
    expect(at?.getFullYear()).toBe(2026)
    expect(at?.getMonth()).toBe(10)
    expect(at?.getDate()).toBe(14)
    expect(at?.getHours()).toBe(9)
  })

  it('ignores anything that is not an event', () => {
    for (const kind of ['expense', 'time', 'note'] as const) {
      expect(fireAt(entry({ id: 'a', kind, occurred_at: '2026-09-02T17:00:00+05:30' }))).toBeNull()
    }
  })

  it('is pulled back by a lead — the day becomes a moment here, and the shift happens in the same place', () => {
    const timed = fireAt(
      entry({ id: 'a', occurred_at: '2026-09-02T17:00:00+05:30', data: { lead: 30 } }),
    )
    expect(timed?.getHours()).toBe(16)
    expect(timed?.getMinutes()).toBe(30)

    const allDay = fireAt(entry({ id: 'a', occurred_on: '2026-11-14', data: { lead: 60 * 24 } }))
    expect(allDay?.getDate()).toBe(13)
    expect(allDay?.getHours()).toBe(9)
  })
})

describe('a lead landing in the past', () => {
  it('schedules nothing — the caller compares against the shifted moment, not the stored one', () => {
    // The event is tomorrow morning; a two-day lead has already gone by.
    const now = new Date(2026, 8, 1, 10, 0)
    const row = entry({
      id: 'a',
      occurred_at: '2026-09-02T09:00:00+05:30',
      data: { lead: 60 * 24 * 2 },
    })
    expect(alarms(row, now)).toEqual([])
  })

  it('still arms once the shifted moment is far enough ahead', () => {
    const now = new Date(2026, 8, 1, 10, 0)
    const row = entry({ id: 'a', occurred_at: '2026-09-05T09:00:00+05:30', data: { lead: 60 * 24 } })
    const due = alarms(row, now)
    expect(due).toHaveLength(1)
    expect(due[0]?.at?.getDate()).toBe(4)
  })
})

describe('a reminder that has been ticked off', () => {
  it('does not fire', () => {
    // Otherwise "call mom" rings at five to remind you of something you did at
    // three, which is worse than no reminder: it teaches you to ignore them.
    const row = entry({
      id: 'ticked',
      occurred_on: '2026-09-20',
      occurred_at: '2026-09-20T17:00:00+05:30',
      data: { done: true },
    })
    expect(fireAt(row)).toBeNull()
  })

  it('still fires while it is not', () => {
    const row = entry({
      id: 'live',
      occurred_on: '2026-09-20',
      occurred_at: '2026-09-20T17:00:00+05:30',
    })
    expect(fireAt(row)).not.toBeNull()
  })
})

describe('the ids the daily prompts own', () => {
  it('are never produced for a row', () => {
    // The two prompts hold ids 1 and 2. If a row could hash onto one, logging
    // an entry would silently replace a prompt, or the prompt would replace it.
    const ids = new Set<number>()
    for (let n = 0; n < 20_000; n += 1) {
      ids.add(notificationId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`))
    }
    expect([...ids].every((id) => id >= 8)).toBe(true)
  })

  it('still hashes the same uuid to the same id', () => {
    // Or a reminder could never be cancelled again.
    expect(notificationId('abc')).toBe(notificationId('abc'))
    expect(notificationId('abc')).not.toBe(notificationId('abd'))
  })
})

describe('a yearly repeat', () => {
  const birthday = (on: string) =>
    entry({ id: 'bday', occurred_on: on, title: 'deepak birthday', data: { rrule: 'FREQ=YEARLY' } })

  it('is armed for next year once this year has gone by', () => {
    // The bell, the day it lands on and the .ics all say a birthday recurs.
    // The alarm did not: `fireAt` returns the date on the row, so a birthday
    // logged in February was simply in the past by March and nothing was ever
    // scheduled again — the one part of a recurring reminder that has to work.
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(birthday('2010-02-13'), now)

    expect(due).toHaveLength(1)
    expect(due[0]?.at?.getFullYear()).toBe(2027)
    expect(due[0]?.at?.getMonth()).toBe(1)
    expect(due[0]?.at?.getDate()).toBe(13)
    expect(due[0]?.at?.getHours()).toBe(9)
  })

  it('keeps this year while the day is still ahead', () => {
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(birthday('2010-11-14'), now)

    expect(due[0]?.at?.getFullYear()).toBe(2026)
    expect(due[0]?.at?.getMonth()).toBe(10)
  })

  it('keeps the id it always had, so the launch re-arm replaces rather than doubles', () => {
    const now = new Date(2026, 8, 11, 14, 30)
    expect(alarms(birthday('2010-02-13'), now)[0]?.id).toBe(notificationId('bday'))
  })

  it('stays silent once it is ticked off', () => {
    const now = new Date(2026, 8, 11, 14, 30)
    const finished = entry({
      id: 'bday',
      occurred_on: '2010-02-13',
      data: { rrule: 'FREQ=YEARLY', done: true },
    })
    expect(alarms(finished, now)).toEqual([])
  })

  it('applies a lead to the next occurrence, not the stored date', () => {
    // A birthday's own date is nearly always in the past — shifting that would
    // answer with a moment from a year no reminder should fire in.
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(
      entry({
        id: 'bday',
        occurred_on: '2010-02-13',
        data: { rrule: 'FREQ=YEARLY', lead: 60 * 24 },
      }),
      now,
    )
    expect(due).toHaveLength(1)
    expect(due[0]?.at?.getFullYear()).toBe(2027)
    expect(due[0]?.at?.getDate()).toBe(12)
  })

  it('drops a yearly lead once the shifted moment, not just the occurrence, has gone by', () => {
    // Nine days out; a two-week lead has already passed even though the
    // birthday itself has not.
    const now = new Date(2026, 8, 11, 14, 30)
    const due = alarms(
      entry({
        id: 'bday',
        occurred_on: '2010-09-20',
        data: { rrule: 'FREQ=YEARLY', lead: 60 * 24 * 14 },
      }),
      now,
    )
    expect(due).toEqual([])
  })
})

describe('when a weekly repeat has not begun yet', () => {
  // Thursday 10 September 2026, twenty past ten at night.
  const NOW = new Date(2026, 8, 10, 22, 20, 0)
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }
  const ten = (day: string) => `${day}T10:00:00+05:30`

  /** The weekdays armed as a standing cron, as `Date.getDay()` numbers. */
  const crons = (armed: ReturnType<typeof alarms>) =>
    armed.filter((a) => a.on !== undefined).map((a) => (a.on?.weekday ?? 0) - 1)

  const oneOffs = (armed: ReturnType<typeof alarms>) =>
    armed.filter((a) => a.at !== undefined).map((a) => a.at?.toDateString())

  it('holds back only the weekdays whose cron would fire before the start', () => {
    // Set up on Thursday to start on Monday the 14th. A bare weekday cron
    // fires on the next matching day, so Friday's would have gone off on the
    // 11th — three days before the standup begins.
    const row = entry({
      id: 'r1',
      occurred_on: '2026-09-14',
      occurred_at: ten('2026-09-14'),
      data: weekdays,
    })
    const armed = alarms(row, NOW)

    expect(armed).toHaveLength(5)
    expect(crons(armed).sort()).toEqual([1, 2, 3, 4])
    expect(oneOffs(armed)).toEqual(['Fri Sep 18 2026'])
  })

  /**
   * A two-day repeat rings twice a week, not once.
   *
   * The parser could not express `every tuesday and thursday` until now — it
   * kept one day and dropped the other — so this scheduling path had never been
   * exercised with anything but a five-day rule or a single day. It arms one
   * cron per named weekday, which is the whole reason the fix was a parser
   * change and nothing more.
   */
  it('arms one alarm for each named weekday, not one for the entry', () => {
    const row = entry({
      id: 'r-two-day',
      occurred_on: '2026-09-15',
      occurred_at: ten('2026-09-15'),
      data: { rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' },
    })
    const armed = alarms(row, NOW)

    expect(armed).toHaveLength(2)
    // Tuesday and Thursday, as `Date.getDay()` numbers.
    expect(crons(armed).sort()).toEqual([2, 4])
    expect(oneOffs(armed)).toEqual([])
    // Distinct ids, or the second weekday would replace the first.
    expect(new Set(armed.map((a) => a.id)).size).toBe(2)
  })

  it('leaves the ordinary case as five standing crons', () => {
    // Typed today, landing on tomorrow: nothing would fire early, so nothing
    // is held back. Turning these into one-offs would stop the repeat after a
    // week for anyone who did not reopen the app.
    const row = entry({
      id: 'r2',
      occurred_on: '2026-09-11',
      occurred_at: ten('2026-09-11'),
      data: weekdays,
    })
    const armed = alarms(row, NOW)

    expect(crons(armed).sort()).toEqual([1, 2, 3, 4, 5])
    expect(oneOffs(armed)).toEqual([])
  })

  it('keeps the same ids either way, so a later launch can swap them over', () => {
    const early = entry({ id: 'r3', occurred_on: '2026-09-21', data: weekdays })
    const begun = entry({ id: 'r3', occurred_on: '2026-09-01', data: weekdays })
    expect(alarms(early, NOW).map((a) => a.id)).toEqual(alarms(begun, NOW).map((a) => a.id))
  })

  it('starts a whole future week as one-offs, since every cron would be early', () => {
    const row = entry({ id: 'r4', occurred_on: '2026-09-21', data: weekdays })
    const armed = alarms(row, NOW)
    expect(crons(armed)).toEqual([])
    expect(oneOffs(armed)).toHaveLength(5)
  })
})

describe('a nag that rings until acted on', () => {
  // Thursday 10 September 2026, nine in the morning.
  const NOW = new Date(2026, 8, 10, 9, 0, 0)
  const at = (day: string, clock: string) => `${day}T${clock}:00+05:30`

  it('arms the reminder plus six follow-ups, ten minutes apart', () => {
    const row = entry({
      id: 'n1',
      occurred_on: '2026-09-10',
      occurred_at: at('2026-09-10', '17:00'),
      data: { nag: true },
    })
    const armed = alarms(row, NOW)

    expect(armed).toHaveLength(7)
    const times = armed.map((alarm) => alarm.at?.getTime() ?? 0)
    for (let step = 1; step <= 6; step += 1) {
      expect(times[step]! - times[0]!).toBe(step * 10 * 60_000)
    }
  })

  it('changes nothing without the opt-in', () => {
    const row = entry({
      id: 'n1',
      occurred_on: '2026-09-10',
      occurred_at: at('2026-09-10', '17:00'),
    })
    expect(alarms(row, NOW)).toHaveLength(1)
  })

  it('stays silent once ticked off — the same choke point every alarm obeys', () => {
    const row = entry({
      id: 'n1',
      occurred_on: '2026-09-10',
      occurred_at: at('2026-09-10', '17:00'),
      data: { nag: true, done: true },
    })
    expect(alarms(row, NOW)).toEqual([])
  })

  it('keeps the still-future follow-ups once the moment itself has passed', () => {
    // 8:35 against a 9:00 clock: the base ring and two follow-ups are gone,
    // the four still ahead survive a mid-run launch.
    const row = entry({
      id: 'n1',
      occurred_on: '2026-09-10',
      occurred_at: at('2026-09-10', '08:35'),
      data: { nag: true },
    })
    const armed = alarms(row, NOW)
    expect(armed).toHaveLength(4)
    expect(armed.every((alarm) => alarm.at !== undefined && alarm.at > NOW)).toBe(true)
  })

  it('sweeps with the entry: every follow-up id is one alarmIds already covers', () => {
    const nagged = entry({
      id: 'n1',
      occurred_on: '2026-09-10',
      occurred_at: at('2026-09-10', '17:00'),
      data: { nag: true },
    })
    const covered = new Set(alarmIds(nagged))
    for (const alarm of alarms(nagged, NOW)) expect(covered.has(alarm.id)).toBe(true)

    // Toggled off, a reschedule arms none of them — the cancel side of the
    // rearm swept the six ids above, and nothing here puts them back.
    const calmed = entry({ ...nagged, data: {} })
    const nagIds = alarms(nagged, NOW)
      .slice(1)
      .map((alarm) => alarm.id)
    for (const alarm of alarms(calmed, NOW)) expect(nagIds.includes(alarm.id)).toBe(false)
  })

  it("layers the chase onto a repeat's next occurrence and leaves the crons standing", () => {
    const row = entry({
      id: 'n2',
      occurred_on: '2026-09-01',
      occurred_at: at('2026-09-01', '10:00'),
      data: { rrule: 'FREQ=WEEKLY;BYDAY=TU,TH', nag: true },
    })
    const armed = alarms(row, NOW)

    const crons = armed.filter((alarm) => alarm.on !== undefined)
    const oneOffs = armed.filter((alarm) => alarm.at !== undefined)
    expect(crons).toHaveLength(2)
    expect(oneOffs).toHaveLength(6)
    // Anchored on the soonest firing — this Thursday at ten — not next week's.
    expect(oneOffs[0]?.at?.getDate()).toBe(10)
    expect(oneOffs[0]?.at?.getHours()).toBe(10)
    expect(oneOffs[0]?.at?.getMinutes()).toBe(10)
  })

  it('carries done on a one-off and got_it on a repeat, and nothing otherwise', () => {
    const oneOff = entry({ id: 'n1', data: { nag: true } })
    const repeat = entry({ id: 'n2', data: { rrule: 'FREQ=YEARLY', nag: true } })
    const plain = entry({ id: 'n3' })
    expect(actionType(oneOff)).toBe('done')
    expect(actionType(repeat)).toBe('got_it')
    expect(actionType(plain)).toBeUndefined()
  })
})

describe('the notification channels', () => {
  afterEach(() => {
    vi.mocked(isNative).mockReturnValue(false)
  })

  it('creates both channels lock-screen private and deletes both v1s (spec 047)', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    checkPermissions.mockResolvedValue({ display: 'granted' })
    scheduled.mockResolvedValue(undefined)

    const now = new Date('2026-09-01T10:00:00+05:30')
    const result = await schedule(
      entry({ id: 'chan-1', occurred_at: '2026-09-02T17:00:00+05:30' }),
      now,
    )

    expect(result).toBe('scheduled')
    expect(deleteChannel).toHaveBeenCalledWith({ id: 'lifelog-reminders-v1' })
    // The prompts channel joined the migration once the recap put an amount on
    // it: a channel cannot be edited after creation, so the id is the only fix.
    expect(deleteChannel).toHaveBeenCalledWith({ id: 'lifelog-prompts-v1' })

    const created = createChannel.mock.calls.map(
      (call) => call[0] as { id: string; visibility: number },
    )
    expect(created.find((channel) => channel.id === 'lifelog-reminders-v2')?.visibility).toBe(0)
    expect(created.find((channel) => channel.id === 'lifelog-prompts-v2')?.visibility).toBe(0)
    expect(created.some((channel) => channel.id === 'lifelog-prompts-v1')).toBe(false)

    const sent = (scheduled.mock.calls[0]?.[0] as { notifications: { channelId: string }[] })
      .notifications
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((alarm) => alarm.channelId === 'lifelog-reminders-v2')).toBe(true)
  })
})

describe('cancelAll', () => {
  afterEach(() => {
    getPending.mockReset()
    cancelled.mockReset()
    vi.mocked(isNative).mockReturnValue(false)
  })

  it('cancels every pending id, the daily prompts included', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    getPending.mockResolvedValue({ notifications: [{ id: 1 }, { id: 2 }, { id: 424242 }] })

    await cancelAll()

    expect(cancelled).toHaveBeenCalledWith({
      notifications: [{ id: 1 }, { id: 2 }, { id: 424242 }],
    })
  })

  it('does nothing when nothing is pending', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    getPending.mockResolvedValue({ notifications: [] })

    await cancelAll()
    expect(cancelled).not.toHaveBeenCalled()
  })

  it('never reaches for the plugin away from the native shell', async () => {
    await cancelAll()
    expect(getPending).not.toHaveBeenCalled()
  })

  it('resolves even when the plugin throws — a sign-out must not fail over a notification', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    getPending.mockRejectedValue(new Error('no bridge'))
    await expect(cancelAll()).resolves.toBeUndefined()
  })
})

describe('a monthly repeat arms (spec 041)', () => {
  const NOW = new Date(2026, 8, 10, 9, 0, 0)
  const monthly = (day: number) => ({ rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}` })

  it('is one standing cron on a day every month has', () => {
    const row = entry({
      id: 'monthly-cron',
      occurred_on: '2026-09-12',
      occurred_at: '2026-09-12T19:00:00+05:30',
      data: monthly(12),
    })
    const armed = alarms(row, NOW)
    expect(armed).toHaveLength(1)
    const at = new Date('2026-09-12T19:00:00+05:30')
    expect(armed[0]).toEqual({
      id: notificationId('monthly-cron'),
      on: { day: 12, hour: at.getHours(), minute: at.getMinutes() },
    })
  })

  it('holds back behind a start still ahead, as the weekly crons do', () => {
    const row = entry({ id: 'monthly-held', occurred_on: '2026-11-12', data: monthly(12) })
    expect(alarms(row, NOW)).toEqual([
      { id: notificationId('monthly-held'), at: new Date(2026, 10, 12, 9, 0, 0, 0) },
    ])
  })

  it('arms the 31st as a one-off at the next month that has one', () => {
    const row = entry({ id: 'monthly-31', occurred_on: '2027-01-31', data: monthly(31) })
    expect(alarms(row, new Date(2027, 1, 10, 9, 0, 0))).toEqual([
      { id: notificationId('monthly-31'), at: new Date(2027, 2, 31, 9, 0, 0, 0) },
    ])
  })
})

describe('the daily prompts (spec 046)', () => {
  type Sent = {
    id: number
    title: string
    body: string
    channelId: string
    schedule: { at?: Date; on?: { hour: number } }
  }

  afterEach(() => {
    scheduled.mockReset()
    cancelled.mockReset()
    vi.mocked(isNative).mockReturnValue(false)
  })

  // The last call, not the first: `scheduled` is module-level and earlier
  // describes in this file leave their own calls on it.
  function armed(): Sent[] {
    const calls = scheduled.mock.calls
    return (calls[calls.length - 1]?.[0] as { notifications: Sent[] }).notifications
  }

  const RECAP = { title: '₹680 · 6h 20m · 8 logged', body: 'Tomorrow: gym · 7:00 pm' }

  async function arm(now: Date, on = true) {
    vi.mocked(isNative).mockReturnValue(true)
    checkPermissions.mockResolvedValue({ display: 'granted' })
    scheduled.mockResolvedValue(undefined)
    return scheduleNudges(on, RECAP, now)
  }

  it('arms the morning cron plus six evenings, and never an id a row could hash onto', async () => {
    expect(await arm(new Date(2026, 9, 4, 10, 0, 0))).toBe('scheduled')

    const sent = armed()
    expect(sent.map((one) => one.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(sent[0]?.schedule.on?.hour).toBe(9)
    expect(sent.slice(1).every((one) => one.schedule.at instanceof Date)).toBe(true)
  })

  it("carries the figures on tonight alone — the other nights have not happened yet", async () => {
    await arm(new Date(2026, 9, 4, 10, 0, 0))

    const evenings = armed().slice(1)
    expect(evenings[0]?.title).toBe(RECAP.title)
    expect(evenings[0]?.body).toBe(RECAP.body)
    expect(evenings.slice(1).every((one) => one.title === GENERIC.title)).toBe(true)
  })

  it('starts tomorrow once 9pm has gone by, since a past moment is due immediately', async () => {
    await arm(new Date(2026, 9, 4, 22, 0, 0))

    const evenings = armed().slice(1)
    expect(evenings[0]?.schedule.at?.getDate()).toBe(5)
    // Nothing may claim to be tonight's recap on a night already spent.
    expect(evenings.every((one) => one.title === GENERIC.title)).toBe(true)
  })

  it('arms each evening at 9pm on its own day, six nights running', async () => {
    await arm(new Date(2026, 9, 4, 10, 0, 0))

    const at = armed()
      .slice(1)
      .map((one) => one.schedule.at as Date)
    expect(at.map((moment) => moment.getDate())).toEqual([4, 5, 6, 7, 8, 9])
    expect(at.every((moment) => moment.getHours() === 21 && moment.getMinutes() === 0)).toBe(true)
  })

  it('cancels all seven first, so a re-arm replaces rather than doubles', async () => {
    await arm(new Date(2026, 9, 4, 10, 0, 0))
    expect(cancelled).toHaveBeenCalledWith({
      notifications: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id })),
    })
  })

  it('cancels the whole window and arms nothing when the prompts are off', async () => {
    expect(await arm(new Date(2026, 9, 4, 10, 0, 0), false)).toBe('skipped')
    expect(cancelled).toHaveBeenCalledWith({
      notifications: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id })),
    })
    expect(scheduled).not.toHaveBeenCalled()
  })

  it('puts every prompt on the private channel, the morning one included (spec 047)', async () => {
    await arm(new Date(2026, 9, 4, 10, 0, 0))

    const sent = armed()
    expect(sent).toHaveLength(7)
    expect(sent.every((one) => one.channelId === 'lifelog-prompts-v2')).toBe(true)
    expect(sent.some((one) => one.channelId === 'lifelog-prompts-v1')).toBe(false)
  })

  it('never schedules a recap carrying figures onto the public legacy channel (spec 047)', async () => {
    await arm(new Date(2026, 9, 4, 10, 0, 0))

    // The acceptance criterion, asserted on the notification that holds the
    // amount rather than inferred from the constant it was built from.
    const figured = armed().filter((one) => one.title === RECAP.title)
    expect(figured).toHaveLength(1)
    expect(figured[0]?.channelId).toBe('lifelog-prompts-v2')
  })

  it('reports blocked without permission, rather than silently arming nothing', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    checkPermissions.mockResolvedValue({ display: 'denied' })
    expect(await scheduleNudges(true, RECAP, new Date(2026, 9, 4, 10, 0, 0))).toBe('blocked')
    expect(scheduled).not.toHaveBeenCalled()
  })

  it('never reaches for the plugin away from the native shell', async () => {
    expect(await scheduleNudges(true, RECAP, new Date(2026, 9, 4, 10, 0, 0))).toBe('skipped')
    expect(scheduled).not.toHaveBeenCalled()
  })
})
