// Fails the build when the shipped page outgrows its budget.
//
// The number has been written down in CLAUDE.md for a long time and checked by
// hand, which means it is checked when somebody remembers. The cost of a
// regression here is not abstract: this app's whole claim is that it opens
// instantly on a phone.
//
// Two figures, because they answer different questions:
//
//   page   what a browser actually fetches to render the app — the HTML, the
//          one JS chunk and the CSS. This is the gate.
//   all-in everything the build emits, including the Capacitor chunks that are
//          `isNative()`-gated and therefore never requested on the web. Printed
//          rather than enforced, so drift is visible without failing a web
//          budget for bytes no web visitor downloads.
import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BUDGET_KB = 150
const DIR = 'dist/assets'

const gz = (file) => gzipSync(readFileSync(file)).length

let page = gz('dist/index.html')
let all = page
const rows = [['index.html', gz('dist/index.html')]]

for (const name of readdirSync(DIR)) {
  const size = gz(join(DIR, name))
  rows.push([name, size])
  all += size
  // The entry chunk and the stylesheet are what the page itself pulls in.
  if (name.startsWith('index-')) page += size
}

rows.sort((a, b) => b[1] - a[1])
for (const [name, size] of rows) {
  console.log(`${(size / 1024).toFixed(2).padStart(8)} KB  ${name}`)
}

const kb = (bytes) => (bytes / 1024).toFixed(2)
console.log('-'.repeat(40))
console.log(`page (html + entry js + css): ${kb(page)} KB  of ${BUDGET_KB} KB`)
console.log(`all-in (every emitted file) : ${kb(all)} KB`)

if (page / 1024 > BUDGET_KB) {
  console.error(`\nOver budget by ${kb(page - BUDGET_KB * 1024)} KB.`)
  process.exit(1)
}
console.log(`\nHeadroom: ${kb(BUDGET_KB * 1024 - page)} KB`)
