import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PALETTE, PALETTES, tokensOf, type PaletteName } from '../lib/palettes'
import { syncStatusBar } from '../lib/statusbar'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'lifelog.theme'
const PALETTE_KEY = 'lifelog.palette'
const DARK = '(prefers-color-scheme: dark)'

function stored(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  } catch {
    // Private mode and locked-down browsers throw on access, not on read.
    return 'system'
  }
}

/** Falls back to the default rather than throwing: an unrecognised value is
    what a downgrade or a hand-edited key looks like, not an error. */
function storedPalette(): PaletteName {
  try {
    const saved = window.localStorage.getItem(PALETTE_KEY)
    return PALETTES.some((palette) => palette.name === saved)
      ? (saved as PaletteName)
      : DEFAULT_PALETTE
  } catch {
    return DEFAULT_PALETTE
  }
}

/**
 * Resolves `system` against the OS setting and stamps `data-theme` and
 * `data-palette` on <html>, which is what the CSS tokens key off. Also keeps
 * the PWA's `theme-color` meta and, on Android, the native status bar in step.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)
  const [palette, setPalette] = useState<PaletteName>(storedPalette)
  /** The mode actually on screen once `system` is resolved — what a swatch
      needs to show the variant the reader is looking at. */
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const media = window.matchMedia(DARK)

    const apply = () => {
      const mode = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = mode
      document.documentElement.dataset.palette = palette
      setResolved(mode)
      // The surface itself, not the ink: drawn edge-to-edge the browser chrome
      // is a continuation of the page, and a dark bar over a paper-coloured
      // page reads as a header the app does not have. Read from the same
      // constant the CSS blocks are tested against, so the chrome cannot
      // disagree with the page whichever palette is chosen.
      const surface = tokensOf(palette, mode).surface
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', surface)
      syncStatusBar(mode === 'dark', surface)
    }

    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, palette])

  const choose = useCallback((next: Theme) => {
    setTheme(next)
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // A theme that does not survive a reload still beats a crash.
    }
  }, [])

  const choosePalette = useCallback((next: PaletteName) => {
    setPalette(next)
    try {
      window.localStorage.setItem(PALETTE_KEY, next)
    } catch {
      // Same bargain as the theme above.
    }
  }, [])

  return { theme, choose, palette, choosePalette, resolved }
}
