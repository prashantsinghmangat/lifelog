import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { guest, forget, recall, remember, type Identity } from '../lib/identity'
import { adopt } from '../lib/store'
import { supabase } from '../lib/supabase'

/**
 * Who is using the app, which is not the same question as whether Supabase can
 * prove it right now.
 *
 * A live session answers it. When there is none, a *remembered* identity answers
 * it instead — see `identity.ts`: an expired access token that cannot be
 * refreshed offline otherwise puts the sign-in screen in front of a log that is
 * sitting on the device. `SIGNED_OUT` still clears it, so a refresh token that
 * has really been revoked signs the user out the moment there is a network to
 * discover that on.
 */
export function useSession(): {
  identity: Identity | null
  loading: boolean
  /** Start using the app with no account. See `guest` in `identity.ts`. */
  startGuest: () => void
} {
  /**
   * Starts from what this device already knows, so a launch does not wait on
   * the network to find out who is using it.
   *
   * Measured on the emulator: offline with an expired token, `getSession()`
   * retries the refresh for around twenty seconds before resolving, and the app
   * sat on a bare "…" the whole time looking broken. There is nothing to wait
   * for — the log being rendered is already on the device — so the gate is only
   * for a device nobody has signed in on.
   */
  const known = useState<Identity | null>(() => recall(localStorage))[0]
  const [identity, setIdentity] = useState<Identity | null>(known)
  const [loading, setLoading] = useState(known === null)

  useEffect(() => {
    let live = true

    const settle = (session: Session | null) => {
      if (session === null) {
        setIdentity(recall(localStorage))
        return
      }
      const found = { id: session.user.id, email: session.user.email ?? '' }

      // A log kept without an account is keyed by its local id. Signing in
      // changes the key, so without this every entry made as a guest is still on
      // the device and no longer reachable — which reads exactly like the app
      // threw them away.
      const before = recall(localStorage)
      if (before !== null && before.local === true && before.id !== found.id) {
        adopt(localStorage, before.id, found.id, new Date().toISOString())
      }

      remember(localStorage, found)
      setIdentity(found)
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      settle(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Only an actual sign-out forgets. A failed refresh also arrives with a
      // null session, and treating that as a sign-out is the whole bug.
      if (event === 'SIGNED_OUT') forget(localStorage)
      settle(next)
      setLoading(false)
    })

    return () => {
      live = false
      data.subscription.unsubscribe()
    }
  }, [])

  const startGuest = useCallback(() => {
    const who = guest()
    remember(localStorage, who)
    setIdentity(who)
    // Nothing is waiting on the network any more, and `getSession` may still be
    // retrying a refresh for the twenty seconds it takes to give up.
    setLoading(false)
  }, [])

  return { identity, loading, startGuest }
}
