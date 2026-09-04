import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Set CAP_DEV_URL to point the installed app at the Vite dev server instead of
 * the bundled assets, which gives live reload on a real device with no rebuild
 * per change:
 *
 *   $env:CAP_DEV_URL = 'http://192.168.0.194:5173'
 *   npm run dev:host          # in one terminal
 *   npm run android           # once, in another, then reinstall
 *
 * Driven by an environment variable rather than an edited-in URL on purpose: a
 * hardcoded server block is the classic way to ship an APK that only works on
 * the network it was built on. Unset the variable and the next build is
 * standalone again.
 */
const devUrl = process.env['CAP_DEV_URL']

const config: CapacitorConfig = {
  appId: 'com.prashant.lifelog',
  appName: 'lifelog',
  webDir: 'dist',
  ...(devUrl !== undefined && devUrl !== ''
    ? { server: { url: devUrl, cleartext: true } }
    : {}),
}

export default config
