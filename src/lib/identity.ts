/**
 * Who this device belongs to, remembered across a launch with no network.
 *
 * **This exists because the auth gate locks you out of your own offline log.**
 * Verified on the emulator: log entries in airplane mode, leave the app for
 * more than an hour, come back, and the Supabase access token has expired.
 * auth-js cannot refresh it without a network, so `getSession()` returns null
 * and the app shows the sign-in screen — with the entries still on the device,
 * intact, unsynced and unreachable. Access tokens last an hour by default, so
 * this is not an edge case; it is what a flight looks like.
 *
 * What is remembered is only an id and an email, and what it unlocks is only
 * the log this device already has on disk. **It grants nothing on the server:**
 * every request still carries whatever token Supabase has, RLS still decides
 * what comes back, and a refresh token that has genuinely been revoked still
 * signs the user out as soon as there is a network to find that out on. The
 * auth gate was never what protected these rows — the device lock is, and the
 * rows are in `localStorage` either way.
 */

const KEY = 'lifelog.who'

export type Identity = { id: string; email: string }

function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false
  const held = value as Partial<Identity>
  return typeof held.id === 'string' && held.id !== '' && typeof held.email === 'string'
}

/** Never throws: storage can be unavailable, and that is not worth a crash. */
export function remember(storage: Storage, identity: Identity): void {
  try {
    storage.setItem(KEY, JSON.stringify(identity))
  } catch {
    // Nothing to do. The session itself is still live in memory.
  }
}

export function recall(storage: Storage): Identity | null {
  try {
    const raw = storage.getItem(KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isIdentity(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Signing out is the one thing that must beat the offline path, or "sign out"
 * would not sign anybody out until their token happened to expire.
 */
export function forget(storage: Storage): void {
  try {
    storage.removeItem(KEY)
  } catch {
    // Then the sign-out is only as good as the cleared Supabase session.
  }
}
