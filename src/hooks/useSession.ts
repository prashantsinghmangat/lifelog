import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { forget, recall, remember, type Identity } from '../lib/identity'
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
export function useSession(): { identity: Identity | null; loading: boolean } {
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

  return { identity, loading }
}
