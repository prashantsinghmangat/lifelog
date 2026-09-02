import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Stage = 'email' | 'code'

const FIELD =
  'w-full rounded-lg border border-edge bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-ink'

/**
 * Email, then a six-digit code. The same message also carries a magic link,
 * which is fine on desktop — but on iOS a link tapped in Mail opens in Safari,
 * and an installed PWA has its own storage, so the app itself would stay signed
 * out with no way to fix it. A code typed here creates the session here.
 */
export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<Stage>('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function request() {
    const address = email.trim()
    if (!address) return

    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }
    setStage('code')
  }

  function send(event: FormEvent) {
    event.preventDefault()
    void request()
  }

  async function verify(token: string) {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    })
    setBusy(false)

    if (error) {
      setMessage(error.message)
      setCode('')
    }
    // Success needs no branch: onAuthStateChange swaps this screen out.
  }

  /** Submits itself on the sixth digit. Typing the code is the only action. */
  function onCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6) void verify(digits)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-lg font-semibold">lifelog</h1>

      {stage === 'email' ? (
        <>
          <p className="mb-4 text-sm text-muted">Sign in with a code sent to your email.</p>
          <form onSubmit={send} className="flex gap-2">
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              className={`min-w-0 flex-1 ${FIELD}`}
            />
            <button
              type="submit"
              disabled={busy}
              className="h-12 shrink-0 rounded-lg bg-ink px-4 text-sm font-medium text-surface disabled:opacity-50"
            >
              {busy ? '…' : 'Send'}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Enter the six-digit code sent to {email}. The email also has a link, which works in
            this browser only.
          </p>
          <input
            type="text"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => onCode(event.target.value)}
            placeholder="123456"
            aria-label="Six-digit code"
            className={`text-center text-2xl tracking-[0.4em] ${FIELD}`}
          />
          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStage('email')
                setCode('')
                setMessage(null)
              }}
              className="h-11 text-muted underline"
            >
              Use a different email
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void request()}
              className="h-11 text-muted underline disabled:opacity-50"
            >
              Resend
            </button>
          </div>
        </>
      )}

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-expense">
        {message}
      </p>
    </div>
  )
}
