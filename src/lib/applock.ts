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

/**
 * The floor under a trusted pause, regardless of the chosen timeout — long
 * enough for the camera or gallery picker to open and return, short enough
 * that a phone actually left behind during one still locks.
 */
export const TRUSTED_PAUSE_GRACE_MS = 15_000

export type LockState = {
  on: boolean
  /** One of `LOCK_AFTER`'s ms values. */
  after: number
  /** Epoch ms of the last pause, or null when there is nothing to forgive. */
  pausedAt: number | null
  /** Whether that pause was one the app itself caused (a photo picker). */
  pausedTrusted: boolean
}

/** Off, and a 1-minute timeout once on — quick pocket-to-pocket re-entries stay free. */
export const DEFAULT_LOCK: LockState = {
  on: false,
  after: 60_000,
  pausedAt: null,
  pausedTrusted: false,
}

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
      pausedTrusted: parsed.pausedTrusted === true,
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
export function stamp(state: LockState, now: number, trusted = false): LockState {
  return { ...state, pausedAt: now, pausedTrusted: trusted }
}

/**
 * Whether a cold launch should start locked.
 *
 * A missing stamp locks (a process killed without pausing, a cleared store),
 * and a stamp from the future locks too (a clock that went backwards) — both
 * are states that cannot prove the app was only briefly away, and the safe
 * answer is the same.
 */
export function shouldLock(state: LockState, now: number): boolean {
  if (!state.on) return false
  if (state.pausedAt === null) return true
  if (now < state.pausedAt) return true
  return now - state.pausedAt >= state.after
}

/**
 * Whether a *resume* should lock — the one place a missing stamp means the
 * opposite of what it means at launch. Every pause writes a stamp, and a
 * successful unlock clears it; so no stamp at resume means the last pause was
 * already paid for, not that the state is unprovable. Without this split,
 * "Immediately" locked itself on the resume that follows its own unlock: the
 * OS prompt pauses the activity, the unlock dismisses it, and the resume saw
 * a fresh stamp with a zero timeout — for ever. Found on the S21 FE.
 */
export function shouldLockOnResume(state: LockState, now: number): boolean {
  if (state.pausedAt === null) return false
  if (!state.pausedTrusted) return shouldLock(state, now)
  // A pause the app caused itself (a photo picker) gets a floor under the
  // chosen timeout — long enough to open and return from, short enough that
  // a phone genuinely left behind during one still locks.
  const after = Math.max(state.after, TRUSTED_PAUSE_GRACE_MS)
  if (now < state.pausedAt) return true
  return now - state.pausedAt >= after
}

/** A successful unlock: the recorded pause is spent. */
export function unlocked(state: LockState): LockState {
  return { ...state, pausedAt: null, pausedTrusted: false }
}

/**
 * A pause about to happen because *this app* opened a trusted system picker
 * — the camera, the gallery chooser — and expects the activity back in a
 * moment, never a user who left. Set immediately before the picker opens;
 * `consumeExpectedPause` reads and clears it inside the pause listener, so
 * only the very next pause gets the grace floor. The one deliberate
 * exception to this file's purity: it must cross from a sibling component
 * into `App`'s listener, and must not be persisted — a flag that outlives
 * its guard (the picker never actually paused the activity) can at worst
 * grant one unrelated later pause the grace window, never an indefinite
 * unlocked state.
 */
let expectingReturn = false

export function expectForegroundReturn(): void {
  expectingReturn = true
}

/** True at most once per `expectForegroundReturn` call. */
export function consumeExpectedPause(): boolean {
  const was = expectingReturn
  expectingReturn = false
  return was
}
