import { describe, expect, it, vi } from 'vitest'
import { back, onBack, onHome } from './back'

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

  /**
   * The layer the bottom nav added. Three destinations became reachable in one
   * tap, and back is how an Android reader leaves any of them — without this,
   * leaving You put the launcher in front of a log that was still running,
   * which is the same class of bug `@capacitor/app` was added to fix.
   */
  it('comes home from a destination rather than dismissing the app', () => {
    const go = vi.fn()
    const off = onHome(go)

    expect(back()).toBe('home')
    expect(go).toHaveBeenCalledTimes(1)
    off()
  })

  it('minimises once it is already home', () => {
    const go = vi.fn()
    onHome(go)()

    expect(back()).toBe('root')
    expect(go).not.toHaveBeenCalled()
  })

  /**
   * Order is what makes two presses read correctly: the editor opened from the
   * calendar closes *onto* the calendar, and only the next press comes home.
   * Coming home first would leave a sheet on screen over a screen it was never
   * opened from.
   */
  it('closes the sheet before it leaves the destination', () => {
    const close = vi.fn()
    const go = vi.fn()
    const offHome = onHome(go)
    const offSheet = onBack(close)

    expect(back()).toBe('closed')
    expect(close).toHaveBeenCalledTimes(1)
    expect(go).not.toHaveBeenCalled()

    offSheet()
    expect(back()).toBe('home')
    expect(go).toHaveBeenCalledTimes(1)

    offHome()
    expect(back()).toBe('root')
  })

  /**
   * One home, not a stack of them: the destinations do not nest, so a second
   * registration replaces the first rather than piling up behind it. The guard
   * is on identity, so the replaced handler's cleanup cannot clear a slot that
   * is no longer its own — the same reason `onBack` splices by function.
   */
  it('keeps one way home, and the newest one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onHome(first)
    const offSecond = onHome(second)

    offFirst()
    expect(back()).toBe('home')
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    offSecond()
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
