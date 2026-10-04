import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { PRODUCT } from './src/lib/product.ts'
import { fillBrand } from './src/lib/productHtml.ts'

export default defineConfig({
  // The source has zero console statements of its own; this makes that
  // structural rather than a discipline. Without it 32 dependency calls ship,
  // several in auth-js printing AuthError objects on the refresh-token path —
  // the one route a token-adjacent object could reach a production console.
  // Vite 8 ignores the `esbuild.drop` spelling (it warns); this is the oxc
  // minifier's, with mangle and whitespace restated since an object here
  // replaces the defaults rather than extending them.
  build: {
    rolldownOptions: {
      output: {
        minify: {
          mangle: true,
          codegen: { removeWhitespace: true },
          compress: { dropConsole: true, dropDebugger: true },
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // No `apply`, so it runs in dev and in a build: the dev server transforms
    // index.html through this same hook, which is what keeps one name in one
    // place instead of a served copy and a shipped copy drifting apart.
    { name: 'product-brand', transformIndexHtml: (html) => fillBrand(html, PRODUCT) },
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from main.tsx instead of an injected script, because it must
      // not happen inside the native shell: there the worker caches the app
      // shell and then serves it in place of the freshly installed assets, so
      // every update silently fails to arrive.
      injectRegister: null,
      manifest: {
        name: PRODUCT.name,
        short_name: PRODUCT.shortName,
        description: PRODUCT.tagline,
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#faf9f7',
        theme_color: '#faf9f7',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // A maskable icon is cropped to whatever shape the launcher wants, so
          // it needs its own full-bleed square rather than the rounded tile —
          // reusing the rounded one showed transparent corners under a square
          // mask and clipped the tile's own radius under a circular one.
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell only. No runtimeCaching: a cached Supabase response would
        // mean showing stale entries, and V1 has no offline story.
        // The plugin adds the manifest and icons itself; listing them here too
        // puts duplicate entries in the precache manifest.
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: '/index.html',
        // The worker's scope is the whole origin, so without this a navigation
        // to `/.netlify/functions/backups` is answered with the app shell. The
        // backup listing and download are the recovery tools, and they would
        // fail by rendering a working-looking app rather than by erroring —
        // from the one browser most likely to be used to reach them.
        navigateFallbackDenylist: [/^\/\.netlify\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
