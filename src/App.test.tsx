// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, eachDayOfInterval, format, startOfWeek } from 'date-fns'
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

function builder() {
  let writing = false
  const self: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'is', 'gte', 'lte', 'order']) {
    self[name] = () => self
  }
  for (const name of ['insert', 'update']) {
    self[name] = () => {
      writing = true
      return self
    }
  }
  self['then'] = (resolve: (value: Result) => unknown) =>
    Promise.resolve(
      writing ? { error: null } : { data: rowsOnServer, error: null },
    ).then(resolve)
  return self
}

vi.mock('./lib/supabase', () => ({
  supabase: { from: () => builder(), auth: { signOut: vi.fn() } },
}))

vi.mock('./hooks/useSession', () => ({
  useSession: () => ({ session: { user: { email: 'you@example.com' } }, loading: false }),
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
  ids = 0
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
