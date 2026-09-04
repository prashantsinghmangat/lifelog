import { Capacitor } from '@capacitor/core'

/**
 * Whether this is running inside the native shell.
 *
 * A static import, unlike the plugin imports, because two callers need a
 * synchronous answer: the mic must not render at all on native, and rendering
 * it and then removing it is worse than the ~1 KB this costs the web bundle.
 * Reading `window.Capacitor` instead would be guessing at a private global.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}
