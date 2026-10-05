# LifeLog marketing site

A standalone static site. No build step, no framework, no CDN at runtime — open
`index.html` and it works. Everything the page needs is in this folder.

```
website/
├── index.html              the whole page
├── 404.html
├── robots.txt
├── sitemap.xml
├── site.webmanifest
├── netlify.toml            headers + caching, when this folder is the deploy base
├── assets/
│   ├── css/styles.css      all styles, tokens at the top
│   ├── js/main.js          progressive enhancement only
│   └── img/                favicon, OG cover, generated PNG icons
└── tools/make-icons.mjs    regenerates the PNG icons (pure Node, no deps)
```

## Run it

```bash
npx serve website          # or: python -m http.server 8080 -d website
```

Opening `website/index.html` straight off disk also works; only the manifest's
absolute `/assets/...` paths need a server.

## Deploy

Point the host at `website/` as the publish directory.

- **Netlify** — set the site's base directory to `website`; `netlify.toml` here
  supplies the security headers and cache policy.
- **Vercel / Cloudflare Pages / GitHub Pages** — set the output directory to
  `website`, no build command (or `node tools/make-icons.mjs` if you want the
  icons regenerated on every deploy).

## Before launch — the one thing to change

Every absolute URL points at `https://lifelog-timeline.netlify.app/`, which is
where the **app** lives. Once the marketing site has its own hostname, update it
in four places:

1. `index.html` — `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`
   and the three `@id`/`url` fields in the JSON-LD block.
2. `robots.txt` — the `Sitemap:` line.
3. `sitemap.xml` — the `<loc>` and `<lastmod>`.
4. Leave the **"Try LifeLog"** links pointing at the app's URL — those are
   meant to leave the marketing site.

```bash
# from the repo root
grep -rl 'lifelog-timeline.netlify.app' website | xargs sed -i 's|https://lifelog-timeline.netlify.app|https://YOUR-DOMAIN|g'
# then put the app URL back on the CTAs
```

## Social preview image

`assets/img/og-cover.svg` is the designed 1200×630 card. Facebook, LinkedIn and
X **do not render SVG** social previews — export it to PNG once and swap the two
meta tags:

```bash
npx --yes sharp-cli -i website/assets/img/og-cover.svg -o website/assets/img/og-cover.png resize 1200 630
# then change og:image and twitter:image to .../og-cover.png
```

Until that PNG exists, previews fall back to the page title and description,
which still read correctly.

## Icons

`tools/make-icons.mjs` writes `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png` and `icon-maskable-512.png` from pure geometry — no fonts, no
image library. Re-run it after changing the brand colour:

```bash
node website/tools/make-icons.mjs
```

## What's in the SEO pass

- Unique `<title>` and meta description, canonical URL, explicit `robots`.
- Open Graph + Twitter card with image dimensions and alt text.
- JSON-LD `@graph` with `WebSite`, `SoftwareApplication` and `FAQPage`. The
  `FAQPage` entries mirror the visible FAQ section verbatim — **if you edit one,
  edit the other**, or the markup stops being eligible for rich results.
- `sitemap.xml`, `robots.txt`, web app manifest, themed `theme-color` for light
  and dark.
- Semantic landmarks (`header`/`main`/`footer`/`nav`), one `h1`, ordered
  headings, a skip link, labelled nav regions, and `aria-live` on the demo
  stream.
- Security headers and a CSP in `netlify.toml`.

## Responsiveness

Mobile-first, fluid type via `clamp()`, and layout breakpoints at 36rem, 48rem,
52rem, 60rem and 64rem. Tap targets are 44px minimum. There is no device-specific
CSS — the layout reflows on content width, not on named devices. Reduced-motion
and print are both handled at the foot of `styles.css`.

## A note on the demo parser

`main.js` classifies the sandbox input with a few throwaway regexes. It is a
demo, deliberately separate from the real parser in `src/lib/parser.ts`. Do not
sync them — the real one is pure, tested, and order-dependent.
