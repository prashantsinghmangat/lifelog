import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PALETTES, type TokenBlock } from './palettes'

/**
 * The palette gate, computed rather than eyeballed. `faint` shipped at 4.4:1
 * on `sunken` because a human verified it against `surface` and stopped —
 * this file is what stops that recurring in palette seven. It also holds the
 * CSS blocks equal to `palettes.ts`, so the picker's swatches and the tokens
 * they apply cannot drift apart: two places that have to agree, kept in
 * agreement by a test rather than by hand.
 */

// Off disk rather than `?raw`: Tailwind's Vite plugin compiles the stylesheet
// before a raw import can see it, and the `@theme` block would be gone.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

/** WCAG relative luminance and contrast ratio, inline — no dependency. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** The `--color-*` declarations inside the block a selector opens. */
function tokensIn(selector: string): Record<string, string> {
  const escaped = selector.replace(/[[\]']/g, (ch) => `\\${ch}`)
  const match = css.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm'))
  expect(match, `a block for ${selector}`).toBeTruthy()
  const found: Record<string, string> = {}
  for (const line of match![1]!.matchAll(/--color-([a-z]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    found[line[1]!] = line[2]!.toUpperCase()
  }
  return found
}

const MODES = ['light', 'dark'] as const
const GROUNDS = ['surface', 'raised', 'sunken'] as const
const TEXT = ['ink', 'muted', 'faint'] as const

/** `focus` and the kind colours are mode-only; read them from the base blocks. */
const MODE_ONLY = {
  light: tokensIn('@theme'),
  dark: tokensIn(`[data-theme='dark']`),
}

describe('the CSS blocks and palettes.ts are the same table', () => {
  it('holds for all twelve palette blocks', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        const selector =
          mode === 'light'
            ? `[data-palette='${palette.name}']`
            : `[data-palette='${palette.name}'][data-theme='dark']`
        expect(tokensIn(selector), selector).toEqual(
          Object.fromEntries(
            Object.entries(palette[mode]).map(([token, hex]) => [token, hex.toUpperCase()]),
          ),
        )
      }
    }
  })

  it('holds for the pre-stamp fallbacks, which are Amber', () => {
    const amber = PALETTES.find((palette) => palette.name === 'amber')!
    for (const mode of MODES) {
      const block = MODE_ONLY[mode]
      for (const [token, hex] of Object.entries(amber[mode])) {
        expect(block[token], `fallback ${mode} ${token}`).toBe(hex.toUpperCase())
      }
    }
  })
})

describe('every block clears its contrast floor on every ground', () => {
  const grounds = (block: TokenBlock) => GROUNDS.map((g) => [g, block[g]] as const)

  it('text tokens: 4.5:1 on surface, raised and sunken', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        for (const token of TEXT) {
          for (const [ground, hex] of grounds(palette[mode])) {
            expect(
              contrast(palette[mode][token], hex),
              `${palette.name}/${mode}/${token} on ${ground}`,
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  it('accent: 4.5:1 on surface and raised, and carries surface-coloured text', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        const block = palette[mode]
        expect(contrast(block.accent, block.surface), `${palette.name}/${mode}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(block.accent, block.raised), `${palette.name}/${mode}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(block.surface, block.accent), `${palette.name}/${mode}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('edge and focus: 3:1 non-text on all three grounds of all six palettes', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        for (const [ground, hex] of grounds(palette[mode])) {
          expect(
            contrast(palette[mode].edge, hex),
            `${palette.name}/${mode}/edge on ${ground}`,
          ).toBeGreaterThanOrEqual(3)
          expect(
            contrast(MODE_ONLY[mode]['focus']!, hex),
            `${palette.name}/${mode}/focus on ${ground}`,
          ).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('kind colours: 3:1 on all three grounds of all six palettes', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        for (const kind of ['expense', 'time', 'event', 'note'] as const) {
          for (const [ground, hex] of grounds(palette[mode])) {
            expect(
              contrast(MODE_ONLY[mode][kind]!, hex),
              `${palette.name}/${mode}/${kind} on ${ground}`,
            ).toBeGreaterThanOrEqual(3)
          }
        }
      }
    }
  })
})
