import { describe, expect, it } from 'vitest'
import { fileNameFor, manifestJson, planExport } from './attachmentExport'
import type { Attachment } from './attachments'
import type { Entry } from '../types'

function attachment(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    entryId: 'entry-1',
    blob: new Blob(['bytes'], { type: 'image/jpeg' }),
    createdAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }
}

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'expense',
    occurred_on: '2026-10-01',
    occurred_at: null,
    title: 'lunch',
    note: null,
    amount_paise: 45_000,
    duration_minutes: null,
    category: 'food',
    data: {},
    created_at: '2026-10-01T10:00:00+05:30',
    ...over,
  }
}

describe('naming a file that has to outlive the app', () => {
  it('leads with the id, so two photos of the same receipt cannot overwrite each other', () => {
    const one = attachment({ id: 'aaa', kind: 'document', name: 'receipt.pdf' })
    const two = attachment({ id: 'bbb', kind: 'document', name: 'receipt.pdf' })
    expect(fileNameFor(one)).not.toBe(fileNameFor(two))
    expect(fileNameFor(one).startsWith('aaa')).toBe(true)
  })

  it('keeps a document’s own extension', () => {
    expect(fileNameFor(attachment({ id: 'a', kind: 'document', name: 'policy.pdf' }))).toBe(
      'a-policy.pdf',
    )
  })

  it('gives a photo one from its type, since the camera supplies no name', () => {
    expect(fileNameFor(attachment({ id: 'a' }))).toBe('a.jpg')
    expect(
      fileNameFor(attachment({ id: 'b', blob: new Blob([''], { type: 'image/png' }) })),
    ).toBe('b.png')
  })

  it('strips what a filesystem should not be handed', () => {
    const name = fileNameFor(attachment({ id: 'a', kind: 'document', name: 'my bill/2026.pdf' }))
    expect(name).not.toContain('/')
    expect(name).not.toContain(' ')
  })
})

describe('the manifest', () => {
  it('carries the entry’s own words, because an export outlives the entry', () => {
    const plan = planExport(
      [attachment({ id: 'a', entryId: 'entry-1' })],
      [],
      [entry({ id: 'entry-1' })],
    )
    expect(plan.manifest[0]).toMatchObject({
      attachmentId: 'a',
      entryId: 'entry-1',
      occurredOn: '2026-10-01',
      title: 'lunch',
      kind: 'photo',
      createdAt: '2026-10-01T10:00:00.000Z',
    })
  })

  it('still lists a file whose entry is gone, rather than dropping it', () => {
    const plan = planExport([attachment({ id: 'a', entryId: 'vanished' })], [], [])
    expect(plan.manifest).toHaveLength(1)
    expect(plan.manifest[0]?.occurredOn).toBeUndefined()
    expect(plan.write).toHaveLength(1)
  })

  it('names documents and photos apart', () => {
    const plan = planExport(
      [attachment({ id: 'a' }), attachment({ id: 'b', kind: 'document', name: 'x.pdf' })],
      [],
      [],
    )
    expect(plan.manifest.map((row) => row.kind)).toEqual(['photo', 'document'])
  })

  it('is readable JSON with a count and a stamp', () => {
    const plan = planExport([attachment({ id: 'a' })], [], [])
    const parsed = JSON.parse(manifestJson(plan.manifest, new Date('2026-10-05T12:00:00.000Z')))
    expect(parsed.count).toBe(1)
    expect(parsed.exportedAt).toBe('2026-10-05T12:00:00.000Z')
    expect(parsed.files).toHaveLength(1)
  })
})

describe('a second export is a sync, not a second copy', () => {
  it('skips what is already written and still lists it', () => {
    const one = attachment({ id: 'a' })
    const two = attachment({ id: 'b' })
    const plan = planExport([one, two], [fileNameFor(one)], [])

    expect(plan.write.map((file) => file.attachment.id)).toEqual(['b'])
    expect(plan.manifest).toHaveLength(2)
  })

  it('writes nothing when everything is there', () => {
    const stored = [attachment({ id: 'a' }), attachment({ id: 'b' })]
    const plan = planExport(stored, stored.map(fileNameFor), [])
    expect(plan.write).toHaveLength(0)
  })

  it('plans nothing at all for an empty store', () => {
    const plan = planExport([], [], [])
    expect(plan.write).toHaveLength(0)
    expect(plan.manifest).toHaveLength(0)
  })
})
