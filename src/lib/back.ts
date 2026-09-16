import { isNative } from './platform'

/**
 * The Android back button, bridged to whatever is open.
 *
 * **This exists because back was dismissing the whole app while a sheet sat
 * open behind it.** Verified on a Pixel 7 emulator: with the editor showing,
 * BACK put the launcher in front and left the sheet exactly where it was. Back
 * is *the* dismiss gesture on Android — every reader will try it on a bottom
 * sheet before they look for a Cancel button — so the one platform convention
 * the app has to honour was the one it broke.
 *
 * A history entry does not fix it, which was worth finding out before building
 * on the assumption: `targetSdkVersion` is 36, where `onBackPressed` is
 * superseded by the predictive-back API, and a bare `BridgeActivity` registers
 * no handler for it. Pushing a state and pressing BACK still backgrounded the
 * app. So the event has to come from the plugin.
 *
 * **It closes a sheet; it is not a navigation system.** There is no router
 * here, no history, and nothing else back could mean. The stack below holds
 * each open sheet's *own* `onClose` — the very function the scrim, the close
 * button and Escape already call — so there is one close path and this is not
 * a second copy of it. With nothing open the app minimises, which is what
 * pressing back at the root of an Android app has always done and is exactly
 * what was observed before any of this existed.
 */

/** Open sheets, outermost first. The last one is the one you can see. */
const open: (() => void)[] = []

/**
 * Registers a sheet's own close. Returns the undo, for the effect's cleanup.
 *
 * Deliberately keyed on the function rather than an index: sheets unmount in
 * whatever order React unmounts them, and splicing by position would eventually
 * close the wrong one.
 */
export function onBack(close: () => void): () => void {
  open.push(close)
  return () => {
    const at = open.lastIndexOf(close)
    if (at !== -1) open.splice(at, 1)
  }
}

/**
 * What back means right now, and the only place that decides it.
 *
 * Pure, and exported for that reason: the whole defect was a platform event
 * reaching nothing, and a test that needs an emulator is a test that does not
 * run. `arm` below owns the one impure part — telling Android to minimise.
 */
export function back(): 'closed' | 'root' {
  const top = open[open.length - 1]
  if (top === undefined) return 'root'
  top()
  return 'closed'
}

/** Never returns the plugin itself — see the wrapper's note in `reminders.ts`. */
async function plugin(): Promise<{ api: typeof import('@capacitor/app').App } | null> {
  if (!isNative()) return null
  const { App } = await import('@capacitor/app')
  return { api: App }
}

/**
 * Arms the button. Call once, from the app's own mount.
 *
 * Adding a `backButton` listener takes the default behaviour away from
 * Capacitor, so the no-sheet case has to be answered here rather than left to
 * fall through — otherwise back would do nothing at all on the timeline, which
 * is a worse bug than the one this fixes.
 */
export async function arm(): Promise<() => void> {
  const found = await plugin()
  if (!found) return () => {}

  const handle = await found.api.addListener('backButton', () => {
    // Minimise, never exit: the log is on the device either way, but killing
    // the process is not what back means at the root of an Android app.
    if (back() === 'root') void found.api.minimizeApp()
  })

  return () => {
    void handle.remove()
  }
}
