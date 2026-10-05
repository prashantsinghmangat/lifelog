import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'

/**
 * Text shared into lifelog from another app.
 *
 * The capture box is five seconds; what is not five seconds is leaving GPay,
 * launching this, and retyping a number you were looking at a moment ago. The
 * parser already reads a messy line — this only feeds it from where the words
 * already were.
 *
 * Consumed on read, by the native side: the app asks on launch and on every
 * resume, and a share that has already reached the box must not arrive again
 * the next time the reader switches away and back.
 */

interface ShareTarget {
  take(): Promise<{ text: string | null }>
}

const plugin = registerPlugin<ShareTarget>('ShareTarget')

export async function takeShared(): Promise<string | null> {
  if (!isNative()) return null

  try {
    const { text } = await plugin.take()
    return text !== null && text.trim() !== '' ? text : null
  } catch {
    // An older install without the plugin, or a bridge that is not up. A share
    // that cannot be read is not worth failing a launch over.
    return null
  }
}
