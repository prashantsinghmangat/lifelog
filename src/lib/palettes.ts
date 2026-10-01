/**
 * The single source for the palette system: the CSS blocks in `src/index.css`
 * are written from this table and a test asserts they stay equal, and the
 * picker's swatches render from it — so a seventh palette cannot change one
 * and not the other. Two places that have to agree, kept in agreement by a
 * test rather than by hand: the `--dock` lesson.
 *
 * Every value is verified computationally (`src/lib/contrast.test.ts`): ink,
 * muted and faint clear 4.5:1 on surface, raised AND sunken; the accent
 * clears 4.5:1 on surface and raised, and carries surface-coloured text at
 * 4.5:1; edge and focus clear 3:1 on all three grounds. Several hexes are one
 * nudge off an obvious value precisely because the obvious value failed.
 *
 * `focus` is the accent restated: the ring the app draws has to read as the
 * palette's own — a fixed blue read as the browser's default ring on every
 * non-blue palette. It stays a separate token so a palette whose accent ever
 * fails 3:1 as a ring can diverge without touching components.
 *
 * `edge` is derived at authoring time — ink mixed into surface at the
 * smallest step that clears 3:1 on every ground — and committed as a hex,
 * never a runtime `color-mix()`: where that function is unsupported the
 * variable resolves invalid, `border-color` falls back to `currentColor`,
 * and every input border turns ink. A committed hex removes the failure
 * mode entirely and lets the test check edge like everything else.
 */

export type PaletteName = 'amber' | 'paper' | 'graphite' | 'plum' | 'espresso' | 'sea' | 'mint'

export type TokenBlock = {
  surface: string
  raised: string
  sunken: string
  ink: string
  muted: string
  faint: string
  line: string
  edge: string
  accent: string
  focus: string
}

export type Palette = { name: PaletteName; label: string; light: TokenBlock; dark: TokenBlock }

export const DEFAULT_PALETTE: PaletteName = 'amber'

export const PALETTES: Palette[] = [
  {
    name: 'amber',
    label: 'Amber',
    light: { surface: '#F2EEE6', raised: '#FFFCF7', sunken: '#F0EAE0', ink: '#1E1A15', muted: '#5A5247', faint: '#6E6559', line: '#EBE4D9', edge: '#8A8680', accent: '#9E4A12', focus: '#9E4A12' },
    dark: { surface: '#100F0E', raised: '#1B1A18', sunken: '#232120', ink: '#F2EEE8', muted: '#B5ADA2', faint: '#938A81', line: '#2B2826', edge: '#6F6D6A', accent: '#F0913F', focus: '#F0913F' },
  },
  {
    name: 'paper',
    label: 'Paper',
    // The palette the app shipped with, nudged only where the checks above
    // required it. Its accent is its ink — deliberately no accent hue.
    light: { surface: '#F6F2EB', raised: '#FFFCF7', sunken: '#EEE8DE', ink: '#1E1A15', muted: '#5A5247', faint: '#6E6559', line: '#E7E0D4', edge: '#88847E', accent: '#1E1A15', focus: '#1E1A15' },
    dark: { surface: '#1A1714', raised: '#24201C', sunken: '#2D2823', ink: '#EFE8DC', muted: '#BDB3A4', faint: '#9B9184', line: '#332D27', edge: '#76716A', accent: '#EFE8DC', focus: '#EFE8DC' },
  },
  {
    name: 'graphite',
    label: 'Graphite',
    light: { surface: '#EDEFF1', raised: '#FBFCFD', sunken: '#E2E6E9', ink: '#16191C', muted: '#4C5257', faint: '#5F656A', line: '#DDE1E5', edge: '#7F8284', accent: '#0B737A', focus: '#0B737A' },
    dark: { surface: '#111316', raised: '#1A1D21', sunken: '#23272C', ink: '#EDF0F2', muted: '#A8B0B7', faint: '#899097', line: '#282C31', edge: '#6D7072', accent: '#3FC1C9', focus: '#3FC1C9' },
  },
  {
    name: 'plum',
    label: 'Plum',
    light: { surface: '#F4F0F6', raised: '#FFFCFF', sunken: '#EAE4EE', ink: '#1B1620', muted: '#544C5C', faint: '#6B6373', line: '#E5DEEA', edge: '#858189', accent: '#A82F5C', focus: '#A82F5C' },
    dark: { surface: '#14101A', raised: '#1E1926', sunken: '#282231', ink: '#F0ECF4', muted: '#B2A9BE', faint: '#948BA0', line: '#2C2636', edge: '#706C76', accent: '#F2789F', focus: '#F2789F' },
  },
  {
    name: 'espresso',
    label: 'Espresso',
    light: { surface: '#F3EFE8', raised: '#FFFCF6', sunken: '#E9E2D6', ink: '#1C1710', muted: '#554C3E', faint: '#6B6253', line: '#E5DDCE', edge: '#85817A', accent: '#85660E', focus: '#85660E' },
    dark: { surface: '#16110D', raised: '#211A14', sunken: '#2C241C', ink: '#F4EDE2', muted: '#BCAF9C', faint: '#988E7E', line: '#302720', edge: '#757069', accent: '#E3B24A', focus: '#E3B24A' },
  },
  {
    name: 'sea',
    label: 'Sea',
    light: { surface: '#EEF1EF', raised: '#FCFDFC', sunken: '#E2E8E5', ink: '#151A18', muted: '#4B534F', faint: '#5E6662', line: '#DCE3E0', edge: '#7F8381', accent: '#0F6B6B', focus: '#0F6B6B' },
    dark: { surface: '#0E1413', raised: '#17201F', sunken: '#1F2A28', ink: '#E8F0EE', muted: '#A3B2AE', faint: '#899793', line: '#243230', edge: '#6C7371', accent: '#46C8B8', focus: '#46C8B8' },
  },
  {
    // The Stitch mocks' own colour world (spec 019): surface, container and
    // ink from design-ref/lifelog_system/DESIGN.md, the dark block derived
    // here — the mock ships none. Picked in You, the app is the mock.
    name: 'mint',
    label: 'Mint',
    light: { surface: '#F4FBF7', raised: '#FFFFFF', sunken: '#E9EFEB', ink: '#161D1B', muted: '#404847', faint: '#5A6560', line: '#E3ECE7', edge: '#6F7A75', accent: '#1F4E4B', focus: '#1F4E4B' },
    dark: { surface: '#0D1412', raised: '#17201C', sunken: '#202B26', ink: '#E8F1ED', muted: '#A6B6AF', faint: '#8C9C95', line: '#263129', edge: '#707C76', accent: '#7FC4BC', focus: '#7FC4BC' },
  },
]

/** The block a name and a mode resolve to, falling back to the default. */
export function tokensOf(name: PaletteName, mode: 'light' | 'dark'): TokenBlock {
  const found = PALETTES.find((palette) => palette.name === name) ?? PALETTES[0]!
  return mode === 'dark' ? found.dark : found.light
}
