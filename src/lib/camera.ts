import { isNative } from './platform'

/** The longest side a stored photo keeps — the same cap `attachments.ts` enforces. */
const MAX_DIMENSION = 1600
const QUALITY = 82

/**
 * Taking a photo, as opposed to picking one.
 *
 * **The obvious way does not work.** `<input type="file" capture>` is supposed
 * to reach the camera and in an Android WebView it reaches the photo picker —
 * verified on a Pixel 7 across three builds (`capture="environment"`, a bare
 * `capture`, and `capture` with `CAMERA` declared and granted), each confirmed
 * by `dumpsys window` naming `PhotopickerGetContentActivity`. Capacitor's own
 * `FileProvider` was already declared, so that was not what was missing. For
 * two specs the Camera control could only ever pick an existing image.
 *
 * Returns the plugin **inside a wrapper**, which is not decoration —
 * `reminders.ts` documents the trap: resolving an async return value reads
 * `.then` to test whether it is thenable, and Capacitor's proxy forwards any
 * property access to native as a method call, so returning the plugin bare
 * invents a native method named `then` and every call rejects.
 */
async function plugin() {
  if (!isNative()) return null
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
  return { api: Camera, CameraResultType, CameraSource }
}

/** Whether this device can take a photo at all — the web never can. */
export function available(): boolean {
  return isNative()
}

/**
 * What happened, because three of these four are not failures and only one of
 * them is worth saying out loud. A silent no-op is never mistaken for a photo.
 */
export type Taken = Blob | 'cancelled' | 'denied' | 'unavailable'

/** Whether the plugin refused because the user said no, rather than because it broke. */
function refused(failure: unknown): boolean {
  const said = failure instanceof Error ? failure.message : String(failure)
  return /permission|denied|not authorized/i.test(said)
}

/** Whether the user backed out, which is a decision rather than a fault. */
function backedOut(failure: unknown): boolean {
  const said = failure instanceof Error ? failure.message : String(failure)
  return /cancel/i.test(said)
}

/**
 * Opens the camera and returns the photo, already at the size it will be
 * stored at.
 *
 * The downscale is asked of the plugin rather than done afterwards on a
 * canvas, which is the point: a 12MP original decoded in the WebView is what
 * cost the second of two photos in spec 007, and on this path it never enters
 * the heap at all.
 */
export async function takePhoto(): Promise<Taken> {
  try {
    const found = await plugin()
    if (found === null) return 'unavailable'

    const photo = await found.api.getPhoto({
      source: found.CameraSource.Camera,
      resultType: found.CameraResultType.Uri,
      quality: QUALITY,
      width: MAX_DIMENSION,
      // Without this the stored image is whichever way up the sensor was.
      correctOrientation: true,
      // The plugin's own editor is a step in the middle of the one act this
      // app measures in seconds.
      allowEditing: false,
    })

    if (photo.webPath === undefined) return 'unavailable'
    const response = await fetch(photo.webPath)
    return await response.blob()
  } catch (failure) {
    if (backedOut(failure)) return 'cancelled'
    if (refused(failure)) return 'denied'
    return 'unavailable'
  }
}
