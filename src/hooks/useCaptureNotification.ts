import { useCallback, useState } from 'react'

const KEY = 'lifelog.capture'

function stored(): boolean {
  try {
    // Absent means **off**, which is the inverse of the daily prompts and
    // deliberately so. A prompt twice a day earns being on by default; a row
    // that never leaves the shade has to be asked for, or it is the fastest
    // possible way to get the whole app's notifications muted.
    return window.localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

/**
 * Whether the permanent capture row is in the notification shade.
 *
 * Per device like the prompts, and for the same reason: the shade belongs to
 * this phone, and the same account on a laptop has no business putting a row
 * in it.
 */
export function useCaptureNotification() {
  const [capture, setCapture] = useState<boolean>(stored)

  const choose = useCallback((next: boolean) => {
    setCapture(next)
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off')
    } catch {
      // A preference that does not survive a reload still beats a crash.
    }
  }, [])

  return { capture, choose }
}
