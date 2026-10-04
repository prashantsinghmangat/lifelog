import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fillBrand, type Brand } from './productHtml'
import { PRODUCT } from './product'

/**
 * `fillBrand` is the whole of the HTML branding, so this covers the substitution
 * and `index.html` itself is checked for placeholders it would leave behind.
 *
 * What this cannot prove is that the plugin is registered — a green test here
 * with an unwired `vite.config.ts` would ship an HTML file reading
 * `%PRODUCT_NAME%` in the tab. The built `dist/index.html` is grepped in the
 * spec's Verify for that half.
 */

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

const brand: Brand = { name: 'TestBrand', shortName: 'TB', tagline: 'A tagline' }

describe('fillBrand', () => {
  it('fills the name and the short name', () => {
    const filled = fillBrand(html, brand)
    expect(filled).toContain('<title>TestBrand</title>')
    expect(filled).toContain('content="TB"')
  })

  it('leaves no placeholder behind in index.html', () => {
    expect(fillBrand(html, brand)).not.toMatch(/%PRODUCT_/)
  })

  it('changes nothing else', () => {
    const filled = fillBrand(html, brand)
    // Every line without a placeholder comes through identical.
    const before = html.split('\n').filter((line) => !line.includes('%PRODUCT_'))
    expect(filled.split('\n').filter((line) => before.includes(line))).toEqual(before)
  })

  it('passes a name with HTML-awkward characters through unescaped', () => {
    // Not this product's problem today, but a brand with an ampersand or an
    // apostrophe is the obvious next name and the substitution must not mangle
    // it into an entity or truncate the attribute.
    const awkward = { name: "Nate's & Co", shortName: "Nate's", tagline: 'x' }
    expect(fillBrand(html, awkward)).toContain("<title>Nate's & Co</title>")
  })

  it('is a no-op on HTML with no placeholders', () => {
    expect(fillBrand('<p>nothing to fill</p>', brand)).toBe('<p>nothing to fill</p>')
  })

  it('fills index.html from the real identity', () => {
    const filled = fillBrand(html, PRODUCT)
    expect(filled).toContain(`<title>${PRODUCT.name}</title>`)
    expect(filled).toContain(`content="${PRODUCT.shortName}"`)
  })
})
