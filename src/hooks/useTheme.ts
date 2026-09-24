import { useCallback, useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'lifelog.theme'
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

/**
 * Resolves `system` against the OS setting and stamps `data-theme` on <html>,
 * which is what the CSS tokens key off. Also keeps the PWA status bar in step.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)

  useEffect(() => {
    const media = window.matchMedia(DARK)

    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
      const meta = document.querySelector('meta[name="theme-color"]')
      // The surface itself, not the ink: drawn edge-to-edge the browser chrome
      // is a continuation of the page, and a dark bar over a paper-coloured
      // page reads as a header the app does not have.
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#141311' : '#faf9f7')
    }

    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const choose = useCallback((next: Theme) => {
    setTheme(next)
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      // A theme that does not survive a reload still beats a crash.
    }
  }, [])

  return { theme, choose }
}
