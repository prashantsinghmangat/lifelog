import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { isNative } from './lib/platform'
import './index.css'

/**
 * The service worker belongs to the web build only.
 *
 * Inside the native shell the assets are already local, so a worker adds
 * nothing — and it actively breaks updates: it precaches the app shell, then
 * serves that copy instead of the newly installed one, so a rebuilt and
 * reinstalled APK keeps running the old code. Worse, `install -r` preserves app
 * data, so the stale cache survives every reinstall.
 *
 * Anything a previous build registered is therefore torn down here.
 */
if (isNative()) {
  void navigator.serviceWorker
    ?.getRegistrations()
    .then((all) => Promise.all(all.map((worker) => worker.unregister())))
    .catch(() => {})

  if (typeof caches !== 'undefined') {
    void caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch(() => {})
  }
} else if ('serviceWorker' in navigator) {
  /**
   * `registerType: 'autoUpdate'` was only half wired.
   *
   * The generated worker calls `skipWaiting`, `clientsClaim` and
   * `cleanupOutdatedCaches`, so a deploy takes over a tab that is already open
   * and drops the precache the running page was built against — while that page
   * goes on running the previous build's JS. Nothing here ever reloaded, so
   * "auto update" meant the new version arrived for the worker and never for
   * the reader: a tab left open for a week keeps showing last week's app.
   *
   * The reload waits until the page is not being looked at. Interrupting
   * somebody mid-entry to swap the build under them would lose whatever is in
   * the capture box, and capture is the product — whereas a tab in the
   * background can be replaced for nothing. If it is never backgrounded it
   * stays as it was, which is exactly the behaviour this replaces.
   */
  const controlled = navigator.serviceWorker.controller !== null
  let owed = false

  const reload = () => {
    if (!owed) return
    owed = false
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first worker claiming a page that had none is not an update, and
    // there is no stale code to replace.
    if (!controlled) return
    owed = true
    if (document.visibilityState === 'hidden') reload()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reload()
  })

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline shell loading is a bonus; failing to register is not fatal.
    })
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
