import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'

/**
 * Paints the status bar to match the app's own theme rather than the OS's —
 * the You screen lets the two disagree, and `Theme.AppCompat.DayNight` alone
 * only ever follows the OS. Backed by a few lines of native code in
 * `android/`, not `@capacitor/status-bar`: this app needs exactly one
 * opaque colour, not that plugin's edge-to-edge/overlay surface.
 */
interface StatusBarPlugin {
  setStyle(options: { dark: boolean; color: string }): Promise<void>
}

const plugin = registerPlugin<StatusBarPlugin>('StatusBarPlugin')

/**
 * Call whenever `useTheme` resolves, so the bar updates with no relaunch.
 * `color` is the resolved palette's surface — the bar follows the palette as
 * well as the mode, which fixed resources on the native side never could —
 * and `dark` still picks the icon appearance.
 */
export function syncStatusBar(dark: boolean, color: string): void {
  if (!isNative()) return
  void plugin.setStyle({ dark, color })
}
