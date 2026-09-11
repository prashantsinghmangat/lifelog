// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from './QuickAdd'
import type { ParsedEntry } from '../lib/parser'
import type { Entry } from '../types'

/**
 * Journeys, not rendering. Every one of these is a path that has silently
 * broken at least once: the send key that only dismissed the keyboard, a
 * question filed away as a note, a reminder measured from a stale clock.
 */

afterEach(cleanup)

const NOW = new Date(2026, 8, 5, 10, 0, 0)
const TODAY = '2026-09-05'

let seq = 0
function entry(over: Partial<Entry>): Entry {
  seq += 1
  return {
    id: `id-${seq}`,
    kind: 'time',
    occurred_on: '2026-09-04',
    occurred_at: null,
    title: 'gym',
    note: null,
    amount_paise: null,
    duration_minutes: 60,
    category: null,
    data: {},
    created_at: '2026-09-04T10:00:00+05:30',
    ...over,
  }
}

function setup(over: Partial<Parameters<typeof QuickAdd>[0]> = {}) {
  const onSubmit = vi.fn<(parsed: ParsedEntry) => void>()
  const onNeedCorpus = vi.fn()
  const onPrefilled = vi.fn()
  const onHelp = vi.fn()
  const onGoToDay = vi.fn<(day: string) => void>()

  const props = {
    day: TODAY,
    now: NOW,
    showExamples: false,
    onSubmit,
    corpus: null,
    onNeedCorpus,
    prefill: null,
    onPrefilled,
    onHelp,
    onGoToDay,
    ...over,
  }

  const view = render(<QuickAdd {...props} />)
  // Plain DOM assertions throughout, rather than pulling in jest-dom for
  // sugar: one less dependency, and `.value` reads no worse than a matcher.
  const box = screen.getByLabelText('What happened?') as HTMLInputElement
  return { view, box, onSubmit, onNeedCorpus, onPrefilled, onHelp, onGoToDay, props }
}

describe('capturing an entry', () => {
  it('previews the parse as it is typed', async () => {
    const { box } = setup()
    await userEvent.type(box, '350 lunch swiggy')
    expect(screen.getByText(/expense/).textContent).toContain('₹350')
    expect(screen.getByText(/expense/).textContent).toContain('food')
  })

  it('submits on Enter and clears the box', async () => {
    const { box, onSubmit } = setup()
    await userEvent.type(box, '350 lunch swiggy{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ kind: 'expense', amountPaise: 35000 })
    expect(box.value).toBe('')
  })

  it('offers a send button once there is something to save', async () => {
    const { box } = setup()
    expect(screen.queryByLabelText('Save entry')).toBeNull()
    await userEvent.type(box, '2h client work')
    expect(screen.getByLabelText('Save entry')).toBeTruthy()
  })

  it('submits from the send button too', async () => {
    const { box, onSubmit } = setup()
    await userEvent.type(box, '2h client work')
    await userEvent.click(screen.getByLabelText('Save entry'))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ kind: 'time', durationMinutes: 120 })
  })

  it('does nothing on Enter when the box is empty', async () => {
    const { box, onSubmit } = setup()
    await userEvent.type(box, '{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('files an undated entry on the day being viewed, not today', async () => {
    // Viewing the 1st while it is the 5th: a backfill must land where you are.
    const { box, onSubmit } = setup({ day: '2026-09-01' })
    await userEvent.type(box, '500 groceries{Enter}')
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ occurredOn: '2026-09-01' })
  })

  it('measures a relative reminder from the real clock, not the cached one', async () => {
    // `now` here is 10:00 and deliberately stale; the entry must not be built
    // from it, or the reminder is already overdue and gets dropped.
    const { box, onSubmit } = setup()
    await userEvent.type(box, 'ping me in 5 minutes{Enter}')

    const parsed = onSubmit.mock.calls[0]?.[0]
    expect(parsed?.kind).toBe('event')
    expect(parsed?.occurredAt).toBeDefined()
    expect(new Date(parsed?.occurredAt ?? 0).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('choosing between logging and asking', () => {
  const corpus = [
    entry({ occurred_on: TODAY, kind: 'expense', title: 'lunch swiggy', amount_paise: 35000, duration_minutes: null }),
  ]

  it('asks without a question mark once Ask is chosen', async () => {
    const { box } = setup({ corpus })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'how much did i spend today')

    // No syntax involved: the mode is what turns the box into a question.
    expect(screen.getByText('₹350 · 1 entry · last today')).toBeTruthy()
  })

  it('says what the box will do', async () => {
    const { box } = setup()
    expect(box.placeholder).toBe('What happened?')

    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(box.placeholder).toBe('What do you want to know?')
  })

  it('keeps the question mark working from Log, so an old habit still lands', async () => {
    const { box, onSubmit } = setup({ corpus })
    await userEvent.type(box, '? how much did i spend today')

    expect(screen.getByText('₹350 · 1 entry · last today')).toBeTruthy()
    await userEvent.type(box, '{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('never files a question away as an entry', async () => {
    const { box, onSubmit } = setup({ corpus })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'what did i do today{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers to log something typed into Ask by mistake', async () => {
    // The one failure the mode introduces that the prefix could not: a dead end
    // in front of text the app plainly understands.
    const { box, onSubmit } = setup({ corpus: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, '350 lunch swiggy')

    // The button carries the parse, so it says what it is about to record.
    const offer = await screen.findByRole('button', { name: /Log instead.*expense · ₹350 · food/ })
    await userEvent.click(offer)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ kind: 'expense', amountPaise: 35000 })
    // And it puts the box back where it started.
    expect(box.value).toBe('')
    expect(box.placeholder).toBe('What happened?')
  })

  it('leaves Ask on Escape rather than only dropping the keyboard', async () => {
    const { box } = setup({ corpus })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'how much{Escape}')

    expect(box.value).toBe('')
    expect(box.placeholder).toBe('What happened?')
  })
})

describe('a day with nothing on it', () => {
  it('shows what an entry becomes, rather than describing the syntax', async () => {
    setup({ showExamples: true })

    // The transformation is the trick, and an empty log is the one place it
    // cannot be seen — so the empty day demonstrates it.
    expect(screen.getByText('350 lunch swiggy')).toBeTruthy()
    expect(screen.getByText(/becomes an expense · ₹350 · food/)).toBeTruthy()
    expect(screen.getByText(/becomes a reminder that will ring/)).toBeTruthy()
  })

  it('fills the box from an example instead of saving it', async () => {
    const { box, onSubmit } = setup({ showExamples: true })
    await userEvent.click(screen.getByText('2h client work'))

    // Filled, not submitted: the syntax is learned by editing something real.
    expect(box.value).toBe('2h client work')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says nothing about examples once the day has entries', async () => {
    setup({ showExamples: false })
    expect(screen.queryByText(/becomes an expense/)).toBeNull()
  })
})

describe('asking a question', () => {
  const corpus = [
    entry({ occurred_on: '2026-09-05', title: 'gym', duration_minutes: 60 }),
    entry({ occurred_on: '2026-09-03', title: 'gym', duration_minutes: 45 }),
    entry({ occurred_on: '2026-09-03', title: 'gym again', duration_minutes: 30 }),
  ]

  it('leads with the number asked for, and shows the entries behind it', async () => {
    const { box } = setup({ corpus })
    await userEvent.type(box, '? how many days gym')

    // The card leads with the number on its own; the live region hears the
    // whole sentence. Both, on purpose, and neither written twice.
    expect(screen.getByText('2 days')).toBeTruthy()
    expect(screen.getByText('2 days · 2h 15m · first 3 Sep · last today')).toBeTruthy()

    // The working, which is most of why the question was worth asking.
    expect(screen.getByText('gym again')).toBeTruthy()

    // Once, above both of that day's rows. Printed per row it was the loudest
    // thing on the card and still had to be reassembled by eye.
    expect(screen.getAllByText('Thu 3 Sep')).toHaveLength(1)
  })

  it('takes you to the day an answer points at, and clears the question', async () => {
    const { box, onGoToDay } = setup({ corpus })
    await userEvent.type(box, '? gym')
    await userEvent.click(screen.getByText('gym again'))

    expect(onGoToDay).toHaveBeenCalledWith('2026-09-03')
    // Leaving the question in the box would hide the day it just opened.
    expect(box.value).toBe('')
  })

  it('shows what went into a total, not everything that happened that day', async () => {
    const mixed = [
      entry({ occurred_on: TODAY, kind: 'expense', title: 'lunch swiggy', amount_paise: 35000 }),
      entry({ occurred_on: TODAY, kind: 'note', title: 'met rahul' }),
      entry({ occurred_on: TODAY, kind: 'time', title: 'client call', duration_minutes: 120 }),
    ]
    const { box } = setup({ corpus: mixed })
    await userEvent.type(box, '? how much did i spend today')

    // The total, and the single expense behind it.
    expect(screen.getAllByText('₹350').length).toBe(2)
    expect(screen.queryByText('met rahul')).toBeNull()
    expect(screen.queryByText('client call')).toBeNull()
  })

  it('caps the rows, rather than letting an answer take the screen', async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      entry({ occurred_on: `2026-08-0${index + 1}`, title: `gym ${index}` }),
    )
    const { box } = setup({ corpus: many })
    await userEvent.type(box, '? gym')

    expect(screen.queryByText('gym 0')).toBeNull()
    await userEvent.click(screen.getByText(/see all 9/))
    expect(screen.getByText('gym 0')).toBeTruthy()
  })

  it('asks for the log only once a question is actually typed', async () => {
    const { box, onNeedCorpus } = setup()
    await userEvent.type(box, '350 lunch')
    expect(onNeedCorpus).not.toHaveBeenCalled()

    await userEvent.clear(box)
    await userEvent.type(box, '? gym')
    expect(onNeedCorpus).toHaveBeenCalled()
  })

  it('never becomes an entry, however it is submitted', async () => {
    // The bug this exists for: the send button hides, but Enter reached the
    // submit handler anyway and filed the question away as a note.
    const { box, onSubmit } = setup({ corpus })
    await userEvent.type(box, '? how many times gym{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(box.value).toBe('? how many times gym')
    expect(screen.queryByLabelText('Save entry')).toBeNull()
  })

  it('waits rather than answering from an unloaded log', async () => {
    const { box } = setup({ corpus: null })
    await userEvent.type(box, '? gym')
    expect(screen.getByText('…')).toBeTruthy()
  })
})

describe('prefill from the manual', () => {
  it('fills the box rather than saving, so it can be read and edited first', () => {
    const { box, onSubmit, onPrefilled } = setup({ prefill: 'dentist tomorrow 5pm' })
    expect(box.value).toBe('dentist tomorrow 5pm')
    expect(onSubmit).not.toHaveBeenCalled()
    // Cleared upstream, or the same example could never be tapped twice.
    expect(onPrefilled).toHaveBeenCalled()
  })
})

describe('examples on an empty day', () => {
  it('offers a way into the manual, which settings alone would hide', async () => {
    const { onHelp } = setup({ showExamples: true })
    await userEvent.click(screen.getByText('all examples'))
    expect(onHelp).toHaveBeenCalled()
  })

  it('fills the box instead of submitting, so the syntax is learned by editing', async () => {
    const { box, onSubmit } = setup({ showExamples: true })
    await userEvent.click(screen.getByText('350 lunch swiggy'))
    expect(box.value).toBe('350 lunch swiggy')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
