// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, eachDayOfInterval, format, startOfWeek, subYears } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { dayKey } from './lib/format'
import type { ScheduleResult } from './lib/reminders'

/**
 * The journeys that only exist once everything is wired together: whether a
 * reminder reports what happened, and whether a delete can be taken back.
 *
 * Both were silent failures at some point — a blocked reminder that said
 * nothing, and a delete with no way out — so they are worth pinning here
 * rather than in a leaf component that cannot see them.
 */

type Result = { data?: unknown; error?: { message: string } | null }

let rowsOnServer: unknown[] = []
let scheduleResult: ScheduleResult = 'scheduled'
/** Every request rejects, which is what no network actually looks like. */
let unreachable = false

function builder() {
  let writing = false
  const self: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'is', 'gte', 'lte', 'order']) {
    self[name] = () => self
  }
  // One idempotent upsert per row is the only write the app makes now.
  for (const name of ['upsert']) {
    self[name] = () => {
      writing = true
      return self
    }
  }
  self['then'] = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => {
    if (unreachable) {
      return Promise.reject(new TypeError('Failed to fetch')).then(resolve, reject)
    }
    return Promise.resolve(
      writing ? { error: null } : { data: rowsOnServer, error: null },
    ).then(resolve)
  }
  return self
}

vi.mock('./lib/supabase', () => ({
  supabase: { from: () => builder(), auth: { signOut: vi.fn() } },
}))

vi.mock('./hooks/useSession', () => ({
  // An identity, not a session: the app runs for whoever this device belongs
  // to, which is not the same as whether Supabase can prove it right now.
  useSession: () => ({
    identity: { id: 'user-1', email: 'you@example.com' },
    loading: false,
  }),
}))

vi.mock('./lib/reminders', () => ({
  // Faithful to the real thing: only an event is ever scheduled, so an expense
  // must not overwrite its own confirmation with a reminder message.
  schedule: vi.fn(async (entry: { kind: string }) =>
    entry.kind === 'event' ? scheduleResult : 'skipped',
  ),
  cancel: vi.fn(async () => undefined),
  sync: vi.fn(async () => undefined),
  permission: vi.fn(async () => 'granted'),
  requestPermission: vi.fn(async () => true),
}))

afterEach(cleanup)

let ids = 0
beforeEach(() => {
  rowsOnServer = []
  scheduleResult = 'scheduled'
  unreachable = false
  ids = 0
  // The log persists between mounts now, so without this each test inherits the
  // previous one's entries.
  localStorage.clear()
  // jsdom always reports true; the offline tests below override it, and every
  // other test needs it back.
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => `local-${++ids}` })
  // jsdom implements neither, and useTheme reads matchMedia on mount.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
})

async function open() {
  render(<App />)
  const box = await screen.findByLabelText('What happened?')
  return box
}

describe('logging a reminder', () => {
  it('confirms with the time it will fire, not just that it saved', async () => {
    const box = await open()
    await userEvent.type(box, 'dentist tomorrow 5pm{Enter}')
    await waitFor(() => expect(screen.getByText(/Reminder set for/)).toBeTruthy())
  })

  it('says so when reminders are blocked, rather than appearing to work', async () => {
    scheduleResult = 'blocked'
    const box = await open()
    await userEvent.type(box, 'dentist tomorrow 5pm{Enter}')

    await waitFor(() =>
      expect(screen.getByText('Saved, but reminders are blocked')).toBeTruthy(),
    )
    // And the way to fix it appears, rather than leaving the user to guess.
    expect(screen.getByText(/Allow notifications/)).toBeTruthy()
  })

  it('confirms an ordinary entry without mentioning reminders', async () => {
    scheduleResult = 'skipped'
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')

    await waitFor(() => expect(screen.getByText(/Added/)).toBeTruthy())
    expect(screen.queryByText(/Reminder set/)).toBeNull()
  })

  it('says where an entry went when it lands on another day', async () => {
    const box = await open()
    await userEvent.type(box, '320 lunch yesterday{Enter}')
    await waitFor(() => expect(screen.getByText(/Saved to yesterday/)).toBeTruthy())
  })
})

describe('deleting and taking it back', () => {
  const row = {
    id: 'server-1',
    kind: 'expense',
    // dayKey, not toISOString: in IST the UTC date is yesterday for the first
    // five and a half hours, so the row would land on a day nobody is looking at.
    occurred_on: dayKey(new Date()),
    occurred_at: null,
    title: 'lunch swiggy',
    note: null,
    amount_paise: 35000,
    duration_minutes: null,
    category: 'food',
    data: {},
    created_at: '2026-09-05T09:00:00+05:30',
  }

  it('offers undo instead of asking are you sure', async () => {
    rowsOnServer = [row]
    await open()

    await userEvent.click(await screen.findByText('lunch swiggy'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    // Gone at once, with a way back rather than a confirmation beforehand.
    await waitFor(() => expect(screen.queryByText('lunch swiggy')).toBeNull())
    expect(screen.getByText('Entry deleted')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('brings the entry back when undo is taken', async () => {
    rowsOnServer = [row]
    await open()

    await userEvent.click(await screen.findByText('lunch swiggy'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('lunch swiggy')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText('lunch swiggy')).toBeTruthy())
  })

  it('lets the message be closed rather than only waited out', async () => {
    rowsOnServer = [row]
    await open()

    await userEvent.click(await screen.findByText('lunch swiggy'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Entry deleted')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Entry deleted')).toBeNull()
    // Dismissed, not undone: the entry stays deleted.
    expect(screen.queryByText('lunch swiggy')).toBeNull()
  })
})

describe('a reminder whose moment has gone', () => {
  it('reads as behind you rather than still ahead', async () => {
    const today = dayKey(new Date())
    const anHourAgo = new Date(Date.now() - 3_600_000)
    rowsOnServer = [
      {
        id: 'past',
        kind: 'event',
        occurred_on: today,
        occurred_at: anHourAgo.toISOString(),
        title: 'ping me',
        note: null,
        amount_paise: null,
        duration_minutes: null,
        category: null,
        data: {},
        created_at: anHourAgo.toISOString(),
      },
    ]
    await open()

    const title = await screen.findByText('ping me')
    expect(title.className).toContain('line-through')
    // Never decoration alone: a screen reader is told in words. One word covers
    // both ways a row gets struck — the moment went by, or it was ticked off.
    expect(screen.getByText(/Event, done\./)).toBeTruthy()
  })
})

describe('the week strip', () => {
  it('reaches any day of this week in one tap', async () => {
    await open()

    // Whichever day of this week is not today — so the assertion holds whatever
    // day the suite happens to run on, including Monday and Sunday.
    const start = startOfWeek(new Date(), { weekStartsOn: 1 })
    const other = eachDayOfInterval({ start, end: addDays(start, 6) }).find(
      (date) => dayKey(date) !== dayKey(new Date()),
    )
    if (other === undefined) throw new Error('a week has more than one day')

    // Scoped: the sidebar calendar carries the same labels, and is only hidden
    // by a breakpoint that jsdom does not apply.
    const strip = screen.getByRole('navigation', { name: 'This week' })
    await userEvent.click(within(strip).getByLabelText(format(other, 'EEEE d MMMM yyyy')))

    expect(
      screen.getByLabelText(`${format(other, 'EEE, d MMM')} — open calendar`),
    ).toBeTruthy()
  })
})

describe('the part of the day that is already over', () => {
  const reminder = (id: string, minutesAgo: number) => {
    const at = new Date(Date.now() - minutesAgo * 60_000)
    return {
      id,
      kind: 'event',
      occurred_on: dayKey(new Date()),
      occurred_at: at.toISOString(),
      title: `passed ${id}`,
      note: null,
      amount_paise: null,
      duration_minutes: null,
      category: null,
      data: {},
      created_at: at.toISOString(),
    }
  }

  it('folds a run of passed reminders so the day opens on what is still live', async () => {
    rowsOnServer = [reminder('a', 300), reminder('b', 240), reminder('c', 180)]
    await open()

    await waitFor(() => expect(screen.getByText('3 already passed')).toBeTruthy())
    // Folded, not dropped: the count still describes the whole day.
    expect(screen.queryByText('passed a')).toBeNull()
    expect(screen.getByText(/3 entries/)).toBeTruthy()
  })

  it('unfolds them in place', async () => {
    rowsOnServer = [reminder('a', 300), reminder('b', 240)]
    await open()

    await userEvent.click(await screen.findByText('2 already passed'))
    expect(screen.getByText('passed a')).toBeTruthy()
    expect(screen.getByText('passed b')).toBeTruthy()
  })

  it('leaves a single passed reminder alone, since folding one saves nothing', async () => {
    rowsOnServer = [reminder('a', 300)]
    await open()

    await waitFor(() => expect(screen.getByText('passed a')).toBeTruthy())
    expect(screen.queryByText(/already passed/)).toBeNull()
  })
})

describe('with no network', () => {
  function offline() {
    unreachable = true
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
  }

  it('sets a reminder with nothing to reach', async () => {
    offline()
    const box = await open()
    await userEvent.type(box, 'ping me tomorrow 5pm{Enter}')

    // The OS holds the alarm, so this never needed a server or a connection —
    // and the confirmation has to say so, or nobody trusts it fired.
    await waitFor(() => expect(screen.getByText(/Reminder set for/)).toBeTruthy())
  })

  it('says the entry is saved here rather than showing a failure', async () => {
    offline()
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')

    await waitFor(() => expect(screen.getByText(/waiting to sync/)).toBeTruthy())
    // Saved and waiting, not broken: no Retry chip, and no raw fetch error.
    expect(screen.getByText(/saved here, not synced/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
  })

  it('totals the day from what this device holds', async () => {
    offline()
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')
    await userEvent.type(box, '2h client work{Enter}')

    // Arithmetic over local rows. None of it was ever a server's job.
    await waitFor(() => expect(screen.getByText(/₹350 spent · 2h logged/)).toBeTruthy())
  })

  it('answers a question about the log with no network', async () => {
    offline()
    const box = await open()
    await userEvent.type(box, '2h client work{Enter}')
    await waitFor(() => expect(screen.getByText('client work')).toBeTruthy())

    await userEvent.type(box, '? hours client work')

    // The sentence the live region announces, which only exists if the corpus
    // was answered from this device.
    await waitFor(() => expect(screen.getByText('2h · 1 entry · last today')).toBeTruthy())
  })
})

describe('looking back at the same day', () => {
  // Four years, not one: it is the same month and day whatever today is,
  // including 29 February, where a single year back is a different date.
  const then = subYears(new Date(), 4)

  const row = {
    id: 'old',
    kind: 'expense',
    occurred_on: dayKey(then),
    occurred_at: null,
    title: 'headphones',
    note: null,
    amount_paise: 240000,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2022-09-07T09:00:00+05:30',
  }

  it('recalls an earlier year under the day, without being asked', async () => {
    rowsOnServer = [row]
    await open()

    await waitFor(() => expect(screen.getByText('On this day')).toBeTruthy())
    expect(screen.getByText(format(then, 'd MMMM yyyy'))).toBeTruthy()
    expect(screen.getByText('headphones')).toBeTruthy()
  })

  it('takes one tap to go and read that day', async () => {
    rowsOnServer = [row]
    await open()

    await userEvent.click(await screen.findByText(format(then, 'd MMMM yyyy')))
    // The header names the year, because otherwise nothing on the screen says
    // which September you have just landed in.
    expect(
      screen.getByLabelText(`${format(then, 'EEE, d MMM yyyy')} — open calendar`),
    ).toBeTruthy()
  })

  it('shows nothing at all when there is nothing to recall', async () => {
    rowsOnServer = []
    await open()
    expect(screen.queryByText('On this day')).toBeNull()
  })
})

describe('asking, once everything is wired', () => {
  it('answers from the whole log rather than the visible day', async () => {
    rowsOnServer = [
      {
        id: 'a',
        kind: 'time',
        occurred_on: dayKey(new Date()),
        occurred_at: null,
        title: 'gym',
        note: null,
        amount_paise: null,
        duration_minutes: 60,
        category: null,
        data: {},
        created_at: '2026-09-05T09:00:00+05:30',
      },
    ]
    const box = await open()
    await userEvent.type(box, '? how many days gym')

    // The card leads with the count; the live region says the whole sentence.
    await waitFor(() => expect(screen.getByText('1 day')).toBeTruthy())
    expect(screen.getByText('1 day · 1h · last today')).toBeTruthy()
  })
})
