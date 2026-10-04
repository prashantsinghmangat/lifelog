import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCT } from './product'

/**
 * Holds the two files that carry the product's name where TypeScript cannot
 * reach them equal to `PRODUCT`. Neither is generated: Android resources are
 * static XML and `public/privacy.html` is served byte-for-byte, so a loud test
 * is cheaper than a codegen step and it is the bargain `contrast.test.ts`
 * already strikes between `palettes.ts` and `index.css`.
 *
 * The stale-variant case is the one with a bug behind it. `privacy.html` went
 * live saying `LifLog` twice — a misspelling a case-insensitive grep for the
 * real name never finds, on the one page a reader is most likely to take
 * literally.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const strings = read('../../android/app/src/main/res/values/strings.xml')
const privacy = read('../../public/privacy.html')

/** Names the file to edit, because this test failing means hand-editing one. */
const FIX = (file: string) => `${file} disagrees with PRODUCT in src/lib/product.ts — edit it`

describe('the product identity', () => {
  it('names every field', () => {
    for (const [field, value] of Object.entries(PRODUCT)) {
      expect(value, field).toBeTruthy()
      expect(value.trim(), field).toBe(value)
    }
  })

  it('has a slug that can name a downloaded file', () => {
    expect(PRODUCT.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  })

  it('points its URLs at https', () => {
    expect(PRODUCT.url).toMatch(/^https:\/\//)
    expect(PRODUCT.issuesUrl).toMatch(/^https:\/\//)
  })
})

describe('the Android label', () => {
  const value = (name: string) =>
    new RegExp(`<string name="${name}">([^<]*)</string>`).exec(strings)?.[1]

  it('is the product name', () => {
    expect(value('app_name'), FIX('strings.xml')).toBe(PRODUCT.name)
  })

  it('titles the activity with it too', () => {
    expect(value('title_activity_main'), FIX('strings.xml')).toBe(PRODUCT.name)
  })

  // The other two strings in that file are technical identity. A rename must
  // not touch them: a new applicationId is a new app on the Play Store.
  it('keeps the package and URL scheme out of the rename', () => {
    expect(value('package_name')).toBe('com.prashant.lifelog')
    expect(value('custom_url_scheme')).toBe('com.prashant.lifelog')
  })
})

describe('the privacy page', () => {
  it('calls the product by its name', () => {
    expect(privacy, FIX('public/privacy.html')).toContain(`<title>${PRODUCT.name} — privacy</title>`)
    expect(privacy, FIX('public/privacy.html')).toContain(`<h1>${PRODUCT.name} — privacy</h1>`)
  })

  it('names it in the body prose, both places', () => {
    expect(privacy).toContain(`${PRODUCT.name}'s servers`)
    expect(privacy).toContain(`describes ${PRODUCT.name} as implemented`)
  })

  it('carries no stale brand variant', () => {
    // `LifLog` is the one that actually shipped. The general rule underneath
    // it: once the name changes, nothing on this page may still say the old
    // one in any casing, and a prose sentence is where that gets missed.
    expect(privacy).not.toContain('LifLog')
    for (const match of privacy.matchAll(/\blif[a-z]*log\b/gi)) {
      // The repo URL is a technical identifier and keeps its own spelling —
      // in the href *and* in the link text, where `github.com` sits before the
      // match rather than after it. Both sides of the window, or the link text
      // reads as stale branding.
      const around = privacy.slice(Math.max(0, match.index - 60), match.index + 40)
      if (around.includes('github.com')) continue
      expect(match[0].toLowerCase()).toBe(PRODUCT.name.toLowerCase())
    }
  })

  it('offers the support route the identity declares', () => {
    expect(privacy).toContain(PRODUCT.issuesUrl)
  })
})
