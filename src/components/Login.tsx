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
      <p className="mb-4 text-sm text-gray-500">Sign in with a magic link.</p>

      <form onSubmit={submit} className="flex gap-2">
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-base outline-none focus:border-gray-900"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === 'sending' ? '…' : 'Send'}
        </button>
      </form>

      {status === 'sent' && (
        <p className="mt-3 text-sm text-gray-600">Link sent. Check {email} and open it on this device.</p>
      )}
      {status === 'error' && <p className="mt-3 text-sm text-expense">{message}</p>}
    </div>
  )
}
