/**
 * Fills the brand placeholders in `index.html`.
 *
 * Its own module, not a closure inside `vite.config.ts`, for two reasons: a
 * pure function can be tested, and nothing in `src/main.tsx`'s import graph
 * reaches this file, so it never enters the page bundle it is helping to
 * brand.
 *
 * The identity is passed in rather than imported. `vite.config.ts` is a
 * separate tsconfig project from `src`, and a module that straddles the two
 * has to satisfy both resolution modes; taking an argument sidesteps that and
 * leaves the function's whole input in its signature.
 *
 * Vite's `transformIndexHtml` runs in dev and in a build alike, so this is the
 * only substitution — the dev server and the shipped HTML cannot disagree
 * about the name because there is one code path between them.
 */
export type Brand = { name: string; shortName: string; tagline: string }

const PLACEHOLDER = /%PRODUCT_(NAME|SHORT_NAME|TAGLINE)%/g

export function fillBrand(html: string, brand: Brand): string {
  return html.replace(PLACEHOLDER, (_match, field: string) =>
    field === 'NAME' ? brand.name : field === 'SHORT_NAME' ? brand.shortName : brand.tagline,
  )
}
