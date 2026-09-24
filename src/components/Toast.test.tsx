// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

/**
 * The announcement, not the appearance. Undo is the only way back from a
 * delete — this app deliberately has no "are you sure?" — so a toast that is
 * never read out is a delete with no way back for anyone using a screen reader.
 */
afterEach(cleanup)

describe('the toast as a live region', () => {
  it('is in the document before there is anything to say', () => {
    // The precondition the whole mechanism rests on. Mounted in the same commit
    // as its text, a live region is routinely not announced at all — so the
    // region has to already be there, and empty.
    render(<Toast toast={null} onDismiss={vi.fn()} />)

    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
  })

  it('takes no room while it is empty', () => {
    // It sits directly above the capture control, so a region that kept its
    // margin would hold 8px of dead space there for the life of the app.
    render(<Toast toast={null} onDismiss={vi.fn()} />)
    expect(screen.getByRole('status').className).not.toContain('mb-2')
  })

  it('puts the message and its action into that same region', () => {
    const { rerender } = render(<Toast toast={null} onDismiss={vi.fn()} />)
    const region = screen.getByRole('status')

    rerender(<Toast toast={{ text: 'Deleted lunch', action: { label: 'Undo', run: vi.fn() } }} onDismiss={vi.fn()} />)

    expect(region.textContent).toContain('Deleted lunch')
    expect(region.textContent).toContain('Undo')
    expect(screen.getByRole('status')).toBe(region)
  })

  it('does not hand a half-finished swipe to the next message', () => {
    // The component stays mounted between messages now, so the drag offset no
    // longer resets by unmounting. A new toast arriving already pushed aside
    // and half faded out is the visible cost of forgetting that.
    const { rerender } = render(<Toast toast={{ text: 'first' }} onDismiss={vi.fn()} />)

    const bar = screen.getByText('first').parentElement
    if (bar === null) throw new Error('no bar')
    // jsdom has no pointer capture; the component asks for it on every drag.
    bar.setPointerCapture = () => {}

    fireEvent.pointerDown(bar, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(bar, { clientX: 60, pointerId: 1 })
    expect(bar.style.transform).toBe('translateX(60px)')

    rerender(<Toast toast={{ text: 'second' }} onDismiss={vi.fn()} />)

    const next = screen.getByText('second').parentElement
    expect(next?.style.transform).toBe('')
  })

  it('still dismisses on the close button', async () => {
    const onDismiss = vi.fn()
    render(<Toast toast={{ text: 'Reminder set' }} onDismiss={onDismiss} />)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
