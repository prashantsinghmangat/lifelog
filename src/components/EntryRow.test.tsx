// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntryRow } from './EntryRow'
import type { Row } from '../hooks/useEntries'

/**
 * `queued` and `failed` look almost alike — a line of grey text under the
 * title — and the one difference that matters is whether a Retry chip sits
 * beside them. Get that backwards and either every offline write looks
 * broken, or a real refusal goes silent.
 */

afterEach(cleanup)

const NOW = new Date(2026, 8, 17, 10, 0, 0)

function row(over: Partial<Row>): Row {
  return {
    id: 'row-1',
    kind: 'expense',
    occurred_on: '2026-09-17',
    occurred_at: null,
    title: 'lunch',
    note: null,
    amount_paise: 35000,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-17T09:00:00+05:30',
    ...over,
  }
}

describe('sync state', () => {
  it('a queued row says so quietly and renders no Retry chip', () => {
    render(<EntryRow row={row({ status: 'queued' })} now={NOW} onOpen={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByText(/saved here, not synced/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
  })

  it('a failed row gets a Retry chip', () => {
    render(<EntryRow row={row({ status: 'failed' })} now={NOW} onOpen={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getByText(/the server refused this/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry saving lunch' })).toBeTruthy()
  })

  it('a saved row has neither the sync line nor a Retry chip', () => {
    render(<EntryRow row={row({ status: undefined })} now={NOW} onOpen={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.queryByText(/saved here, not synced/)).toBeNull()
    expect(screen.queryByText(/the server refused this/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull()
  })
})

describe('local photo thumbnail', () => {
  /** Driven by a prop, never by `row` itself — the store, not the synced entry, owns this. */
  it('renders the image when the caller has one for this entry', () => {
    render(
      <EntryRow row={row({})} now={NOW} photoUrl="blob:fake" onOpen={vi.fn()} onRetry={vi.fn()} />,
    )
    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toBe('blob:fake')
  })

  it('renders neither an image nor the old text line without one', () => {
    render(<EntryRow row={row({})} now={NOW} onOpen={vi.fn()} onRetry={vi.fn()} />)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.queryByText(/has a photo/)).toBeNull()
  })

  /**
   * The row already announces its title, kind, value and sync state. An
   * accessible name on the image would add "image" to all of that and say
   * nothing the row does not — the button around it carries the name instead.
   */
  it('is decorative, so it adds nothing to what the row announces', () => {
    render(
      <EntryRow row={row({})} now={NOW} photoUrl="blob:fake" onOpen={vi.fn()} onRetry={vi.fn()} />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  /**
   * The whole row opens the editor, so a thumbnail inside that button would
   * mean tapping the picture does everything except show the picture.
   */
  it('opens the photo rather than the entry when it is tapped', async () => {
    const onOpen = vi.fn()
    const onOpenPhoto = vi.fn()
    render(
      <EntryRow
        row={row({})}
        now={NOW}
        photoUrl="blob:fake"
        onOpen={onOpen}
        onOpenPhoto={onOpenPhoto}
        onRetry={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'View photo on lunch' }))
    expect(onOpenPhoto).toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('has no second target on a row with no photo', () => {
    render(<EntryRow row={row({})} now={NOW} onOpen={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^View photo/ })).toBeNull()
  })

  it('says nothing about a count when there is only one', () => {
    render(
      <EntryRow
        row={row({})}
        now={NOW}
        photoUrl="blob:fake"
        photoCount={1}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.queryByText(/^\+/)).toBeNull()
    expect(screen.getByRole('button', { name: 'View photo on lunch' })).toBeTruthy()
  })

  /**
   * The remainder, beside a picture you can already see — and the *total* in
   * the name, because "+2" read aloud is arithmetic rather than a fact about
   * the entry.
   */
  it('draws the remainder and names the total when there are several', () => {
    render(
      <EntryRow
        row={row({})}
        now={NOW}
        photoUrl="blob:fake"
        photoCount={3}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View 3 photos on lunch' })).toBeTruthy()
  })
})

describe('the ledger anatomy', () => {
  it('leads with the clock column and badges the kind in its own colour', () => {
    render(<EntryRow row={row({})} now={NOW} onOpen={vi.fn()} onRetry={vi.fn()} />)

    // The badge replaces glyph and node alike: the only ₹ left is the value.
    expect(screen.getAllByText(/₹/)).toHaveLength(1)
    expect(screen.getByText('₹350')).toBeTruthy()
    const badge = document.querySelector('.bg-expense\\/10') as HTMLElement
    expect(badge).toBeTruthy()
    expect(badge.textContent).toBe('expense')
    // Hidden from readers — the sr-only kind name says it once, properly.
    expect(badge.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(/Expense/)).toBeTruthy()
  })

  it('gives a done event the completed chip and the strike, never a value', () => {
    render(
      <EntryRow
        // 8am, behind the 10am NOW: behindYou says done.
        row={row({
          kind: 'event',
          amount_paise: null,
          title: 'dentist',
          occurred_at: '2026-09-17T08:00:00+05:30',
        })}
        now={NOW}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('completed')).toBeTruthy()
    expect(screen.getByText('dentist').className).toContain('line-through')
  })
})
