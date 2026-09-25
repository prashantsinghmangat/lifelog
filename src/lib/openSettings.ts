import { registerPlugin } from '@capacitor/core'

/**
 * The one native surface with no Capacitor API of its own: which sound and
 * vibration a notification channel uses is Android's to change, not this
 * app's, once the channel exists. This is a deep link to the OS screen that
 * can, backed by a few lines of native code in `android/`.
 *
 * `lifelog-reminders-v1` must match `REMINDERS` in `reminders.ts` — the
 * channel this app already creates.
 */
interface OpenSettings {
  openNotificationChannel(options: { channelId: string }): Promise<void>
}

const plugin = registerPlugin<OpenSettings>('OpenSettings')

export async function openReminderChannelSettings(): Promise<void> {
  await plugin.openNotificationChannel({ channelId: 'lifelog-reminders-v1' })
}
