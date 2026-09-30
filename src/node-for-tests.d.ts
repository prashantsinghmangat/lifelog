/**
 * The app compiles browser-only — `tsconfig.app.json` deliberately lists just
 * `vite/client` in `types`, so application code cannot reach for node APIs by
 * accident. Tests, though, run on node, and `contrast.test.ts` has to read
 * `index.css` off disk: Tailwind's Vite plugin compiles the file before a
 * `?raw` import can see it, so the `stats.ts?raw` precedent does not carry
 * over to CSS. The one node function a test uses is declared here, rather
 * than opening the whole node surface to the app.
 */
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string
}
