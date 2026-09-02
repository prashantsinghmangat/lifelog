/**
 * Getting a generated file out of the app.
 *
 * A blob download is the desktop answer, but downloads are unreliable inside a
 * standalone iOS PWA. The share sheet is the mobile answer: it hands the file
 * straight to Calendar, which is exactly where an .ics needs to go.
 */

export function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/** Share where the platform supports files, otherwise download. */
export async function shareOrDownload(name: string, type: string, content: string): Promise<void> {
  const file = new File([content], name, { type })

  if (navigator.canShare?.({ files: [file] }) === true) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (failure) {
      // Dismissing the sheet is a choice, not a failure: do not then download.
      if (failure instanceof Error && failure.name === 'AbortError') return
    }
  }

  download(name, type, content)
}
