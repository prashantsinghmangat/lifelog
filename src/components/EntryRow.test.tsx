// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
   * accessible name here would add "image" to all of that and say nothing the
   * row does not already say.
   */
  it('is decorative, so it adds nothing to what the row announces', () => {
    render(
      <EntryRow row={row({})} now={NOW} photoUrl="blob:fake" onOpen={vi.fn()} onRetry={vi.fn()} />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(document.querySelector('img')?.getAttribute('alt')).toBe('')
  })
})
