// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { You } from './You'
import { PALETTES } from '../lib/palettes'
import { isNative } from '../lib/platform'

// The account service is Login/App business; nothing here should reach it.
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: vi.fn(async () => ({ error: null })) } },
}))

// Native, so the Reminders group renders and the switch can be exercised.
vi.mock('../lib/platform', () => ({ isNative: vi.fn(() => true) }))
vi.mock('../lib/openSettings', () => ({ openReminderChannelSettings: vi.fn(async () => {}) }))
vi.mock('../lib/reminders', () => ({
  permission: vi.fn(async () => 'granted'),
  requestPermission: vi.fn(async () => true),
}))

afterEach(cleanup)

function setup(over: Partial<Parameters<typeof You>[0]> = {}) {
  const onNudges = vi.fn()
  render(
    <You
      email="prashant@example.com"
      local={false}
      theme="system"
      onTheme={vi.fn()}
      palette="amber"
      onPalette={vi.fn()}
      resolved="light"
      nudges={true}
      onNudges={onNudges}
      lock={{ on: false, after: 60_000, usable: true }}
      onLockToggle={vi.fn()}
      onLockAfter={vi.fn()}
      onHelp={vi.fn()}
      onExport={vi.fn()}
      onExportCalendar={vi.fn()}
      onSignIn={vi.fn()}
      onSignOut={vi.fn()}
      {...over}
    />,
  )
  return { onNudges }
}

/** jsdom normalises inline hex colours to rgb(...) — match it. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

describe('the palette dot is that palette, not a generic one', () => {
  it('paints every dot from the palette table, in the resolved mode', () => {
    setup({ resolved: 'light' })
    for (const palette of PALETTES) {
      const tile = screen.getByRole('radio', { name: palette.label })
      const dot = tile.querySelector('span[aria-hidden]') as HTMLElement
      expect(dot, `${palette.name} dot`).toBeTruthy()
      // The dot is the palette's own accent, straight from the table the CSS
      // blocks are tested against — so the swatch cannot lie.
      expect(dot.style.backgroundColor).toBe(rgb(palette.light.accent))
    }
  })

  it('follows the mode on screen, so a dark screen previews dark blocks', () => {
    setup({ resolved: 'dark' })
    const tile = screen.getByRole('radio', { name: 'Sea' })
    const dot = tile.querySelector('span[aria-hidden]') as HTMLElement
    const sea = PALETTES.find((palette) => palette.name === 'sea')!
    expect(dot.style.backgroundColor).toBe(rgb(sea.dark.accent))
  })
})

describe('daily prompts is a real switch', () => {
  it('carries role and state, and toggles', async () => {
    const { onNudges } = setup({ nudges: true })
    const toggle = await screen.findByRole('switch', { name: 'Daily prompts' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(toggle)
    expect(onNudges).toHaveBeenCalledWith(false)
  })
})

describe('passive status reads as a row, not a headline', () => {
  it('says Allowed beside Notifications', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Allowed')).toBeTruthy())
    expect(screen.getByText('Notifications')).toBeTruthy()
  })
})

describe('the account block is metadata', () => {
  it('shows one meta line for a signed-in account, and no badge', () => {
    setup()
    expect(screen.getByText('prashant@example.com · signed in')).toBeTruthy()
    expect(screen.queryByText('Signed in')).toBeNull()
  })

  it('tells a guest where the log lives', () => {
    setup({ local: true })
    expect(screen.getByText('This log is on this device only')).toBeTruthy()
    expect(screen.getByText('Guest')).toBeTruthy()
  })
})

describe('the manual lives on the account card', () => {
  it('offers How to use lifelog there, one tap from the top', async () => {
    const onHelp = vi.fn()
    setup({ onHelp })
    await userEvent.click(screen.getByRole('button', { name: 'How to use lifelog' }))
    expect(onHelp).toHaveBeenCalledTimes(1)
  })
})

describe('Privacy & Security', () => {
  afterEach(() => {
    vi.mocked(isNative).mockReturnValue(true)
  })

  it('renders only in the native shell — the web has no lock to offer', () => {
    setup()
    expect(screen.getByText('Privacy & Security')).toBeTruthy()

    cleanup()
    vi.mocked(isNative).mockReturnValue(false)
    setup()
    expect(screen.queryByText('Privacy & Security')).toBeNull()
  })

  it('keeps Lock after out of sight until the lock is on', () => {
    setup()
    expect(screen.queryByText('Lock after')).toBeNull()

    cleanup()
    setup({ lock: { on: true, after: 60_000, usable: true } })
    expect(screen.getByText('Lock after')).toBeTruthy()
    expect(screen.getByText('1 minute')).toBeTruthy()
  })

  it('cycles the timeout from the row itself', async () => {
    const onLockAfter = vi.fn()
    setup({ lock: { on: true, after: 60_000, usable: true }, onLockAfter })
    await userEvent.click(screen.getByRole('button', { name: /Lock after/ }))
    expect(onLockAfter).toHaveBeenCalledTimes(1)
  })

  it('explains and goes inert on a device with no screen lock', async () => {
    const onLockToggle = vi.fn()
    setup({ lock: { on: false, after: 60_000, usable: false }, onLockToggle })
    expect(screen.getByText('Set a screen lock first')).toBeTruthy()
    await userEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
    expect(onLockToggle).not.toHaveBeenCalled()
  })

  it('arms through the toggle when the device can verify', async () => {
    const onLockToggle = vi.fn()
    setup({ onLockToggle })
    await userEvent.click(screen.getByRole('switch', { name: 'App Lock' }))
    expect(onLockToggle).toHaveBeenCalledTimes(1)
  })
})
