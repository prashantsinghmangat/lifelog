import { useState, type FormEvent } from 'react'
import { tokenFrom } from '../lib/signinLink'
import { supabase } from '../lib/supabase'

/** Password is first because it is the only route that needs no email at all. */
type Mode = 'password' | 'otp'

const FIELD =
  'w-full rounded-lg border border-edge bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-ink'
const LABEL = 'mb-1 block text-xs text-muted'
const PRIMARY =
  'h-12 w-full rounded-lg bg-ink text-sm font-medium text-surface disabled:opacity-50'
const QUIET = 'h-11 text-xs text-muted underline disabled:opacity-50'

/**
 * Three routes in, because each covers a hole in the others.
 *
 * Password needs no email, which matters most: this project cannot edit its
 * email templates (Supabase locked that for free projects created after 3 June
 * 2026 without custom SMTP) and the built-in sender allows two messages an
 * hour. Set the password from the profile sheet while already signed in.
 *
 * A six-digit code needs `{{ .Token }}` in the template, so it only works once
 * custom SMTP is configured.
 *
 * Pasting the link works with the default template as it ships. It exists
 * because a link tapped in Mail opens in Safari, and an installed iOS PWA has
 * separate storage, so the app itself could never be signed in that way.
 */
export function Login() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [link, setLink] = useState('')
  const [sent, setSent] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Success needs no branch anywhere below: onAuthStateChange swaps this screen out.

  async function withPassword(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (error) setMessage(error.message)
  }

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
    setSent(true)
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
  }

  /** Submits itself on the sixth digit. Typing the code is the only action. */
  function onCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6) void verifyCode(digits)
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

  function switchTo(next: Mode) {
    setMode(next)
    setSent(false)
    setPasting(false)
    setCode('')
    setLink('')
    setMessage(null)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
      <h1 className="mb-4 text-lg font-semibold">lifelog</h1>

      {mode === 'password' && (
        <form onSubmit={withPassword}>
          <label className={LABEL} htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className={FIELD}
          />

          <label className={`${LABEL} mt-3`} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD}
          />

          <button type="submit" disabled={busy} className={`mt-4 ${PRIMARY}`}>
            {busy ? '…' : 'Sign in'}
          </button>

          <button type="button" onClick={() => switchTo('otp')} className={`mt-3 ${QUIET}`}>
            Email me a link or code instead
          </button>
        </form>
      )}

      {mode === 'otp' && !sent && (
        <form onSubmit={send}>
          <label className={LABEL} htmlFor="otp-email">
            Email
          </label>
          <div className="flex gap-2">
            <input
              id="otp-email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className={`min-w-0 flex-1 ${FIELD}`}
            />
            <button
              type="submit"
              disabled={busy}
              className="h-12 shrink-0 rounded-lg bg-ink px-4 text-sm font-medium text-surface disabled:opacity-50"
            >
              {busy ? '…' : 'Send'}
            </button>
          </div>

          <button type="button" onClick={() => switchTo('password')} className={`mt-3 ${QUIET}`}>
            Use a password instead
          </button>
        </form>
      )}

      {mode === 'otp' && sent && (
        <>
          <p className="mb-4 text-sm text-muted">Sent to {email}.</p>

          {pasting ? (
            <form onSubmit={verifyLink}>
              <label className={LABEL} htmlFor="signin-link">
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
                Press and hold <strong>Sign in</strong> in the email and choose Copy Link. Do not
                open it first — it works only once.
              </p>
              <button type="submit" disabled={busy} className={`mt-3 ${PRIMARY}`}>
                {busy ? '…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <>
              <label className={LABEL} htmlFor="signin-code">
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
            className={`mt-4 text-left ${QUIET}`}
          >
            {pasting ? 'Enter a code instead' : 'No code in the email? Paste the link instead'}
          </button>

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => switchTo('password')} className={QUIET}>
              Use a password
            </button>
            <button type="button" disabled={busy} onClick={() => void request()} className={QUIET}>
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
