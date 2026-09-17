// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  addDays,
  eachDayOfInterval,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subYears,
} from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { dayKey } from './lib/format'
import { load } from './lib/store'
import type { RearmResult, ScheduleResult } from './lib/reminders'

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
/** What the re-arm on a save reports back, including the ways it can fail. */
let rearmResult: RearmResult | 'throw' = 'scheduled'
/** Whether cancelling an alarm rejects, as a failing native call does. */
let cancelThrows = false
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

/** Who this device belongs to. A guest is the same shape with no account. */
let who: { id: string; email: string; local?: boolean } | null = {
  id: 'user-1',
  email: 'you@example.com',
}

vi.mock('./hooks/useSession', () => ({
  // An identity, not a session: the app runs for whoever this device belongs
  // to, which is not the same as whether Supabase can prove it right now.
  useSession: () => ({
    identity: who,
    loading: false,
    startGuest: () => {
      who = { id: 'local-guest', email: '', local: true }
    },
  }),
}))

vi.mock('./lib/reminders', () => ({
  // Faithful to the real thing: only an event is ever scheduled, so an expense
  // must not overwrite its own confirmation with a reminder message.
  schedule: vi.fn(async (entry: { kind: string }) =>
    entry.kind === 'event' ? scheduleResult : 'skipped',
  ),
  cancel: vi.fn(async () => {
    if (cancelThrows) throw new Error('cancel failed on android')
  }),
  rearm: vi.fn(async () => {
    if (rearmResult === 'throw') throw new Error('schedule failed on android')
    return rearmResult
  }),
  sync: vi.fn(async () => undefined),
  scheduleNudges: vi.fn(async () => 'scheduled'),
  permission: vi.fn(async () => 'granted'),
  requestPermission: vi.fn(async () => true),
}))

afterEach(cleanup)

let ids = 0
beforeEach(() => {
  who = { id: 'user-1', email: 'you@example.com' }
  rowsOnServer = []
  scheduleResult = 'scheduled'
  rearmResult = 'scheduled'
  cancelThrows = false
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

  it('counts a reminder in the bell as soon as it is typed', async () => {
    // The bell used to read the fetch made at launch, so a standup set up a
    // moment ago was missing from the one list whose whole job is to say what
    // is coming.
    const box = await open()
    await userEvent.type(box, 'standup 10am weekdays{Enter}')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /What is coming/ })).toBeTruthy(),
    )
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

    // Arithmetic over local rows. None of it was ever a server's job. The
    // figures carry their own weight now, so each is its own node — asserted on
    // the totals line rather than on the rows, which print the same two numbers.
    // `2 entries` exactly — the offline notice says "entries" too, in a longer
    // sentence that an exact match does not reach.
    const totals = await waitFor(() => {
      const found = screen.getByText('2 entries').closest('p')
      if (found === null) throw new Error('no totals line')
      return found
    })
    expect(totals.textContent).toContain('₹350 spent')
    expect(totals.textContent).toContain('2h logged')
    expect(totals.textContent).toContain('2 entries')
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

describe('every control can be named out loud', () => {
  /** Text, or a label where the control is an icon. No third possibility. */
  function nameless(): string[] {
    return [...document.querySelectorAll('button')]
      .filter(
        (node) =>
          node.textContent?.trim() === '' &&
          node.getAttribute('aria-label') === null &&
          node.getAttribute('aria-labelledby') === null,
      )
      .map((node) => node.outerHTML.slice(0, 120))
  }

  const row = {
    id: 'server-1',
    kind: 'expense',
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

  it('on the day, in the editor, on You and in the calendar', async () => {
    rowsOnServer = [row]
    await open()

    await screen.findByText('lunch swiggy')
    expect(nameless()).toEqual([])

    await userEvent.click(screen.getByText('lunch swiggy'))
    expect(nameless()).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    const nav = screen.getByRole('navigation', { name: 'Destinations' })
    await userEvent.click(within(nav).getByRole('button', { name: 'You' }))
    expect(nameless()).toEqual([])

    await userEvent.click(within(nav).getByRole('button', { name: 'Calendar' }))
    expect(nameless()).toEqual([])

    await userEvent.click(within(nav).getByRole('button', { name: 'Today' }))
    await userEvent.click(screen.getByLabelText(/open calendar/))
    expect(nameless()).toEqual([])
  })
})

describe('a sheet with a toast still on screen', () => {
  /** The nearest stacking level above a node, since the toast no longer sets its own. */
  function level(from: Element | null): number | null {
    let at: Element | null = from
    while (at !== null) {
      const classes = typeof at.className === 'string' ? at.className : ''
      const found = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(classes)
      if (found?.[1] !== undefined) return Number(found[1])
      at = at.parentElement
    }
    return null
  }

  const deleted = {
    id: 'server-1',
    kind: 'expense',
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
  const other = { ...deleted, id: 'server-2', title: 'chai', amount_paise: 2000 }

  /**
   * Found in a real browser, and worth keeping now that the toast has moved: it
   * used to be `fixed` at the bottom while a sheet's actions are sticky along
   * its own bottom edge, so at a lower stacking level the message sat squarely
   * over Save, Cancel and Delete. `elementFromPoint` at the middle of Save
   * returned the toast — the tap did not miss, it hit the wrong control, and on
   * a toast carrying Undo that meant pressing Save restored the row just
   * deleted. Deleting one entry and editing another within six seconds is all
   * it takes, which is why the journey is walked here rather than asserted on
   * two components rendered side by side.
   */
  it('stacks above it, so the toast cannot take a tap meant for Save', async () => {
    rowsOnServer = [deleted, other]
    await open()

    await userEvent.click(await screen.findByText('lunch swiggy'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Entry deleted')).toBeTruthy())

    await userEvent.click(screen.getByText('chai'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy()

    const above = level(dialog.parentElement)
    const below = level(screen.getByText('Entry deleted'))
    expect(above).not.toBeNull()
    expect(below).not.toBeNull()
    expect(above ?? 0).toBeGreaterThan(below ?? 0)
  })
})

describe('a sheet behaving like a dialog', () => {
  // `Sheet` owns modal correctness for the whole app, so it is worth pinning
  // here rather than trusting each surface to have got it right.
  it('closes on Escape and hands focus back to what opened it', async () => {
    await open()

    // The sidebar's account button: on `lg` there is no nav, so this is the
    // one route left that opens `You` as a sheet.
    const trigger = screen.getByRole('button', { name: 'you@example.com' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps Tab inside it', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'you@example.com' }))

    const dialog = screen.getByRole('dialog')
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, input, textarea')]
    focusable[focusable.length - 1]?.focus()
    await userEvent.tab()

    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})

describe('a reminder that could not be re-armed', () => {
  const row = {
    id: 'server-1',
    kind: 'event',
    occurred_on: dayKey(new Date()),
    occurred_at: new Date(Date.now() + 3_600_000).toISOString(),
    title: 'dentist',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-05T09:00:00+05:30',
  }

  async function save() {
    rowsOnServer = [row]
    await open()
    await userEvent.click(await screen.findByText('dentist'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('says so rather than rejecting into nothing', async () => {
    rearmResult = 'throw'
    await save()
    await waitFor(() => expect(screen.getByText(/Reminder failed/)).toBeTruthy())
  })

  it('offers the way out when the block is a refused permission', async () => {
    rearmResult = 'blocked'
    await save()
    await waitFor(() => expect(screen.getByText('Saved, but reminders are blocked')).toBeTruthy())
    expect(screen.getByText(/Allow notifications/)).toBeTruthy()
  })

  it('warns when an old alarm is left armed with nothing replacing it', async () => {
    rearmResult = 'stale'
    await save()
    await waitFor(() =>
      expect(screen.getByText('Saved, but an old reminder may still fire')).toBeTruthy(),
    )
  })

  it('stays quiet when it worked', async () => {
    await save()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(/Reminder failed/)).toBeNull()
    expect(screen.queryByText(/may still fire/)).toBeNull()
  })

  it('keeps Undo on the delete when cancelling the alarm fails', async () => {
    // The warning replaces the message, so it has to carry the way back with
    // it — otherwise a failing cancel quietly costs you the undo as well.
    cancelThrows = true
    rowsOnServer = [row]
    await open()
    await userEvent.click(await screen.findByText('dentist'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(screen.getByText('Deleted, but its reminder may still fire')).toBeTruthy(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText('dentist')).toBeTruthy())
  })
})

describe('a repeat opened from a day it merely lands on', () => {
  /** Started last week, so today draws it as an occurrence and not as the row. */
  const STARTED = dayKey(new Date(Date.now() - 7 * 86_400_000))

  function standup() {
    const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
    return {
      id: 'standup',
      kind: 'event',
      occurred_on: STARTED,
      occurred_at: null,
      title: 'team standup',
      note: null,
      amount_paise: null,
      duration_minutes: null,
      category: null,
      data: { rrule: `FREQ=WEEKLY;BYDAY=${codes[new Date().getDay()]}` },
      created_at: '2026-01-01T09:00:00+05:30',
    }
  }

  const stored = () => load(localStorage, 'user-1').entries.find((row) => row.id === 'standup')

  it('saves onto the row, not onto the day it was drawn on', async () => {
    // The occurrence carries the day it was *drawn* on. Editing one therefore
    // wrote that day back: opening Tuesday's standup and pressing Save moved
    // the series start to Tuesday, and a birthday logged in 2010 opened from
    // this year had its year rewritten — the original date gone, silently.
    rowsOnServer = [standup()]
    render(<App />)

    await userEvent.click(await screen.findByText('team standup'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(stored()).toBeTruthy())
    expect(stored()?.occurred_on).toBe(STARTED)
  })

  it('brings the same row back when its delete is undone', async () => {
    rowsOnServer = [standup()]
    render(<App />)

    await userEvent.click(await screen.findByText('team standup'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(stored()).toBeTruthy())
    expect(stored()?.occurred_on).toBe(STARTED)
  })
})

describe('the sidebar calendar, which stays mounted all day', () => {
  it('follows the day when it lands in another month', async () => {
    render(<App />)
    await screen.findByLabelText('What happened?')

    const thisMonth = startOfMonth(new Date())
    const previous = subMonths(thisMonth, 1)
    const label = (date: Date) => format(date, 'MMMM yyyy')

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText(label(previous))).toBeTruthy()

    // Browsing is the grid's own state: picking a day inside the month on show
    // must not snap it forward again.
    const grid = screen.getByText(label(previous)).closest('div')?.parentElement as HTMLElement
    const fifteenth = new Date(previous.getFullYear(), previous.getMonth(), 15)
    await userEvent.click(within(grid).getByLabelText(format(fifteenth, 'EEEE d MMMM yyyy')))
    expect(screen.getByText(label(previous))).toBeTruthy()

    // But a day landing outside it has to bring the grid with it, or the month
    // on screen holds no selected cell anywhere — which is what every jump from
    // an answer, a memory or the bell used to do.
    await userEvent.click(within(grid).getByRole('button', { name: 'Today' }))
    await waitFor(() => expect(screen.getByText(label(thisMonth))).toBeTruthy())
  })
})

describe('an impatient hand', () => {
  it('makes one entry from two quick presses of Enter', async () => {
    await open().then((box) => userEvent.type(box, '350 lunch swiggy{Enter}{Enter}'))
    await waitFor(() => expect(load(localStorage, 'user-1').entries).toHaveLength(1))
  })
})

describe('what survives a reload with no network', () => {
  const row = {
    id: 'server-1',
    kind: 'expense',
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

  it('keeps entries made offline', async () => {
    unreachable = true
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')
    await userEvent.type(box, '2h client work{Enter}')
    await waitFor(() => expect(load(localStorage, 'user-1').entries).toHaveLength(2))

    cleanup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('lunch swiggy')).toBeTruthy())
    expect(screen.getByText('client work')).toBeTruthy()
  })

  it('keeps a delete made offline deleted', async () => {
    rowsOnServer = [row]
    await open()
    await userEvent.click(await screen.findByText('lunch swiggy'))

    unreachable = true
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('lunch swiggy')).toBeNull())

    cleanup()
    render(<App />)
    await screen.findByLabelText('What happened?')
    await waitFor(() => expect(screen.getByText(/waiting to sync/)).toBeTruthy())
    expect(screen.queryByText('lunch swiggy')).toBeNull()
  })

  it('keeps an edit made offline', async () => {
    rowsOnServer = [row]
    await open()
    await userEvent.click(await screen.findByText('lunch swiggy'))

    unreachable = true
    const title = screen.getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'dinner instead')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('dinner instead')).toBeTruthy())

    cleanup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('dinner instead')).toBeTruthy())
    expect(screen.queryByText('lunch swiggy')).toBeNull()
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

describe('using the app without an account', () => {
  /**
   * The auth gate was the last thing here that needed a network and did not.
   * Nothing about parsing, drawing a day, totalling it or raising a reminder
   * involves the server, so a sign-in form in front of all of it was asking for
   * a round trip to reach a text box.
   */
  it('logs and totals with no account at all', async () => {
    who = { id: 'local-guest', email: '', local: true }
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')

    await waitFor(() => expect(screen.getByText('lunch swiggy')).toBeTruthy())
    // The totals line, not the row — both print ₹350, which is the arithmetic
    // working rather than a duplicate. Read off the line, because the figure
    // and its label are separate nodes now.
    expect(screen.getByText('1 entry').closest('p')?.textContent).toContain('₹350 spent')
  })

  it('never labels a guest row as owed, queued or failed', async () => {
    // There is no server to be behind. Marking every row "saved here, not
    // synced" would be the app apologising for working exactly as designed.
    who = { id: 'local-guest', email: '', local: true }
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')

    await waitFor(() => expect(screen.getByText('lunch swiggy')).toBeTruthy())
    expect(screen.queryByText(/saved here, not synced/)).toBeNull()
    expect(screen.queryByText(/waiting to sync/)).toBeNull()
    expect(screen.queryByText(/Offline/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('answers a question from a log no server has ever seen', async () => {
    who = { id: 'local-guest', email: '', local: true }
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')
    // The control's own toggle, not the nav's destination: both say "Ask", and
    // this test is about the box answering rather than about getting there.
    await userEvent.click(
      within(screen.getByRole('group', { name: 'What the box does' })).getByRole('button', {
        name: 'Ask',
      }),
    )
    await userEvent.type(box, 'how much today')

    await waitFor(() => expect(screen.getByText(/₹350 · 1 entry/)).toBeTruthy())
  })

  it('offers an account rather than a sign-out, which would read as "delete my log"', async () => {
    who = { id: 'local-guest', email: '', local: true }
    await open()
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', {
        name: 'You',
      }),
    )

    expect(screen.getByText('No account')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in to sync' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('keeps the log behind the sign-in screen it opens', async () => {
    who = { id: 'local-guest', email: '', local: true }
    const box = await open()
    await userEvent.type(box, '350 lunch swiggy{Enter}')
    await waitFor(() => expect(screen.getByText('lunch swiggy')).toBeTruthy())

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', {
        name: 'You',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to sync' }))

    // A way back matters: reaching sign-in must not be a one-way door out of a
    // log that is sitting on the device.
    const back = await screen.findByRole('button', { name: 'Back to the log' })
    await userEvent.click(back)
    await waitFor(() => expect(screen.getByText('lunch swiggy')).toBeTruthy())
  })

  it('does not offer a second empty log to somebody who already has one', async () => {
    who = { id: 'local-guest', email: '', local: true }
    await open()
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', {
        name: 'You',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to sync' }))

    await screen.findByRole('button', { name: 'Back to the log' })
    expect(screen.queryByRole('button', { name: /without an account/ })).toBeNull()
  })
})

describe('the way in for somebody with no account', () => {
  it('offers guest access on the first screen, not just a sign-in form', async () => {
    // The app needs no account to do any of its work, so a sign-in form as the
    // only way past the first screen was asking for a round trip to reach a
    // text box.
    who = null
    render(<App />)

    const guest = await screen.findByRole('button', { name: 'Continue as guest' })
    expect(guest).toBeTruthy()
    // And it says what the trade is, rather than leaving it to be discovered.
    expect(screen.getByText(/signing in later brings it with you/i)).toBeTruthy()
  })

  it('tells a guest what signing in does to the log they already have', async () => {
    who = { id: 'local-guest', email: '', local: true }
    await open()
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Destinations' })).getByRole('button', {
        name: 'You',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to sync' }))

    await screen.findByRole('button', { name: 'Back to the log' })
    expect(screen.getByText(/moves to your account/i)).toBeTruthy()
    expect(screen.getByText(/Nothing is lost/i)).toBeTruthy()
  })
})
