// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The rename, rehearsed.
 *
 * This is the one test the whole product-identity spec exists to make pass:
 * with the name swapped, the brand reaches every surface a reader sees **and**
 * nothing reaches a storage key, a database name, a notification channel or an
 * exported event's identity. Those two halves are asserted in one file on
 * purpose — a rename that propagates everywhere is as broken as one that
 * propagates nowhere, and the second failure is the expensive one: it orphans
 * a device's photos and silences its reminders.
 *
 * Per ARCHITECTURE.md, a renamed notification channel is a *new* channel at
 * default importance, and its settings belong to the user once it exists. That
 * bug has already shipped here once.
 */

const BRAND = 'TestBrand'

vi.mock('./product', () => ({
  PRODUCT: {
    name: BRAND,
    shortName: BRAND,
    slug: 'testbrand',
    tagline: 'A tagline',
    description: 'A description',
    url: 'https://testbrand.example',
    issuesUrl: 'https://testbrand.example/issues',
  },
}))

// Native-only paths these components reach on mount. Nothing here is the
// subject of the test; they just have to not throw.
vi.mock('./platform', () => ({ isNative: vi.fn(() => false) }))
vi.mock('./supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signInWithOtp: vi.fn() } },
}))

afterEach(cleanup)

describe('the brand reaches every surface a reader sees', () => {
  it('locks the screen under the new name', async () => {
    const { LockScreen } = await import('../components/LockScreen')
    render(<LockScreen onUnlock={vi.fn()} />)
    expect(screen.getByText(`${BRAND} is locked`)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: `${BRAND} is locked` })).toBeTruthy()
  })

  it('titles the help sheet with it', async () => {
    const { HelpSheet } = await import('../components/HelpSheet')
    render(<HelpSheet onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: `How to use ${BRAND}` })).toBeTruthy()
    expect(screen.getByRole('heading', { name: `How to use ${BRAND}` })).toBeTruthy()
  })

  it('heads the sign-in screen with it', async () => {
    const { Login } = await import('../components/Login')
    render(<Login />)
    expect(screen.getByRole('heading', { level: 1, name: BRAND })).toBeTruthy()
  })

  it('names the calendar the export produces', async () => {
    const { toIcs } = await import('./ics')
    const ics = toIcs([fixture()], new Date(2026, 8, 1, 10, 0, 0))
    expect(ics).toContain(`PRODID:-//${BRAND}//EN`)
    expect(ics).toContain(`X-WR-CALNAME:${BRAND}`)
  })

  it('fills the browser tab title', async () => {
    const { fillBrand } = await import('./productHtml')
    const { PRODUCT } = await import('./product')
    const html = readFileSync('index.html', 'utf8')
    expect(fillBrand(html, PRODUCT)).toContain(`<title>${BRAND}</title>`)
  })

  it('leaves the old name nowhere on those surfaces', async () => {
    const { LockScreen } = await import('../components/LockScreen')
    render(<LockScreen onUnlock={vi.fn()} />)
    expect(document.body.textContent?.toLowerCase()).not.toContain('lifelog')
  })
})

describe('the rename reaches no technical identifier', () => {
  it('keeps an already-exported event its own identity', async () => {
    const { toIcs } = await import('./ics')
    // The UID is what a calendar matches on re-import. Rebranded, every event
    // ever exported would duplicate instead of updating.
    expect(toIcs([fixture()], new Date(2026, 8, 1, 10, 0, 0))).toContain('UID:abc@lifelog')
  })

  it('keeps the per-user log key', async () => {
    const { keyFor } = await import('./store')
    expect(keyFor('user-1')).toBe('lifelog.log.user-1')
  })

  it('keeps the app-lock key', async () => {
    const { saveLock, DEFAULT_LOCK } = await import('./applock')
    const written: Record<string, string> = {}
    saveLock({ setItem: (key, value) => void (written[key] = value) }, DEFAULT_LOCK)
    expect(Object.keys(written)).toEqual(['lifelog.lock'])
  })

  /**
   * The rest are literals inside modules whose behaviour needs a plugin or a
   * live IndexedDB to observe, so they are checked where they are written.
   * Coarse, and that is the point: this fails if a rename edits one of them,
   * whatever route it takes.
   */
  it('keeps every storage key, database name and channel id spelled the old way', () => {
    // Named file by file rather than scanned: the list is the inventory, so a
    // new storage key added without a line here is a gap somebody can see.
    const guarded: [string, string[]][] = [
      ['src/lib/store.ts', ['lifelog.log.']],
      ['src/lib/identity.ts', ['lifelog.who']],
      ['src/lib/applock.ts', ['lifelog.lock']],
      ['src/lib/attachments.ts', ['lifelog-attachments']],
      ['src/lib/openSettings.ts', ['lifelog-reminders-v1']],
      ['src/lib/reminders.ts', ['lifelog-reminders-v2', 'lifelog-prompts-v1']],
      ['src/lib/ics.ts', ['@lifelog']],
      ['src/hooks/useTheme.ts', ['lifelog.theme', 'lifelog.palette']],
      ['src/hooks/useNudges.ts', ['lifelog.nudges']],
    ]

    for (const [file, literals] of guarded) {
      const source = readFileSync(file, 'utf8')
      for (const literal of literals) {
        expect(source, `${literal} must stay a literal in ${file} — see src/lib/product.ts`).toContain(
          literal,
        )
      }
    }
  })

  it('keeps the Android application id', () => {
    const strings = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8')
    expect(strings).toContain('<string name="package_name">com.prashant.lifelog</string>')
  })
})

// Paths are relative to the vitest root. jsdom hands `import.meta.url` an
// http: scheme, so the `new URL(..., import.meta.url)` form the node-environment
// tests use cannot work here.
function fixture() {
  return {
    id: 'abc',
    kind: 'event' as const,
    occurred_on: '2026-11-14',
    occurred_at: null,
    title: 'Something',
    note: null,
    amount_paise: null,
    duration_minutes: null,
    category: null,
    data: {},
    created_at: '2026-09-01T10:00:00+05:30',
  }
}
