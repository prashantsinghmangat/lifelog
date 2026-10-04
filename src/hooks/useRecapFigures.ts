import { useCallback, useState } from 'react'

const KEY = 'lifelog.recap'

type Choice = 'on' | 'off' | null

function stored(): Choice {
  try {
    const found = window.localStorage.getItem(KEY)
    return found === 'on' || found === 'off' ? found : null
  } catch {
    // Private mode and locked-down browsers throw on access, not on read.
    return null
  }
}

/**
 * Whether the evening recap may print figures.
 *
 * Three states rather than two, because the useful default is not a constant:
 * someone who has turned App Lock on has said the app's contents are not for
 * whoever is holding the phone, and a spend figure in a notification is the
 * one piece of the app that can be read without unlocking it. So absent means
 * *follow App Lock* — and the switch is still there for either direction,
 * since the inference is a sensible default and not a rule about this person.
 *
 * Per device like `lifelog.nudges`, and for the same reason: the notification
 * is raised by this phone, so the preference belongs to this phone.
 */
export function useRecapFigures(lockOn: boolean) {
  const [choice, setChoice] = useState<Choice>(stored)

  const choose = useCallback((next: boolean) => {
    setChoice(next ? 'on' : 'off')
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off')
    } catch {
      // A preference that does not survive a reload still beats a crash.
    }
  }, [])

  return { figures: choice === null ? !lockOn : choice === 'on', choose }
}
