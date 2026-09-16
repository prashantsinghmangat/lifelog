// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntryEditor } from './EntryEditor'
import type { Patch, Row } from '../hooks/useEntries'

/** Edit → save, the journey where a wrong parse gets corrected. */

afterEach(cleanup)

/** Saturday, mid-morning — the fixtures sit on this day. */
const NOW = new Date('2026-09-05T10:30:00+05:30')

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'row-1',
    kind: 'expense',
    occurred_on: '2026-09-05',
    occurred_at: null,
    title: 'lunch swiggy',
    note: null,
    amount_paise: 35000,
    duration_minutes: null,
    category: 'food',
    data: {},
    created_at: '2026-09-05T10:00:00+05:30',
    ...over,
  }
}

function setup(over: Partial<Row> = {}) {
  const onSave = vi.fn<(patch: Patch) => void>()
  const onDelete = vi.fn()
  const onAddToCalendar = vi.fn()
  const onClose = vi.fn()

  render(
    <EntryEditor
      row={row(over)}
      now={NOW}
      onSave={onSave}
      onDelete={onDelete}
      onAddToCalendar={onAddToCalendar}
      onClose={onClose}
    />,
  )

  const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }))
  return { onSave, onDelete, onAddToCalendar, onClose, save }
}

describe('when the entry next happens', () => {
  /**
   * The sheet could name the rule and not the moment.
   *
   * A repeat is stored once and expanded nowhere, so `weekdays` on the row was
   * the only evidence anything had taken effect — and it says what the rule is,
   * never that a moment is coming. Opening the entry and still not knowing when
   * it next lands is exactly how a working standup read as broken from inside
   * the app.
   */
  const standup = {
    kind: 'event',
    title: 'standup',
    occurred_on: '2026-09-07',
    occurred_at: '2026-09-07T10:00:00+05:30',
    amount_paise: null,
    category: null,
    data: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  } satisfies Partial<Row>

  it('names the moment a repeat next lands on, not just its rule', () => {
    setup(standup)
    expect(screen.getByText(/Next/).textContent).toContain('7 Sep at 10:00 am')
    // The rule is still there — the two answer different questions.
    expect(screen.getByText('weekdays')).toBeTruthy()
  })

  it('counts from the day the repeat starts, so it cannot land before it exists', () => {
    // The standup begins on Monday the 7th. Friday the 4th is a listed weekday
    // and is nearer, and answering with it is the bug that had the phone ringing
    // three days before the entry began.
    setup(standup)
    expect(screen.getByText(/Next/).textContent).not.toContain('4 Sep')
  })

  it('says a one-off reminder is coming, in the words the rest of the app uses', () => {
    setup({
      kind: 'event',
      title: 'call the bank',
      occurred_on: '2026-09-06',
      occurred_at: '2026-09-06T17:00:00+05:30',
      amount_paise: null,
      category: null,
    })
    expect(screen.getByText(/Next/).textContent).toContain('tomorrow at 5:00 pm')
  })

  it('reads 9am for an entry with no clock, which is when it would actually go', () => {
    setup({
      kind: 'event',
      title: 'deepak birthday',
      occurred_on: '2026-09-06',
      occurred_at: null,
      amount_paise: null,
      category: null,
      data: { rrule: 'FREQ=YEARLY' },
    })
    expect(screen.getByText(/Next/).textContent).toContain('tomorrow at 9:00 am')
  })

  it('stops claiming one once the moment has gone', () => {
    setup({
      kind: 'event',
      title: 'call the bank',
      occurred_on: '2026-09-05',
      occurred_at: '2026-09-05T08:00:00+05:30',
      amount_paise: null,
      category: null,
    })
    expect(screen.getByText('Its time has passed.')).toBeTruthy()
  })

  it('says that ticking it off is also how it is switched off', async () => {
    // Documented and nowhere on screen: `fireAt` returns null for a done event,
    // so Mark done silences the reminder. A line that went on promising a moment
    // after the tap would be the app's own description of what it just stopped.
    setup({
      kind: 'event',
      title: 'call the bank',
      occurred_on: '2026-09-06',
      occurred_at: '2026-09-06T17:00:00+05:30',
      amount_paise: null,
      category: null,
    })

    await userEvent.click(screen.getByRole('button', { name: /Mark done/ }))
    expect(screen.queryByText(/Next/)).toBeNull()
    expect(screen.getByText('Done — no reminder.')).toBeTruthy()
  })

  it('follows the fields rather than the stored row, so the line cannot lie', async () => {
    // Editable on arrival, so the time under the line is free to move. Reading
    // the *stored* row here would have left a confident sentence describing a
    // moment the Save button was about to replace.
    setup({
      kind: 'event',
      title: 'call the bank',
      occurred_on: '2026-09-06',
      occurred_at: '2026-09-06T17:00:00+05:30',
      amount_paise: null,
      category: null,
    })

    await userEvent.clear(screen.getByLabelText('Time'))
    await userEvent.type(screen.getByLabelText('Time'), '19:30')
    expect(screen.getByText(/Next/).textContent).toContain('tomorrow at 7:30 pm')
  })

  it('says nothing at all for a kind that is not waiting to happen', () => {
    setup({ kind: 'note', title: 'send the revised scope' })
    expect(screen.queryByText(/Next/)).toBeNull()
    expect(screen.queryByText('Its time has passed.')).toBeNull()
  })
})

describe('turning a repeat off', () => {
  /**
   * Typing `weekdays` set a repeat and nothing took it off again, so the only
   * way out was to delete the row and retype it — losing the entry to change one
   * thing about it.
   */
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }

  it('stops a weekly repeat', async () => {
    const { onSave, save } = setup({ kind: 'event', title: 'standup', data: weekdays })
    await userEvent.click(screen.getByRole('button', { name: 'Stop repeating' }))
    await save()

    expect(onSave.mock.calls[0]?.[0].data).not.toHaveProperty('rrule')
  })

  it('stops a yearly one and does not let the title put it back', async () => {
    // The wart that made this control impossible: the yearly rule was re-read
    // from the title on every save, so clearing a birthday's repeat lasted until
    // the next one. Nothing derives it now unless a note is being promoted.
    const { onSave, save } = setup({
      kind: 'event',
      title: 'deepak birthday',
      data: { rrule: 'FREQ=YEARLY' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Stop repeating' }))
    await save()

    expect(onSave.mock.calls[0]?.[0].data).not.toHaveProperty('rrule')
  })

  it('offers the way back before anything is saved', async () => {
    const { onSave, save } = setup({ kind: 'event', title: 'standup', data: weekdays })
    await userEvent.click(screen.getByRole('button', { name: 'Stop repeating' }))
    await userEvent.click(screen.getByRole('button', { name: 'Repeat weekdays again' }))
    await save()

    const patch = onSave.mock.calls[0]?.[0]
    expect((patch?.data ?? weekdays).rrule).toBe(weekdays.rrule)
  })

  it('says the entry is a one-off the moment the repeat is off', async () => {
    setup({ kind: 'event', title: 'standup', occurred_at: null, category: null, data: weekdays })
    expect(screen.getByText('weekdays')).toBeTruthy()
    // Marking done is withheld from anything that repeats, so its arrival is
    // the sheet agreeing this is now a single occurrence.
    expect(screen.queryByRole('button', { name: /Mark done/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Stop repeating' }))
    expect(screen.queryByText('weekdays')).toBeNull()
    expect(screen.getByRole('button', { name: /Mark done/ })).toBeTruthy()
  })

  it('can switch a yearly repeat on for a title that asks for one', async () => {
    // The other direction, and the only one worth offering: a weekly rule needs
    // its days, and the text box is where those are said.
    const { onSave, save } = setup({
      kind: 'event',
      title: 'deepak birthday',
      occurred_on: '2026-02-13',
      data: {},
    })
    await userEvent.click(screen.getByRole('button', { name: 'Repeat every year' }))
    await save()

    expect(onSave.mock.calls[0]?.[0].data).toMatchObject({ rrule: 'FREQ=YEARLY' })
  })

  it('offers nothing for an entry no repeat could apply to', () => {
    setup({ kind: 'event', title: 'call the bank', data: {} })
    expect(screen.queryByRole('button', { name: /repeat/i })).toBeNull()
  })

  it('keeps a stored yearly rule across an ordinary save', async () => {
    // The derivation moved to promotion only, so the guard that matters is that
    // an untouched anniversary still comes out of the sheet repeating.
    const { onSave, save } = setup({
      kind: 'event',
      title: 'deepak birthday',
      occurred_on: '2026-02-13',
      data: { rrule: 'FREQ=YEARLY' },
    })
    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'deepak birthday dinner')
    await save()

    const patch = onSave.mock.calls[0]?.[0]
    expect((patch?.data ?? { rrule: 'FREQ=YEARLY' }).rrule).toBe('FREQ=YEARLY')
  })
})

describe('ticking an entry off', () => {
  it('marks a note done, which the clock could never work out', async () => {
    const onSave = vi.fn()
    render(
      <EntryEditor
        row={row({ kind: 'note', title: 'send the revised scope' })}
        now={NOW}
        onSave={onSave}
        onDelete={vi.fn()}
        onAddToCalendar={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Mark done/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]?.[0]?.data).toMatchObject({ done: true })
  })

  it('takes the mark off again', async () => {
    const onSave = vi.fn()
    render(
      <EntryEditor
        row={row({ kind: 'note', title: 'send the revised scope', data: { done: true } })}
        now={NOW}
        onSave={onSave}
        onDelete={vi.fn()}
        onAddToCalendar={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // Already done, so the control offers the way back rather than repeating itself.
    await userEvent.click(screen.getByRole('button', { name: /Done/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]?.[0]?.data).not.toHaveProperty('done')
  })
})

describe('editing an entry', () => {
  it('opens with the stored values, already editable', () => {
    setup()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('lunch swiggy')
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-09-05')
    expect((screen.getByLabelText('Amount ₹') as HTMLInputElement).value).toBe('350')
  })

  it('saves an edited title', async () => {
    const { onSave, save } = setup()
    const title = screen.getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'dinner swiggy')
    await save()
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ title: 'dinner swiggy' })
  })

  it('refuses to save an empty title', async () => {
    const { onSave, save } = setup()
    await userEvent.clear(screen.getByLabelText('Title'))
    await save()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves an edited amount as paise', async () => {
    const { onSave, save } = setup()
    const amount = screen.getByLabelText('Amount ₹')
    await userEvent.clear(amount)
    await userEvent.type(amount, '347.50')
    await save()
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ amount_paise: 34750 })
  })
})

describe('the time, which is the whole entry for a reminder', () => {
  it('offers the stored clock time', () => {
    setup({ kind: 'event', occurred_at: '2026-09-05T17:00:00+05:30' })
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('17:00')
  })

  it('rebuilds the timestamp from both fields', async () => {
    const { onSave, save } = setup({ kind: 'event', occurred_at: '2026-09-05T17:00:00+05:30' })
    await userEvent.clear(screen.getByLabelText('Time'))
    await userEvent.type(screen.getByLabelText('Time'), '18:30')
    await save()
    expect(onSave.mock.calls[0]?.[0].occurred_at).toContain('T18:30:00')
  })

  it('clearing the time makes the entry all-day again', async () => {
    const { onSave, save } = setup({ kind: 'event', occurred_at: '2026-09-05T17:00:00+05:30' })
    await userEvent.clear(screen.getByLabelText('Time'))
    await save()
    expect(onSave.mock.calls[0]?.[0].occurred_at).toBeNull()
  })
})

describe('correcting the kind', () => {
  it('saves the chosen kind', async () => {
    const { onSave, save } = setup({ kind: 'note', title: 'dentist' })
    await userEvent.click(screen.getByRole('button', { name: 'Event' }))
    await save()
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ kind: 'event' })
  })

  it('reveals the amount field when switching to an expense', async () => {
    setup({ kind: 'note', title: 'chai', amount_paise: null })
    expect(screen.queryByLabelText('Amount ₹')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Expense' }))
    expect(screen.getByLabelText('Amount ₹')).toBeTruthy()
  })

  it('applies the yearly rule when a birthday note becomes an event', async () => {
    // The journey behind this: a birthday whose date had passed was parsed as a
    // note, so it never recurred and could not answer "when is it".
    const { onSave, save } = setup({ kind: 'note', title: 'deepak birthday', data: {} })
    await userEvent.click(screen.getByRole('button', { name: 'Event' }))
    await save()
    expect(onSave.mock.calls[0]?.[0].data).toMatchObject({ rrule: 'FREQ=YEARLY' })
  })

  it('drops the yearly rule when an anniversary stops being an event', async () => {
    const { onSave, save } = setup({
      kind: 'event',
      title: 'deepak birthday',
      data: { rrule: 'FREQ=YEARLY' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Note' }))
    await save()
    expect(onSave.mock.calls[0]?.[0].data).not.toHaveProperty('rrule')
  })

  it('leaves the rule alone when nothing about it changed', async () => {
    const { onSave, save } = setup({ kind: 'expense', title: 'lunch' })
    await save()
    expect(onSave.mock.calls[0]?.[0].data).toBeUndefined()
  })

  // The yearly rule is a reading of the title, so it is recomputed on save. A
  // weekly one is an instruction that appears nowhere in the title, and
  // recomputing it the same way deleted it — five alarms gone, with the row
  // still on screen looking exactly as it did.
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }

  it('keeps a weekly rule the title cannot vouch for', async () => {
    const { onSave, save } = setup({ kind: 'event', title: 'standup', data: weekdays })
    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'standup call')
    await save()

    // A patch that omits `data` leaves the stored one, so assert the rule the
    // row ends up with rather than the shape of the patch — a conditional
    // assertion here would pass by never running.
    const patch = onSave.mock.calls[0]?.[0]
    const after = patch?.data ?? weekdays
    expect(after.rrule).toBe(weekdays.rrule)
    expect(patch?.title).toBe('standup call')
  })

  it('drops a weekly rule when the entry stops being an event', async () => {
    const { onSave, save } = setup({ kind: 'event', title: 'standup', data: weekdays })
    await userEvent.click(screen.getByRole('button', { name: 'Note' }))
    await save()
    expect(onSave.mock.calls[0]?.[0].data).not.toHaveProperty('rrule')
  })
})

describe('something that repeats', () => {
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }

  it('says so, because no field on the sheet does', () => {
    setup({ kind: 'event', title: 'standup', data: weekdays })
    expect(screen.getByText(/weekdays/)).not.toBeNull()
  })

  // `done` lives on the row, so ticking off today's standup would silence every
  // Monday after it. The same reasoning already keeps `passed` false for these.
  it('cannot be ticked off, since done would silence it for ever', () => {
    setup({ kind: 'event', title: 'standup', data: weekdays })
    expect(screen.queryByRole('button', { name: /Mark done/ })).toBeNull()
  })

  it('still lets a one-off event be ticked off', () => {
    setup({ kind: 'event', title: 'dentist' })
    expect(screen.queryByRole('button', { name: /Mark done/ })).not.toBeNull()
  })
})

describe('the other actions', () => {
  it('offers the calendar only for events', async () => {
    const { onAddToCalendar } = setup({ kind: 'event', title: 'dentist' })
    await userEvent.click(screen.getByRole('button', { name: 'Add to calendar' }))
    expect(onAddToCalendar).toHaveBeenCalled()
  })

  it('hides the calendar for anything else', () => {
    setup({ kind: 'expense' })
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull()
  })

  it('deletes without a confirmation, because undo covers it', async () => {
    const { onDelete } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalled()
  })
})

describe('a save that cannot go through', () => {
  // Pressing Save and having nothing happen at all is the silence the rest of
  // the app spent three bugs learning to avoid.

  it('says why an amount beyond the column is refused, rather than owing it for ever', async () => {
    // `amount_paise` is a Postgres `integer`: bigger than this and the row is
    // saved here, counted into the day, and rejected by the server on every
    // attempt from now on.
    const { onSave, save } = setup()
    const amount = screen.getByLabelText('Amount ₹')
    await userEvent.clear(amount)
    await userEvent.type(amount, '99999999999')
    await save()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('₹2,14,74,836.47')
  })

  it('takes the largest amount that does fit', async () => {
    const { onSave, save } = setup()
    const amount = screen.getByLabelText('Amount ₹')
    await userEvent.clear(amount)
    await userEvent.type(amount, '21474836.47')
    await save()

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ amount_paise: 2_147_483_647 })
  })

  it('refuses a duration past the same ceiling', async () => {
    const { onSave, save } = setup({ kind: 'time', duration_minutes: 60, amount_paise: null })
    const minutes = screen.getByLabelText('Minutes')
    await userEvent.clear(minutes)
    await userEvent.type(minutes, '99999999999')
    await save()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('says an entry needs a title instead of doing nothing', async () => {
    const { onSave, save } = setup()
    await userEvent.clear(screen.getByLabelText('Title'))
    await save()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('title')
  })
})
