import { isNative } from './platform'

/**
 * Getting a generated file out of the app.
 *
 * A blob download is the desktop answer, but downloads are unreliable inside a
 * standalone iOS PWA. The share sheet is the mobile answer: it hands the file
 * straight to Calendar, which is exactly where an .ics needs to go.
 *
 * **And inside the native shell neither of those exists.** `navigator.share` and
 * `navigator.canShare` are both `undefined` in the Capacitor Android WebView —
 * Web Share is a Chrome feature, not a WebView one — so every export fell
 * through to the blob download, where an `<a download>` is swallowed unless the
 * app registers a `DownloadListener`, which neither `MainActivity` nor
 * `@capacitor/android` does. `click()` returned without throwing, nothing was
 * caught, and Export JSON did nothing at all on a phone: no file, no error, no
 * toast. Verified on a Galaxy S21 FE, where the only evidence was an empty
 * `/sdcard/Download`.
 *
 * So native gets its own route: write the file where the app is always allowed
 * to write, then hand its URI to the system share sheet. That needs no storage
 * permission on any API level, and it lets the file go wherever the reader
 * actually wants it — Drive, Files, a mail draft — which for a backup is the
 * point.
 */

/** What actually happened, because the whole defect here was silence. */
export type Delivered = 'shared' | 'downloaded' | 'cancelled'

export function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Never returns a plugin itself — see the wrapper's note in `reminders.ts`.
 * Resolving an async return value reads `.then`, and the proxy forwards every
 * property access to native as a method call.
 */
async function plugins(): Promise<{
  fs: typeof import('@capacitor/filesystem').Filesystem
  dir: typeof import('@capacitor/filesystem').Directory
  utf8: typeof import('@capacitor/filesystem').Encoding.UTF8
  share: typeof import('@capacitor/share').Share
} | null> {
  if (!isNative()) return null
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  return { fs: Filesystem, dir: Directory, utf8: Encoding.UTF8, share: Share }
}

/**
 * Cache, not Documents. Documents is shared storage and wants a permission on
 * older API levels; Cache is app-private, always writable, and the file only
 * has to live long enough for the share sheet to copy it somewhere real.
 */
async function nativeShare(name: string, content: string): Promise<Delivered | null> {
  const found = await plugins()
  if (!found) return null

  const written = await found.fs.writeFile({
    path: name,
    data: content,
    directory: found.dir.Cache,
    // Without this the plugin expects base64 and writes the text as if it were.
    encoding: found.utf8,
  })

  try {
    await found.share.share({ title: name, url: written.uri })
    return 'shared'
  } catch (failure) {
    // Dismissing the sheet is a choice, not a failure. Android reports it as a
    // plain "Share canceled" rather than a DOMException named AbortError, so
    // the message is what there is to go on.
    if (failure instanceof Error && /cancel/i.test(failure.message)) return 'cancelled'
    throw failure
  } finally {
    // The export is the whole log in plaintext, and left here it accumulated:
    // one complete copy per press, cancelled shares included, outliving every
    // sign-out. By the time share() settles the target has received the stream,
    // so the file has done its only job.
    void found.fs.deleteFile({ path: name, directory: found.dir.Cache }).catch(() => undefined)
  }
}

/**
 * A file the reader is keeping, rather than handing to another app.
 *
 * The web downloads it, because a backup belongs on disk and not in a share
 * sheet — that rule stands. Native has no disk route at all, so the share sheet
 * *is* how it reaches the Files app, Drive, or a mail draft.
 */
export async function save(name: string, type: string, content: string): Promise<Delivered> {
  const natively = await nativeShare(name, content)
  if (natively !== null) return natively

  download(name, type, content)
  return 'downloaded'
}

/** `FileReader` speaks data URLs; `Filesystem.writeFile`'s default encoding wants the bare payload. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read the file'))
        return
      }
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the file'))
    reader.readAsDataURL(blob)
  })
}

/** `nativeShare`'s binary sibling — a stored attachment's bytes, not generated text. */
async function nativeShareBlob(name: string, blob: Blob): Promise<Delivered | null> {
  const found = await plugins()
  if (!found) return null

  const written = await found.fs.writeFile({
    path: name,
    data: await blobToBase64(blob),
    directory: found.dir.Cache,
  })

  try {
    await found.share.share({ title: name, url: written.uri })
    return 'shared'
  } catch (failure) {
    if (failure instanceof Error && /cancel/i.test(failure.message)) return 'cancelled'
    throw failure
  } finally {
    void found.fs.deleteFile({ path: name, directory: found.dir.Cache }).catch(() => undefined)
  }
}

/**
 * Opens a stored attachment's own bytes through the OS — a document has no
 * in-app viewer, this is the only way it's ever read.
 */
export async function shareBlob(name: string, blob: Blob): Promise<Delivered> {
  const natively = await nativeShareBlob(name, blob)
  if (natively !== null) return natively

  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] }) === true) {
    try {
      await navigator.share({ files: [file], title: name })
      return 'shared'
    } catch (failure) {
      if (failure instanceof Error && failure.name === 'AbortError') return 'cancelled'
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

/**
 * Writes an attachment export into the device's own Documents, and reports it.
 *
 * `save` deliberately uses Cache because a shared file only has to outlive the
 * share sheet. This is the opposite case and knowingly departs from it: an
 * export whose whole purpose is to survive an uninstall cannot live in
 * app-private storage, which is deleted with the app. Documents is the user's,
 * not the app's.
 *
 * Scoped storage from Android 11 means the app may only touch what it created
 * here, which is exactly this folder and needs no runtime permission — and what
 * it creates still outlives it. Anything the platform refuses is returned as a
 * failure rather than swallowed; the exports-did-nothing bug is the reason
 * every path in this file reports.
 */
export type Written = { written: number; skipped: number; where: string }

export async function writeAttachments(
  folder: string,
  files: readonly { name: string; blob: Blob }[],
  extras: readonly { name: string; text: string }[],
): Promise<Written | null> {
  const found = await plugins()
  if (!found) return null

  await found.fs.mkdir({ path: folder, directory: found.dir.Documents, recursive: true }).catch(
    () => undefined,
  )

  let written = 0
  for (const file of files) {
    await found.fs.writeFile({
      path: `${folder}/${file.name}`,
      data: await blobToBase64(file.blob),
      directory: found.dir.Documents,
    })
    written += 1
  }

  for (const extra of extras) {
    await found.fs.writeFile({
      path: `${folder}/${extra.name}`,
      data: extra.text,
      directory: found.dir.Documents,
      encoding: found.utf8,
    })
  }

  return { written, skipped: 0, where: `Documents/${folder}` }
}

/** What the export folder already holds, so a second run writes only what is new. */
export async function listWritten(folder: string): Promise<string[] | null> {
  const found = await plugins()
  if (!found) return null

  try {
    const found_ = await found.fs.readdir({ path: folder, directory: found.dir.Documents })
    return found_.files.map((file) => file.name)
  } catch {
    // No folder yet is the first export, not an error.
    return []
  }
}

/** Share where the platform supports files, otherwise download. */
export async function shareOrDownload(
  name: string,
  type: string,
  content: string,
): Promise<Delivered> {
  const natively = await nativeShare(name, content)
  if (natively !== null) return natively

  const file = new File([content], name, { type })

  if (navigator.canShare?.({ files: [file] }) === true) {
    try {
      await navigator.share({ files: [file], title: name })
      return 'shared'
    } catch (failure) {
      // Dismissing the sheet is a choice, not a failure: do not then download.
      if (failure instanceof Error && failure.name === 'AbortError') return 'cancelled'
    }
  }

  download(name, type, content)
  return 'downloaded'
}
