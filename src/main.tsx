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
