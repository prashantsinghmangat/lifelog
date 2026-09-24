import { useEffect, useState } from 'react'

/**
 * Whether the device thinks it has a network.
 *
 * **A hint for what to say and when to retry, never a gate on trying.**
 * `navigator.onLine` is true on a captive portal and false on some Android
 * WebViews that are perfectly connected, so a write held back because this said
 * "offline" would be a write held back for no reason. Every write is attempted
 * regardless; this only decides whether a row still waiting reads as "queued"
 * rather than "failed", and gives the sync something to wake up on.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)

    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
