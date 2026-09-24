// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'
import { back } from '../lib/back'

/**
 * Journeys, not rendering. `back()` is what Android's back button calls, and
 * the defect it exists for was the event reaching nothing at all — the app
 * went to the launcher with the editor still open behind it.
 *
 * The point of testing it *here* rather than only in `back.test.ts` is the
 * wiring: a sheet that forgets to register is a sheet that back walks straight
 * past, and nothing else on the screen would look any different.
 */
afterEach(cleanup)

describe('a sheet and the back button', () => {
  it('closes on back, through the same close everything else uses', () => {
    const onClose = vi.fn()
    render(
      <Sheet label="Edit lunch" onClose={onClose}>
        <p>fields</p>
      </Sheet>,
    )

    expect(back()).toBe('closed')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops answering once it has gone, so back belongs to the app again', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <Sheet label="Pick a date" onClose={onClose}>
        <p>calendar</p>
      </Sheet>,
    )

    unmount()

    expect(back()).toBe('root')
    expect(onClose).not.toHaveBeenCalled()
  })

  /**
   * Every caller passes an inline `() => setEditing(null)`, so `onClose` is a
   * new function on every render — and the page re-renders on the 30-second
   * clock tick. Registering against the prop would re-register on each of
   * those; registering against a stale copy would call a closure that no
   * longer closes anything.
   */
  it('calls the current close after the page has re-rendered', () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { rerender } = render(
      <Sheet label="Profile" onClose={stale}>
        <p>settings</p>
      </Sheet>,
    )

    rerender(
      <Sheet label="Profile" onClose={fresh}>
        <p>settings</p>
      </Sheet>,
    )

    expect(back()).toBe('closed')
    expect(fresh).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()
  })

  // The three ways out have to stay one way out: back, Escape and the scrim all
  // reach the same handler, or closing a sheet means three things.
  it('leaves Escape and the scrim working exactly as before', async () => {
    const onClose = vi.fn()
    render(
      <Sheet label="What is coming" onClose={onClose}>
        <p>coming up</p>
      </Sheet>,
    )

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    const scrim = screen.getByRole('dialog').parentElement
    if (scrim === null) throw new Error('no scrim')
    await userEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('keeping focus inside the sheet', () => {
  it('wraps Shift+Tab from the dialog itself round to the last control', async () => {
    // Focus lands on the panel when a sheet opens — deliberately, so the
    // keyboard starts inside without the ring landing on a control that reads
    // as a claim about the entry. But the panel is `tabindex="-1"` and so is
    // not one of the trap's own boundaries, and Shift+Tab as the first key went
    // straight past it to whatever precedes the sheet in document order: a
    // control behind the scrim, focused and invisible.
    render(
      <>
        <button type="button">behind the scrim</button>
        <Sheet label="Edit lunch" onClose={vi.fn()}>
          <button type="button">first</button>
          <button type="button">last</button>
        </Sheet>
      </>,
    )

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    await userEvent.tab({ shift: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })

  it('wraps forward off the last control back to the first', async () => {
    render(
      <Sheet label="Edit lunch" onClose={vi.fn()}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Sheet>,
    )

    screen.getByRole('button', { name: 'last' }).focus()
    await userEvent.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('does not treat a disabled control as the edge of the trap', async () => {
    // A disabled node cannot take focus, so `.focus()` on it is a silent no-op
    // and focus falls to `<body>` — outside the dialog. `You` renders exactly
    // this shape, and is shown inside a Sheet on a wide screen.
    render(
      <Sheet label="You" onClose={vi.fn()}>
        <button type="button">theme</button>
        <button type="button" disabled>
          save
        </button>
      </Sheet>,
    )

    screen.getByRole('button', { name: 'theme' }).focus()
    await userEvent.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'theme' }))
  })
})

describe('two sheets at once', () => {
  it('closes only the one on top when Escape is pressed', async () => {
    // The manual opens from the You sheet, so this is an ordinary path and not
    // a contrived one. Escape listens on `window`, so without a check for depth
    // both sheets answered the same press — and focus then returned to the
    // button that had just unmounted with the sheet underneath.
    const closeUnder = vi.fn()
    const closeOver = vi.fn()
    render(
      <>
        <Sheet label="You" onClose={closeUnder}>
          <p>settings</p>
        </Sheet>
        <Sheet label="How to use lifelog" onClose={closeOver}>
          <p>manual</p>
        </Sheet>
      </>,
    )

    await userEvent.keyboard('{Escape}')

    expect(closeOver).toHaveBeenCalledTimes(1)
    expect(closeUnder).not.toHaveBeenCalled()
  })
})
