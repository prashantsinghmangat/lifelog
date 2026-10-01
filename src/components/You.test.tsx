// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { You } from './You'
import { PALETTES } from '../lib/palettes'

// The account service is Login/App business; nothing here should reach it.
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: vi.fn(async () => ({ error: null })) } },
}))

// Native, so the Reminders group renders and the switch can be exercised.
vi.mock('../lib/platform', () => ({ isNative: () => true }))
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

describe('the palette swatch is that palette, not a generic one', () => {
  it('paints every tile from the palette table, in the resolved mode', () => {
    setup({ resolved: 'light' })
    for (const palette of PALETTES) {
      const tile = screen.getByRole('radio', { name: palette.label })
      const swatch = tile.querySelector('span[aria-hidden]') as HTMLElement
      expect(swatch, `${palette.name} swatch`).toBeTruthy()
      expect(swatch.style.backgroundColor).toBe(rgb(palette.light.surface))
      // The miniature's parts: accent dot, two ink rules, the raised capture bar.
      const parts = [...swatch.children] as HTMLElement[]
      expect(parts[0]?.style.backgroundColor).toBe(rgb(palette.light.accent))
      expect(parts[1]?.style.backgroundColor).toBe(rgb(palette.light.ink))
      expect(parts[2]?.style.backgroundColor).toBe(rgb(palette.light.ink))
      expect(parts[3]?.style.backgroundColor).toBe(rgb(palette.light.raised))
    }
  })

  it('follows the mode on screen, so a dark screen previews dark blocks', () => {
    setup({ resolved: 'dark' })
    const tile = screen.getByRole('radio', { name: 'Sea' })
    const swatch = tile.querySelector('span[aria-hidden]') as HTMLElement
    const sea = PALETTES.find((palette) => palette.name === 'sea')!
    expect(swatch.style.backgroundColor).toBe(rgb(sea.dark.surface))
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
