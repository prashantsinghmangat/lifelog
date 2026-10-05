import { afterEach, describe, expect, it, vi } from 'vitest'
import { takeShared } from './shareTarget'
import { isNative } from './platform'

const take = vi.fn()

vi.mock('./platform', () => ({ isNative: vi.fn(() => false) }))
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ take: (...args: unknown[]) => take(...args) }),
}))

afterEach(() => {
  take.mockReset()
  vi.mocked(isNative).mockReturnValue(false)
})

describe('taking a share', () => {
  it('hands over the text once, because the native side consumes it', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    take.mockResolvedValueOnce({ text: '450 lunch' }).mockResolvedValueOnce({ text: null })

    expect(await takeShared()).toBe('450 lunch')
    // The second call is the next resume: a share already in the box must not
    // arrive again every time the reader switches away and back.
    expect(await takeShared()).toBeNull()
  })

  it('treats whitespace as nothing shared, rather than clearing the box', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    take.mockResolvedValue({ text: '   ' })
    expect(await takeShared()).toBeNull()
  })

  it('never reaches for the plugin on the web', async () => {
    expect(await takeShared()).toBeNull()
    expect(take).not.toHaveBeenCalled()
  })

  it('returns null when the bridge throws, rather than failing a launch', async () => {
    vi.mocked(isNative).mockReturnValue(true)
    take.mockRejectedValue(new Error('not implemented on android'))
    await expect(takeShared()).resolves.toBeNull()
  })
})
