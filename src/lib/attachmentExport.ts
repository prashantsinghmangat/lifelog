import type { Attachment } from './attachments'
import type { Entry } from '../types'

/**
 * What an export of the attachment store writes, decided without a filesystem.
 *
 * Photos and documents live in IndexedDB on one device and nothing backs them
 * up: not the nightly function, not Export JSON, and not Android, which this
 * app opts out of with `allowBackup="false"`. On 5 Oct 2026 an uninstall
 * destroyed every photo on the phone — the entries came back from Supabase
 * within a minute and the photos had nowhere to come back from. This is the
 * somewhere.
 *
 * The naming and the manifest are the whole design, so they are decided here
 * and tested like the parser; `deliver.ts` only writes what this returns.
 */

/** The folder, under the device's own Documents, that an export owns. */
export const EXPORT_FOLDER = 'lifelog'

/** Keeps a receipt out of the gallery and out of a photo backup nobody asked for. */
export const NOMEDIA = '.nomedia'

export const MANIFEST = 'manifest.json'

export type ExportFile = {
  attachment: Attachment
  /** Relative to `EXPORT_FOLDER`. */
  name: string
}

export type ManifestRow = {
  file: string
  attachmentId: string
  entryId: string
  /** Absent when the entry is gone — the file is still worth keeping. */
  occurredOn?: string
  title?: string
  kind: 'photo' | 'document'
  createdAt: string
}

export type ExportPlan = {
  /** Only what is not already written; re-exporting is a sync, not a dump. */
  write: ExportFile[]
  /** Every attachment, written now or already there, so the manifest stays whole. */
  manifest: ManifestRow[]
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
}

function extensionOf(attachment: Attachment): string {
  const named = attachment.name?.match(/\.([A-Za-z0-9]{1,8})$/)
  if (named?.[1]) return named[1].toLowerCase()

  const type = attachment.mimeType ?? attachment.blob.type
  return EXTENSIONS[type] ?? (attachment.kind === 'document' ? 'bin' : 'jpg')
}

/**
 * The id leads, because it is the only thing that is certainly unique.
 *
 * Two photos of the same receipt arrive as `receipt.jpg` twice, and a folder
 * that silently overwrites one with the other is a backup that loses data —
 * which is the one thing this feature exists not to do.
 */
export function fileNameFor(attachment: Attachment): string {
  const stem = attachment.name?.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
  const label = stem ? `-${stem.slice(0, 40)}` : ''
  return `${attachment.id}${label}.${extensionOf(attachment)}`
}

export function planExport(
  attachments: readonly Attachment[],
  existing: Iterable<string>,
  entries: readonly Entry[],
): ExportPlan {
  const already = new Set(existing)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))

  const write: ExportFile[] = []
  const manifest: ManifestRow[] = []

  for (const attachment of attachments) {
    const name = fileNameFor(attachment)
    if (!already.has(name)) write.push({ attachment, name })

    const entry = byId.get(attachment.entryId)
    manifest.push({
      file: name,
      attachmentId: attachment.id,
      entryId: attachment.entryId,
      // An export outlives the app, so a row that only carries ids is a row
      // nobody can read. The entry's own words go in while they still exist.
      ...(entry ? { occurredOn: entry.occurred_on, title: entry.title } : {}),
      kind: attachment.kind === 'document' ? 'document' : 'photo',
      createdAt: attachment.createdAt,
    })
  }

  return { write, manifest }
}

export function manifestJson(manifest: readonly ManifestRow[], at: Date): string {
  return JSON.stringify(
    { exportedAt: at.toISOString(), count: manifest.length, files: manifest },
    null,
    2,
  )
}
