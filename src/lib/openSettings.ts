import { registerPlugin } from '@capacitor/core'

/**
 * The one native surface with no Capacitor API of its own: which sound and
 * vibration a notification channel uses is Android's to change, not this
 * app's, once the channel exists. This is a deep link to the OS screen that
 * can, backed by a few lines of native code in `android/`.
 *
 * The id must match `REMINDERS` in `reminders.ts` — the channel this app
 * actually creates. It did not: this went on asking for `-v1` after spec 023
 * deleted it, so the row in You opened the settings for a channel that was no
 * longer there. A deep link is only as good as the id it carries, and nothing
 * about a wrong one fails loudly.
 */
interface OpenSettings {
  openNotificationChannel(options: { channelId: string }): Promise<void>
}

const plugin = registerPlugin<OpenSettings>('OpenSettings')

export async function openReminderChannelSettings(): Promise<void> {
  await plugin.openNotificationChannel({ channelId: 'lifelog-reminders-v2' })
}
