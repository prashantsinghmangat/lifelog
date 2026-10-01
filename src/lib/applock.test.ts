import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCK, LOCK_AFTER, loadLock, saveLock, shouldLock, stamp } from './applock'

function store(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  }
}

describe('the stored lock state', () => {
  it('defaults off, with a 1-minute timeout', () => {
    expect(loadLock(store())).toEqual({ on: false, after: 60_000, pausedAt: null })
    expect(shouldLock(loadLock(store()), Date.UTC(2026, 9, 1))).toBe(false)
  })

  it('round-trips through storage', () => {
    const held = store()
    const state = stamp({ on: true, after: 300_000, pausedAt: null }, 1_000)
    saveLock(held, state)
    expect(loadLock(held)).toEqual(state)
  })

  it('falls back to the default on corrupt JSON rather than throwing', () => {
    expect(loadLock(store({ 'lifelog.lock': '{not json' }))).toEqual(DEFAULT_LOCK)
  })

  it('coerces an unknown timeout back to the default', () => {
    expect(loadLock(store({ 'lifelog.lock': '{"on":true,"after":12345}' })).after).toBe(60_000)
  })
})

describe('when the overlay goes up', () => {
  const on = { on: true, after: 60_000, pausedAt: null }

  it('never while the lock is off, stamp or no stamp', () => {
    expect(shouldLock({ ...on, on: false }, 10_000)).toBe(false)
    expect(shouldLock(stamp({ ...on, on: false }, 0), 999_999)).toBe(false)
  })

  it('a background shorter than the timeout returns straight to the app', () => {
    expect(shouldLock(stamp(on, 10_000), 10_000 + 59_999)).toBe(false)
  })

  it('a background past the timeout locks', () => {
    expect(shouldLock(stamp(on, 10_000), 10_000 + 60_000)).toBe(true)
  })

  it('a missing stamp locks — a cold launch cannot prove it was only briefly away', () => {
    expect(shouldLock(on, 10_000)).toBe(true)
  })

  it('Immediately locks on any resume at all', () => {
    const immediate = { ...on, after: 0 }
    expect(shouldLock(stamp(immediate, 10_000), 10_000)).toBe(true)
  })

  it('a stamp from the future locks — a clock that went backwards proves nothing', () => {
    expect(shouldLock(stamp(on, 20_000), 10_000)).toBe(true)
  })

  it('offers exactly the three agreed timeouts', () => {
    expect(LOCK_AFTER.map((option) => option.label)).toEqual([
      'Immediately',
      '1 minute',
      '5 minutes',
    ])
  })
})
