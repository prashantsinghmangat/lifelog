// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickAdd } from './QuickAdd'
import type { Row } from '../hooks/useEntries'
import type { ParsedEntry } from '../lib/parser'
import type { Entry } from '../types'

// The image pipeline needs `createImageBitmap` and a real canvas, neither of
// which jsdom has — the bytes are `attachments.test.ts`'s business. What these
// tests pin is *which entry id* a staged photo is filed against.
vi.mock('../lib/attachments', () => ({
  fromFile: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
  put: vi.fn(async () => {}),
}))

const { put, fromFile } = await import('../lib/attachments')

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
  // Returns a row, the way `App`'s own `submit` does: a staged photo is filed
  // against the id this hands back, so a mock returning nothing would make
  // every attachment path untestable.
  const onSubmit = vi.fn<(parsed: ParsedEntry) => Row>((parsed) =>
    entry({ title: parsed.title, kind: parsed.kind }),
  )
  const onSubmitMulti = vi.fn<(parsed: ParsedEntry[]) => Row[]>((list) =>
    list.map((parsed) => entry({ title: parsed.title, kind: parsed.kind })),
  )
  const onNeedCorpus = vi.fn()
  const onPrefilled = vi.fn()
  const onHelp = vi.fn()
  const onOpenEntry = vi.fn<(row: Entry) => void>()
  const onLeaveAsk = vi.fn()

  const props = {
    day: TODAY,
    now: NOW,
    // The destination, which on a phone is what says the box is asking. These
    // tests drive the control's own toggle instead, as `lg` does.
    ask: false,
    onLeaveAsk,
    showExamples: false,
    onSubmit,
    onSubmitMulti,
    corpus: null,
    onNeedCorpus,
    prefill: null,
    onPrefilled,
    onHelp,
    onOpenEntry,
    firstEver: false,
    ...over,
  }

  const view = render(<QuickAdd {...props} />)
  // Plain DOM assertions throughout, rather than pulling in jest-dom for
  // sugar: one less dependency, and `.value` reads no worse than a matcher.
  const box = screen.getByLabelText('What happened?') as HTMLTextAreaElement
  return {
    view,
    box,
    onSubmit,
    onSubmitMulti,
    onNeedCorpus,
    onPrefilled,
    onHelp,
    onOpenEntry,
    onLeaveAsk,
    props,
  }
}

describe('capturing an entry', () => {
  it('previews the parse as it is typed', async () => {
    const { box } = setup()
    await userEvent.type(box, '350 lunch swiggy')
    expect(screen.getByText(/expense/).textContent).toContain('₹350')
    expect(screen.getByText(/expense/).textContent).toContain('food')
  })

  it('inserts a newline on Enter instead of submitting', async () => {
    // Enter breaks the line, the way every chat app's keyboard does — Save
    // is the only way to send now, so a stray Enter must never fire it.
    const { box, onSubmit } = setup()
    await userEvent.type(box, '350 lunch swiggy{Enter}more')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(box.value).toBe('350 lunch swiggy\nmore')
  })

  it('submits on Save and clears the box', async () => {
    const { box, onSubmit } = setup()
    await userEvent.type(box, '350 lunch swiggy')
    await userEvent.click(screen.getByLabelText('Save entry'))

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
    await userEvent.type(box, '500 groceries')
    await userEvent.click(screen.getByLabelText('Save entry'))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ occurredOn: '2026-09-01' })
  })

  it('measures a relative reminder from the real clock, not the cached one', async () => {
    // `now` here is 10:00 and deliberately stale; the entry must not be built
    // from it, or the reminder is already overdue and gets dropped.
    const { box, onSubmit } = setup()
    await userEvent.type(box, 'ping me in 5 minutes')
    await userEvent.click(screen.getByLabelText('Save entry'))

    const parsed = onSubmit.mock.calls[0]?.[0]
    expect(parsed?.kind).toBe('event')
    expect(parsed?.occurredAt).toBeDefined()
    expect(new Date(parsed?.occurredAt ?? 0).getTime()).toBeGreaterThan(Date.now())
  })

  it('grows with what is typed instead of clipping to one line', async () => {
    // jsdom computes no real layout, so height itself is not assertable —
    // what matters here is that the element is one that *can* grow (a
    // textarea, not the single-line input this replaced) and that a long,
    // multi-line paste survives in full rather than the box silently
    // dropping anything.
    const { box } = setup()
    expect(box.tagName).toBe('TEXTAREA')
    const long = 'first line\nsecond line\nthird line, considerably longer than the box is wide'
    await userEvent.click(box)
    await userEvent.paste(long)
    expect(box.value).toBe(long)
  })

  it('inserts a newline on Shift+Enter instead of submitting', async () => {
    const { box, onSubmit } = setup()
    await userEvent.type(box, 'first line')
    await userEvent.type(box, '{Shift>}{Enter}{/Shift}')
    await userEvent.type(box, 'second line')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(box.value).toBe('first line\nsecond line')
  })
})

describe('the empty-field hint', () => {
  it('shows an example while the field is empty, and nothing once there is text', async () => {
    const { box } = setup()
    expect(screen.getByText('350 lunch · 2h client · dentist 5pm')).toBeTruthy()

    // Gone on the very first keystroke — it never sits under a real parse.
    await userEvent.type(box, '5')
    expect(screen.queryByText('350 lunch · 2h client · dentist 5pm')).toBeNull()
  })

  it('says nothing in the live region on mount, so a screen reader is silent at launch', () => {
    setup()
    // The hint is real text on screen, but not inside `role="status"` — that
    // region is what a screen reader announces, and it must start empty.
    expect(document.getElementById('quick-add-preview')?.textContent).toBe('')
  })
})

describe('one line, several entries', () => {
  it('previews a count and the total once a batch is recognised', async () => {
    const { box } = setup()
    await userEvent.type(box, 'salon: 450 detan, 100 cutting, beard cutting')
    expect(screen.getByText(/3 entries/).textContent).toContain('₹550 total')
  })

  it('submits the whole batch through onSubmitMulti, not onSubmit', async () => {
    const { box, onSubmit, onSubmitMulti } = setup()
    await userEvent.type(box, 'salon: 450 detan, 100 cutting, beard cutting')
    await userEvent.click(screen.getByLabelText('Save entry'))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onSubmitMulti).toHaveBeenCalledTimes(1)
    const batch = onSubmitMulti.mock.calls[0]?.[0]
    expect(batch).toHaveLength(3)
    expect(batch?.[0]).toMatchObject({ kind: 'expense', amountPaise: 45000 })
    expect(box.value).toBe('')
  })

  it('falls back to a single entry when the line has no comma to split on', async () => {
    const { box, onSubmit, onSubmitMulti } = setup()
    await userEvent.type(box, 'salon: 450 detan')
    await userEvent.click(screen.getByLabelText('Save entry'))

    expect(onSubmitMulti).not.toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledTimes(1)
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

  it('measures a relative reminder from the real clock when logged instead', async () => {
    // The same trap as Enter, one screen along: the offer was built from the
    // cached `now` and handed straight to onSubmit, so a reminder recovered
    // this way could already be due and be dropped without a word.
    const { box, onSubmit } = setup({ corpus: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'ping me in 5 minutes')

    await userEvent.click(await screen.findByRole('button', { name: /Log instead/ }))

    const parsed = onSubmit.mock.calls[0]?.[0]
    expect(parsed?.kind).toBe('event')
    expect(new Date(parsed?.occurredAt ?? 0).getTime()).toBeGreaterThan(Date.now())
  })

  it('does not keep the question mark when a question is logged instead', async () => {
    // `?` still works from Ask, since the habit does not switch off with the
    // mode. What must not survive is the mark itself, in the title of an entry.
    const { box, onSubmit } = setup({ corpus: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, '? 350 lunch swiggy')

    await userEvent.click(await screen.findByRole('button', { name: /Log instead/ }))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'expense',
      title: 'lunch swiggy',
    })
  })

  it('suggests a narrower question rather than Log instead, when the text is not actionable', async () => {
    // "how much on rent" falls back to a bare note — the parser recognises
    // nothing else in it — so offering to log it would be filing the question
    // away, not saving a step. The three guaranteed-answerable questions take
    // over instead, same as the empty-box moment offers.
    const { box, onSubmit } = setup({ corpus: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'how much on rent')

    expect(await screen.findByText('Try one of these instead')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Log instead/ })).toBeNull()
    // The card itself is gone too — a headline-sized "nothing found" is the
    // dead end this replaces, not something to keep beside the way out of it.
    // (The screen-reader-only live region still says it, which is correct —
    // that sentence exists so a reader hears the answer without seeing it.)
    expect(document.querySelector('.font-display')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'how much this month' }))
    expect(box.value).toBe('how much this month')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('leaves Ask on Escape rather than only dropping the keyboard', async () => {
    const { box } = setup({ corpus })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'how much{Escape}')

    expect(box.value).toBe('')
    expect(box.placeholder).toBe('What happened?')
  })
})

describe('what the box can be asked', () => {
  const corpus = [
    entry({ occurred_on: TODAY, kind: 'expense', title: 'lunch swiggy', amount_paise: 35000, duration_minutes: null }),
  ]

  it('says what Ask answers, because a blank box and a placeholder do not', async () => {
    setup({ corpus })
    expect(screen.queryByRole('button', { name: 'how much this month' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByRole('button', { name: 'how much this month' })).toBeTruthy()
  })

  it('answers the question it suggested rather than filing it away', async () => {
    // The whole point of tapping one: half the app was reachable and unknowable
    // at the same time, and the other half of that trap is a suggestion that
    // silently becomes a note.
    const { box, onSubmit } = setup({ corpus })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.click(screen.getByRole('button', { name: 'how much this month' }))

    expect(box.value).toBe('how much this month')
    // The answer, not the row it is totalled from — both print ₹350.
    expect(screen.getByText(/₹350 · 1 entry/)).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('gets out of the way as soon as there is a question', async () => {
    const { box } = setup({ corpus })
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await userEvent.type(box, 'lunch')

    expect(screen.queryByRole('button', { name: 'how much this month' })).toBeNull()
  })

  it('leaves the log examples to Log, so an empty day never shows two lists', async () => {
    setup({ corpus, showExamples: true })
    expect(screen.getByRole('button', { name: /350 lunch swiggy/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.queryByRole('button', { name: /350 lunch swiggy/ })).toBeNull()
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

  it('opens the entry an answer row points at, and clears the question', async () => {
    // The row that was tapped, whole — not just its date. Handed the date
    // alone, the caller could only change the day, which on the Ask screen
    // looked exactly like the search being wiped for no reason.
    const { box, onOpenEntry } = setup({ corpus })
    await userEvent.type(box, '? gym')
    await userEvent.click(screen.getByText('gym again'))

    expect(onOpenEntry).toHaveBeenCalledTimes(1)
    const opened = onOpenEntry.mock.calls[0]?.[0]
    expect(opened?.title).toBe('gym again')
    expect(opened?.occurred_on).toBe('2026-09-03')
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

describe('attaching a photo while composing', () => {
  const jpeg = () => new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })

  const inputs = () =>
    [...document.querySelectorAll('input[type="file"]')] as HTMLInputElement[]
  /** The gallery half — plain, multiple, no `capture`. */
  const picker = () => inputs().filter((input) => !input.hasAttribute('capture'))[0] as HTMLInputElement

  beforeEach(() => {
    vi.mocked(put).mockClear()
    vi.mocked(fromFile).mockClear()
  })

  it('offers gallery and camera while logging and neither while asking', async () => {
    const { view } = setup()
    expect(screen.getByLabelText('Add from gallery')).toBeTruthy()
    expect(screen.getByLabelText('Take photo')).toBeTruthy()

    // `capture` is the only thing that reaches the camera in an Android
    // WebView, and the only thing that would lose the gallery if it were on
    // the sole input. One of each, therefore.
    expect(inputs()).toHaveLength(2)
    expect(inputs().filter((input) => input.hasAttribute('capture'))).toHaveLength(1)
    expect(picker().multiple).toBe(true)

    // The `lg` toggle, which is what these tests drive instead of the nav.
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.queryByLabelText('Add from gallery')).toBeNull()
    expect(screen.queryByLabelText('Take photo')).toBeNull()
    view.unmount()
  })

  it('shows a removable thumbnail before anything is saved', async () => {
    setup()
    await userEvent.upload(picker(), jpeg())

    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(1))
    // Staged only — nothing may reach the store until there is an entry id.
    expect(put).not.toHaveBeenCalled()

    await userEvent.click(screen.getByLabelText('Remove photo'))
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  /**
   * Several multi-MB originals decoding at once on Save is what cost the
   * second of two camera photos. Spread across the taps that chose them
   * instead, so only one is ever in the WebView's native heap.
   */
  it('processes each photo as it is picked, not in a burst on save', async () => {
    const { box } = setup()
    await userEvent.upload(picker(), jpeg())

    await waitFor(() => expect(fromFile).toHaveBeenCalledTimes(1))
    expect(put).not.toHaveBeenCalled()

    await userEvent.type(box, '350 lunch swiggy')
    await userEvent.click(screen.getByLabelText('Save entry'))
    // Saving files what was already processed; it does not decode again.
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(fromFile).toHaveBeenCalledTimes(1)
  })

  it('opens a staged photo full-size when its thumbnail is tapped', async () => {
    setup()
    await userEvent.upload(picker(), jpeg())
    await waitFor(() => expect(screen.getByLabelText('View photo')).toBeTruthy())

    await userEvent.click(screen.getByLabelText('View photo'))
    expect(screen.getByRole('dialog', { name: 'Photo' })).toBeTruthy()
  })

  it('files the photo against the id of the row that was just created', async () => {
    const { box, onSubmit } = setup()
    await userEvent.upload(picker(), jpeg())
    await userEvent.type(box, '350 lunch swiggy')
    await userEvent.click(screen.getByLabelText('Save entry'))

    const saved = onSubmit.mock.results[0]?.value as Row
    await waitFor(() => expect(put).toHaveBeenCalledWith(saved.id, expect.anything()))
    // The strip belongs to the composition, which is over.
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('attaches to the first row of a batch rather than dropping the photo', async () => {
    const { box, onSubmitMulti } = setup()
    await userEvent.upload(picker(), jpeg())
    await userEvent.type(box, 'groceries: milk 60, bread 40')
    await userEvent.click(screen.getByLabelText('Save entry'))

    const rows = onSubmitMulti.mock.results[0]?.value as Row[]
    expect(rows.length).toBeGreaterThan(1)
    await waitFor(() => expect(put).toHaveBeenCalledWith(rows[0]?.id, expect.anything()))
    expect(put).toHaveBeenCalledTimes(1)
  })

  /**
   * The entry is saved and on the timeline. Saying it failed because a JPEG
   * would not store is a lie about the thing the user actually came to do —
   * the same split `EntryEditor` keeps for a photo added after the fact.
   */
  it('reports a failed photo without claiming the entry failed', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('quota'))
    const { box, onSubmit } = setup()
    await userEvent.upload(picker(), jpeg())
    await userEvent.type(box, '350 lunch swiggy')
    await userEvent.click(screen.getByLabelText('Save entry'))

    expect(onSubmit).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/entry saved, but/i),
    )
  })

  /**
   * "1 of 2 photos couldn't be attached" named the arithmetic and not the
   * problem, which is the wrong half to keep when the whole question is why.
   */
  it('names the reason a photo could not be attached', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('quota exceeded'))
    const { box } = setup()
    await userEvent.upload(picker(), jpeg())
    await userEvent.type(box, '350 lunch swiggy')
    await userEvent.click(screen.getByLabelText('Save entry'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/quota exceeded/))
  })

  /** A file that cannot be decoded says so while it is still on screen. */
  it('reports a photo that could not be processed at pick time', async () => {
    vi.mocked(fromFile).mockRejectedValueOnce(new Error('too large'))
    setup()
    await userEvent.upload(picker(), jpeg())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too large/))
    expect(document.querySelectorAll('img')).toHaveLength(0)
  })

  it('still stores the others when one of several fails', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('quota'))
    const { box } = setup()
    await userEvent.upload(picker(), [jpeg(), jpeg(), jpeg()])
    await userEvent.type(box, '350 lunch swiggy')
    await userEvent.click(screen.getByLabelText('Save entry'))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('alert').textContent).toMatch(/1 of 3/)
  })
})
