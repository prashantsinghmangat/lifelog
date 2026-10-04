import { useCallback, useEffect, useRef, useState } from 'react'
import { PRODUCT } from '../lib/product'

/**
 * The lock overlay. Deliberately not a `Sheet`: a sheet dismisses on backdrop
 * tap, Escape and Android back, and each of those would be a one-tap bypass.
 * It sits at z-50 — above the sheet scrim (z-40) and the toast — and is
 * rendered above the identity gate in App, so it covers `Login` (which shows
 * the remembered email) and guest mode alike. Supabase is never consulted:
 * the OS verifies, the app only hears yes or no, and no biometric data ever
 * reaches this code.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [asking, setAsking] = useState(false)

  const attempt = useCallback(async () => {
    setAsking(true)
    try {
      const { BiometricAuth, AndroidBiometryStrength } = await import(
        '@aparajita/capacitor-biometric-auth'
      )
      await BiometricAuth.authenticate({
        reason: `Unlock ${PRODUCT.name}`,
        // The OS dialog itself falls back to the device PIN/pattern — this is
        // what makes an app-grown passcode unnecessary.
        allowDeviceCredential: true,
        // Class 2 is enough for gating UI, and `strong` would exclude face
        // unlock on devices where face is class 2, for no gain here.
        androidBiometryStrength: AndroidBiometryStrength.weak,
        androidTitle: `Unlock ${PRODUCT.name}`,
      })
      onUnlock()
    } catch {
      // Cancelled, failed, or locked out: stay locked, leave the button.
    } finally {
      setAsking(false)
    }
  }, [onUnlock])

  // Ask as the overlay appears — opening the app is the request to get in.
  // Once per mount, guarded: the OS prompt itself pauses the activity, which
  // re-renders App, and an unguarded effect re-prompted on every cancel.
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void attempt()
  }, [attempt])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${PRODUCT.name} is locked`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-surface"
    >
      <div
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent font-serif text-2xl text-white"
      >
        L
      </div>
      <p className="text-sm text-muted">{PRODUCT.name} is locked</p>
      <button
        type="button"
        disabled={asking}
        onClick={() => void attempt()}
        className="min-h-11 rounded-full bg-ink px-7 text-sm font-medium text-surface disabled:opacity-60"
      >
        Unlock
      </button>
    </div>
  )
}
