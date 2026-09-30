// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotoViewer } from './PhotoViewer'

/**
 * The viewer spent two specs being invisible — once behind the editor, once
 * inside a sheet that shrank it. What is pinned here is what it shows and in
 * what order, because neither was ever the thing a test was asking about.
 */

afterEach(cleanup)

const three = [
  { id: 'p1', url: 'blob:one' },
  { id: 'p2', url: 'blob:two' },
  { id: 'p3', url: 'blob:three' },
]

function src() {
  return document.querySelector('img')?.getAttribute('src')
}

describe('which photo is on screen', () => {
  it('opens on the one that was tapped, not the first', () => {
    render(<PhotoViewer photos={three} index={1} onClose={vi.fn()} />)
    expect(src()).toBe('blob:two')
    expect(screen.getByText('2 / 3')).toBeTruthy()
  })

  it('moves forward and back through the set', async () => {
    render(<PhotoViewer photos={three} index={0} onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(src()).toBe('blob:two')

    await userEvent.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(src()).toBe('blob:one')
  })

  /** Nothing wraps: the ends of a set are ends, not a loop with no edges. */
  it('offers no way back from the first or on from the last', () => {
    const { unmount } = render(<PhotoViewer photos={three} index={0} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Previous photo' })).toBeNull()
    unmount()

    render(<PhotoViewer photos={three} index={2} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull()
  })

  it('says nothing about a set when there is only one photo', () => {
    render(<PhotoViewer photos={[three[0]!]} index={0} onClose={vi.fn()} />)
    expect(screen.queryByText(/\d \/ \d/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull()
  })
})

describe('getting out', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<PhotoViewer photos={three} index={0} onClose={onClose} />)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on the close control', async () => {
    const onClose = vi.fn()
    render(<PhotoViewer photos={three} index={0} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Close photo' }))
    expect(onClose).toHaveBeenCalled()
  })

  /**
   * It stopped using `Sheet` to get the whole screen, which means everything
   * `Sheet` was quietly doing is now its own — and this is the one that would
   * be silent if it were dropped.
   */
  it('is a modal dialog in its own right, since it is no longer a Sheet', () => {
    render(<PhotoViewer photos={three} index={0} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Photo' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })
})
