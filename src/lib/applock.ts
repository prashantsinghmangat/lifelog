/**
 * The app lock's state and arithmetic, with nothing of the OS in it.
 *
 * The OS does the verifying — BiometricPrompt on Android, which offers the
 * device PIN/pattern as its own fallback — and this module only decides *when*
 * to ask: it holds the switch, the chosen timeout, and the moment the app last
 * left the foreground. Storage-injected and pure, parser-style, so the timeout
 * rules are testable without a device. It sits above the identity gate and
 * below nothing: guest mode is locked by exactly the same state, and Supabase
 * is never consulted.
 *
 * `pausedAt` is persisted rather than kept in a variable because the process
 * can die while backgrounded, and a cold launch must still know how long the
 * app was away. Anything that cannot *prove* the absence was shorter than the
 * timeout — a missing stamp, a stamp from the future — reads as locked.
 */

const KEY = 'lifelog.lock'

/** The timeouts on offer, in milliseconds of background forgiven. 0 is immediately. */
export const LOCK_AFTER = [
  { ms: 0, label: 'Immediately' },
  { ms: 60_000, label: '1 minute' },
  { ms: 300_000, label: '5 minutes' },
] as const

export type LockState = {
  on: boolean
  /** One of `LOCK_AFTER`'s ms values. */
  after: number
  /** Epoch ms of the last pause, or null when there is nothing to forgive. */
  pausedAt: number | null
}

/** Off, and a 1-minute timeout once on — quick pocket-to-pocket re-entries stay free. */
export const DEFAULT_LOCK: LockState = { on: false, after: 60_000, pausedAt: null }

/** The stored state, or the default when absent or unreadable. */
export function loadLock(storage: Pick<Storage, 'getItem'>): LockState {
  try {
    const raw = storage.getItem(KEY)
    if (raw === null) return DEFAULT_LOCK
    const parsed = JSON.parse(raw) as Partial<LockState>
    return {
      on: parsed.on === true,
      after: LOCK_AFTER.some((option) => option.ms === parsed.after)
        ? (parsed.after as number)
        : DEFAULT_LOCK.after,
      pausedAt: typeof parsed.pausedAt === 'number' ? parsed.pausedAt : null,
    }
  } catch {
    return DEFAULT_LOCK
  }
}

export function saveLock(storage: Pick<Storage, 'setItem'>, state: LockState): void {
  try {
    storage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Quota. The lock still works this launch; the stamp is what degrades.
  }
}

/** The moment the app left the foreground, recorded. */
export function stamp(state: LockState, now: number): LockState {
  return { ...state, pausedAt: now }
}

/**
 * Whether the overlay should be up right now.
 *
 * A missing stamp locks (cold launch, a cleared store), and a stamp from the
 * future locks too (a clock that went backwards) — both are states that cannot
 * prove the app was only briefly away, and the safe answer is the same.
 */
export function shouldLock(state: LockState, now: number): boolean {
  if (!state.on) return false
  if (state.pausedAt === null) return true
  if (now < state.pausedAt) return true
  return now - state.pausedAt >= state.after
}
