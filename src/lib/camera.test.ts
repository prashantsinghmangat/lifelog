import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Four outcomes, three of which are not failures — and only one of those is
 * worth saying out loud. A `void` return would collapse all of them into the
 * silence this file exists to prevent.
 */

const getPhoto = vi.fn()
const deleteFile = vi.fn()

vi.mock('./platform', () => ({ isNative: vi.fn(() => true) }))
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: (...args: unknown[]) => getPhoto(...args) },
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Camera: 'CAMERA' },
}))
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { deleteFile: (...args: unknown[]) => deleteFile(...args) },
}))

const { isNative } = await import('./platform')
const { available, takePhoto } = await import('./camera')

afterEach(() => {
  getPhoto.mockReset()
  deleteFile.mockReset()
  vi.mocked(isNative).mockReturnValue(true)
})

describe('away from the native shell', () => {
  it('is unavailable, and never reaches for the plugin', async () => {
    vi.mocked(isNative).mockReturnValue(false)

    expect(available()).toBe(false)
    expect(await takePhoto()).toBe('unavailable')
    expect(getPhoto).not.toHaveBeenCalled()
  })
})

describe('what came back', () => {
  it('asks for a photo already at the stored size, so a 12MP original never lands in the heap', async () => {
    getPhoto.mockResolvedValue({ webPath: 'blob:photo' })
    globalThis.fetch = vi.fn(async () => new Response(new Blob(['x'], { type: 'image/jpeg' })))

    const taken = await takePhoto()
    expect(taken).toBeInstanceOf(Blob)
    expect(getPhoto.mock.calls[0]?.[0]).toMatchObject({
      source: 'CAMERA',
      width: 1600,
      correctOrientation: true,
      allowEditing: false,
    })
  })

  /** Backing out is a decision. Reporting it as a problem would be a lie about a choice. */
  it('reads a cancellation as cancelled, not as a failure', async () => {
    getPhoto.mockRejectedValue(new Error('User cancelled photos app'))
    expect(await takePhoto()).toBe('cancelled')
  })

  it('reads a refusal as denied, so the reason can be named', async () => {
    getPhoto.mockRejectedValue(new Error('User denied access to camera'))
    expect(await takePhoto()).toBe('denied')
  })

  it('reads anything else as unavailable rather than throwing into nothing', async () => {
    getPhoto.mockRejectedValue(new Error('the camera exploded'))
    expect(await takePhoto()).toBe('unavailable')
  })

  it('treats a photo with no path as unavailable', async () => {
    getPhoto.mockResolvedValue({ webPath: undefined })
    expect(await takePhoto()).toBe('unavailable')
  })

  it("deletes the plugin's cache copy once the bytes are in hand", async () => {
    getPhoto.mockResolvedValue({ webPath: 'blob:photo', path: 'file:///cache/capture.jpg' })
    globalThis.fetch = vi.fn(async () => new Response(new Blob(['x'], { type: 'image/jpeg' })))

    expect(await takePhoto()).toBeInstanceOf(Blob)
    expect(deleteFile).toHaveBeenCalledWith({ path: 'file:///cache/capture.jpg' })
  })

  it('never loses the photo over a failed cleanup', async () => {
    getPhoto.mockResolvedValue({ webPath: 'blob:photo', path: 'file:///cache/capture.jpg' })
    globalThis.fetch = vi.fn(async () => new Response(new Blob(['x'], { type: 'image/jpeg' })))
    deleteFile.mockRejectedValue(new Error('gone already'))

    expect(await takePhoto()).toBeInstanceOf(Blob)
  })
})
