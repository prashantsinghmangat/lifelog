import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from '../types'

/**
 * The re-arm, driven through a plugin that fails.
 *
 * These are not assertions about a mock. The plugin is the boundary the app
 * cannot control — a native call that rejects is exactly what the emulator
 * produced — and what is under test is `reminders.ts`'s own handling of it:
 * whether the new alarm is still set when the old one could not be cleared,
 * what outcome the caller is given, and whether anything is left to reject into
 * nothing. Every one of those was wrong at least once.
 */

const calls: { cancelled: number[][]; scheduled: number[][] } = { cancelled: [], scheduled: [] }
let cancelFails = false
let scheduleFails = false
let granted = true

vi.mock('./platform', () => ({ isNative: () => true }))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: granted ? 'granted' : 'denied' }),
    requestPermissions: async () => ({ display: granted ? 'granted' : 'denied' }),
    createChannel: async () => undefined,
    getPending: async () => ({ notifications: [] }),
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      if (cancelFails) throw new Error('cancel failed on android')
      calls.cancelled.push(notifications.map((one) => one.id))
    },
    schedule: async ({ notifications }: { notifications: { id: number }[] }) => {
      if (scheduleFails) throw new Error('schedule failed on android')
      calls.scheduled.push(notifications.map((one) => one.id))
    },
  },
}))

const { alarmIds, notificationId, rearm } = await import('./reminders')

const NOW = new Date(2026, 8, 11, 9, 0)

function reminder(over: Partial<Entry> = {}): Entry {
  return {
    id: 'row-1',
    kind: 'event',
    occurred_on: '2026-09-11',
    occurred_at: '2026-09-11T17:00:00+05:30',
    title: 'dentist',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-11T08:00:00+05:30',
    ...over,
  }
}

beforeEach(() => {
  calls.cancelled = []
  calls.scheduled = []
  cancelFails = false
  scheduleFails = false
  granted = true
})

afterEach(() => vi.clearAllMocks())

describe('cancelling and scheduling both work', () => {
  it('clears every id the entry could have owned, then arms the new alarm', async () => {
    await expect(rearm(reminder(), NOW)).resolves.toBe('scheduled')

    expect(calls.cancelled[0]).toEqual(alarmIds(reminder()))
    expect(calls.scheduled[0]).toEqual([notificationId('row-1')])
  })

  it('arms one alarm per weekday for a repeat', async () => {
    const standup = reminder({
      occurred_on: '2026-09-07',
      occurred_at: '2026-09-07T10:00:00+05:30',
      data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    })
    await expect(rearm(standup, NOW)).resolves.toBe('scheduled')
    expect(calls.scheduled[0]).toHaveLength(5)
  })
})

describe('when cancelling fails', () => {
  it('still sets the new alarm, rather than losing it with the old one', async () => {
    // The bug this exists for: chained as cancel().then(schedule), a rejected
    // cancel skipped the schedule and the edited reminder was simply gone.
    cancelFails = true
    await expect(rearm(reminder(), NOW)).resolves.toBe('scheduled')
    expect(calls.scheduled[0]).toEqual([notificationId('row-1')])
  })

  it('does not double up, because the new alarm reuses the same id', async () => {
    cancelFails = true
    await rearm(reminder(), NOW)
    await rearm(reminder(), NOW)

    // Two passes, the same single id both times: the OS replaces rather than
    // adding a second copy, which is what makes scheduling after a failed
    // cancel safe instead of noisy.
    expect(calls.scheduled).toEqual([[notificationId('row-1')], [notificationId('row-1')]])
  })

  it('says so when there is nothing to replace the old alarm with', async () => {
    // Marked done: the entry wants no alarm at all now, and the old one could
    // not be cleared — so something really is still going to ring.
    cancelFails = true
    const finished = reminder({ data: { done: true } })
    await expect(rearm(finished, NOW)).resolves.toBe('stale')
    expect(calls.scheduled).toEqual([])
  })

  it('says so for an event demoted to a note, which is the same shape', async () => {
    // Nothing schedules for a note, and the alarm the row had as an event could
    // not be cleared — so it is still armed under a title that is not a
    // reminder any more.
    cancelFails = true
    await expect(rearm(reminder({ kind: 'note' }), NOW)).resolves.toBe('stale')
  })
})

describe('when scheduling fails', () => {
  it('rejects, so the caller can say the reminder did not happen', async () => {
    scheduleFails = true
    await expect(rearm(reminder(), NOW)).rejects.toThrow('schedule failed on android')
  })

  it('rejects even when the cancel failed too, rather than reporting success', async () => {
    cancelFails = true
    scheduleFails = true
    await expect(rearm(reminder(), NOW)).rejects.toThrow('schedule failed on android')
  })
})

describe('when notifications are not allowed', () => {
  it('reports blocked rather than pretending the alarm is set', async () => {
    granted = false
    await expect(rearm(reminder(), NOW)).resolves.toBe('blocked')
    expect(calls.scheduled).toEqual([])
  })
})
