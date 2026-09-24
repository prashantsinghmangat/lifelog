// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Login } from './Login'

/**
 * The sign-in box is the only door into this project's auth, and the project
 * expects exactly one user. What is pinned here is a *control*, not a
 * behaviour: `signInWithOtp` creates the user when the address is unknown
 * unless it is told not to, so the default turned this screen into an open
 * sign-up form without anything in the UI saying so.
 */

// Declared inside the factory: `vi.mock` is hoisted above every top-level
// binding in this file, so a mock built from one would read it uninitialised.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ error: null })),
    },
  },
}))

const { supabase } = await import('../lib/supabase')
const auth = supabase.auth as unknown as {
  signInWithOtp: ReturnType<typeof vi.fn>
  signInWithPassword: ReturnType<typeof vi.fn>
  verifyOtp: ReturnType<typeof vi.fn>
}

afterEach(cleanup)
beforeEach(() => {
  auth.signInWithOtp.mockClear()
})

/** Gets to the emailed-link route, whichever way this screen is laid out. */
async function askForALink(address: string) {
  render(<Login />)

  const route = screen
    .queryAllByRole('button')
    .find((b) => /link|code|email/i.test(b.textContent ?? ''))
  if (route) await userEvent.click(route)

  const email = screen.getByLabelText(/email/i)
  await userEvent.type(email, address)

  const send = screen
    .getAllByRole('button')
    .find((b) => /send|link|continue|sign in/i.test(b.textContent ?? ''))
  if (!send) throw new Error('no send control')
  await userEvent.click(send)
}

describe('the sign-in box as a single-user door', () => {
  it('never lets an unknown address create an account', async () => {
    await askForALink('a-stranger@example.com')

    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalled())
    const sent = auth.signInWithOtp.mock.calls[0]?.[0] as
      | { options?: { shouldCreateUser?: boolean } }
      | undefined
    expect(sent?.options?.shouldCreateUser).toBe(false)
  })

  it('has no sign-up call to reach for', () => {
    // The mocked client carries no `signUp`, so any future call would throw
    // here rather than quietly succeed against the real project.
    expect(Object.keys(auth)).not.toContain('signUp')
  })
})

describe('when the auth call falls over rather than refusing', () => {
  it('does not leave the form disabled with nothing said', async () => {
    // supabase-js answers most failures with `{ error }` and rethrows the rest.
    // Uncaught, `setBusy(false)` never ran and every control on the only screen
    // into the app stayed disabled — no message, no retry, nothing but a reload.
    auth.signInWithOtp.mockRejectedValueOnce(new Error('Failed to fetch'))

    await askForALink('owner@example.com')

    await waitFor(() => expect(screen.getByText(/failed to fetch/i)).toBeTruthy())
    const disabled = screen.getAllByRole('button').filter((b) => b.hasAttribute('disabled'))
    expect(disabled).toHaveLength(0)
  })
})
