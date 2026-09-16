import { describe, expect, it, vi } from 'vitest'
import { back, onBack } from './back'

/**
 * The Android back button, which was dismissing the whole app while a sheet sat
 * open behind it. The event is native and the fix is not: what back *means* is
 * decided here, in a pure function, precisely so that this can be tested
 * without an emulator attached.
 */
describe('what back does', () => {
  it('is the app\'s own business when nothing is open', () => {
    expect(back()).toBe('root')
  })

  it('closes the sheet that is open', () => {
    const close = vi.fn()
    const off = onBack(close)

    expect(back()).toBe('closed')
    expect(close).toHaveBeenCalledTimes(1)
    off()
  })

  it('closes only the one you can see', () => {
    const under = vi.fn()
    const over = vi.fn()
    const first = onBack(under)
    const second = onBack(over)

    expect(back()).toBe('closed')
    expect(over).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()

    second()
    first()
  })

  it('hands back to the app once the sheet has gone', () => {
    const close = vi.fn()
    onBack(close)()

    expect(back()).toBe('root')
    expect(close).not.toHaveBeenCalled()
  })

  // Sheets unmount in whatever order React unmounts them, so removing by
  // position would eventually take the wrong one out of the stack and leave a
  // closed sheet's handler to answer for an open one.
  it('removes the sheet that went, not the one at its index', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const offOuter = onBack(outer)
    const offInner = onBack(inner)

    offOuter()

    expect(back()).toBe('closed')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    offInner()
    expect(back()).toBe('root')
  })

  /**
   * Pressing back *asks* the sheet to close; it does not decide that it has.
   * A stack that popped itself would leave a sheet still on screen with nothing
   * listening — which is the original bug, one press later — any time a close
   * is refused, deferred, or simply re-rendered rather than unmounted.
   * Deregistering belongs to the unmount, and only to the unmount.
   */
  it('keeps answering until the sheet actually goes away', () => {
    const close = vi.fn()
    const off = onBack(close)

    expect(back()).toBe('closed')
    expect(back()).toBe('closed')
    expect(close).toHaveBeenCalledTimes(2)

    off()
  })
})
