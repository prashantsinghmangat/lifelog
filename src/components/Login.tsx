import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export function Login() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setMessage(error.message)
      setStatus('error')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-lg font-semibold">lifelog</h1>
      <p className="mb-4 text-sm text-muted">Sign in with a magic link.</p>

      <form onSubmit={submit} className="flex gap-2">
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded border border-edge bg-surface px-3 py-2 text-base text-ink outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
        >
          {status === 'sending' ? '…' : 'Send'}
        </button>
      </form>

      {status === 'sent' && (
        <p className="mt-3 text-sm text-muted">
          Link sent. Check {email} and open it in this browser — the session is stored here.
        </p>
      )}
      {status === 'error' && <p className="mt-3 text-sm text-expense">{message}</p>}
    </div>
  )
}
