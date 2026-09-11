import { useCallback, useState } from 'react'

const KEY = 'lifelog.nudges'

function stored(): boolean {
  try {
    // Absent means on: the prompts were asked for, and a log nobody is reminded
    // to keep is a log that stops after a fortnight.
    return window.localStorage.getItem(KEY) !== 'off'
  } catch {
    // Private mode and locked-down browsers throw on access, not on read.
    return true
  }
}

/**
 * Whether the two daily prompts are armed.
 *
 * Kept next to the theme rather than in the log, because it is a property of
 * this device and not of the entries: the same account on a laptop has no
 * business raising a 9am notification on a phone.
 */
export function useNudges() {
  const [nudges, setNudges] = useState<boolean>(stored)

  const choose = useCallback((next: boolean) => {
    setNudges(next)
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off')
    } catch {
      // A preference that does not survive a reload still beats a crash.
    }
  }, [])

  return { nudges, choose }
}
