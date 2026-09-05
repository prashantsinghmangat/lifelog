// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntryEditor } from './EntryEditor'
import type { Patch, Row } from '../hooks/useEntries'

/** Edit → save, the journey where a wrong parse gets corrected. */

afterEach(cleanup)

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
      onSave={onSave}
      onDelete={onDelete}
      onAddToCalendar={onAddToCalendar}
      onClose={onClose}
    />,
  )

  const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }))
  return { onSave, onDelete, onAddToCalendar, onClose, save }
}

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
