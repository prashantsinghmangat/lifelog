import { isNative } from './platform'
import type { HapticsPlugin } from '@capacitor/haptics'

/**
 * Confirms the one act this app exists for, in the hand.
 *
 * Native only — no web API reaches a phone's vibration motor with a native
 * impact's intent, and the browser's own `Vibration API` is a buzz, not a
 * tap. Reached exactly like `reminders.ts` reaches `LocalNotifications`:
 * dynamically, so nothing here touches the web bundle.
 *
 * Returns the plugin **inside a wrapper**, which is not decoration —
 * `reminders.ts` documents the trap this avoids: resolving an async return
 * value reads `.then` to test whether it is thenable, and Capacitor's proxy
 * forwards any property access to native as a method call, so returning the
 * plugin bare invents a native method named `then` and every call rejects.
 */
async function plugin() {
  if (!isNative()) return null
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
  const api: HapticsPlugin = Haptics
  return { api, styles: { light: ImpactStyle.Light, medium: ImpactStyle.Medium } }
}

/** Whether the impact actually reached the device, so a silent no-op is never mistaken for one. */
export type Outcome = 'ok' | 'unavailable'

async function impact(kind: 'light' | 'medium'): Promise<Outcome> {
  try {
    const found = await plugin()
    if (found === null) return 'unavailable'
    await found.api.impact({ style: found.styles[kind] })
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

/** Entry saved, Undo pressed. */
export async function light(): Promise<Outcome> {
  return impact('light')
}

/** Delete confirmed. */
export async function medium(): Promise<Outcome> {
  return impact('medium')
}
