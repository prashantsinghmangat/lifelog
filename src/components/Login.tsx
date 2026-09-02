import { useState, type FormEvent } from 'react'
import { tokenFrom } from '../lib/signinLink'
import { supabase } from '../lib/supabase'

type Stage = 'email' | 'sent'

const FIELD =
  'w-full rounded-lg border border-edge bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-ink'

/**
 * Two ways in, because one of them is unavailable depending on the project.
 *
 * A six-digit code is the good path, but it needs `{{ .Token }}` in the email
 * template, and Supabase locked template editing for free projects created
 * after 3 June 2026 unless custom SMTP is configured. Until then the email
 * carries only a link.
 *
 * The link cannot sign in an installed iOS PWA on its own: tapped in Mail it
 * opens in Safari, which has separate storage. Pasting it here extracts the
 * same token and verifies it in the app, where the session is needed.
 */
export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [link, setLink] = useState('')
  const [pasting, setPasting] = useState(false)
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
    setStage('sent')
  }

  function send(event: FormEvent) {
    event.preventDefault()
    void request()
  }

  async function verifyCode(token: string) {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' })
    setBusy(false)

    if (error) {
      setMessage(error.message)
      setCode('')
    }
    // Success needs no branch: onAuthStateChange swaps this screen out.
  }

  async function verifyLink(event: FormEvent) {
    event.preventDefault()
    const token = tokenFrom(link)
    if (token === null) {
      setMessage('That does not look like a sign-in link.')
      return
    }

    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
    setBusy(false)

    if (error) setMessage(error.message)
  }

  /** Submits itself on the sixth digit. Typing the code is the only action. */
  function onCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6) void verifyCode(digits)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-lg font-semibold">lifelog</h1>

      {stage === 'email' ? (
        <>
          <p className="mb-4 text-sm text-muted">Sign in with your email.</p>
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
          <p className="mb-4 text-sm text-muted">Sent to {email}.</p>

          {pasting ? (
            <form onSubmit={verifyLink}>
              <label className="mb-1 block text-xs text-muted" htmlFor="signin-link">
                Paste the sign-in link
              </label>
              <textarea
                id="signin-link"
                autoFocus
                rows={3}
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://…/auth/v1/verify?token=…"
                className={FIELD}
              />
              <p className="mt-1.5 text-xs text-faint">
                In the email, press and hold <strong>Sign in</strong> and choose Copy Link. Do not
                open it first — the link works only once.
              </p>
              <button
                type="submit"
                disabled={busy}
                className="mt-3 h-11 w-full rounded-lg bg-ink text-sm font-medium text-surface disabled:opacity-50"
              >
                {busy ? '…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <>
              <label className="mb-1 block text-xs text-muted" htmlFor="signin-code">
                Six-digit code
              </label>
              <input
                id="signin-code"
                type="text"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => onCode(event.target.value)}
                placeholder="123456"
                className={`text-center text-2xl tracking-[0.4em] ${FIELD}`}
              />
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setPasting(!pasting)
              setMessage(null)
            }}
            className="mt-4 h-11 text-left text-xs text-muted underline"
          >
            {pasting ? 'Enter a code instead' : 'No code in the email? Paste the link instead'}
          </button>

          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStage('email')
                setCode('')
                setLink('')
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

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-expense">
        {message}
      </p>
    </div>
  )
}
