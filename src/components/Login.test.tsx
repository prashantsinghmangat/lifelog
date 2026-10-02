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

/**
 * Every TypeScript file this project ships, as text, minus its own tests — so a
 * test that merely *mentions* sign-up in a name or a comment cannot trip the
 * scan. `import.meta.glob` resolves at build time (the `stats.ts?raw`
 * precedent, widened), which keeps this off node's filesystem entirely: the app
 * compiles browser-only on purpose, and a walk would have needed `@types/node`.
 *
 * `netlify/` is in scope as well as `src/`: the functions run with the
 * service-role key, so they are the other place account creation could be
 * reached from.
 */
const PRODUCTION_SOURCES: Record<string, string> = {
  ...import.meta.glob<string>(
    ['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ),
  ...import.meta.glob<string>(['../../netlify/**/*.ts', '!../../netlify/**/*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
}

/**
 * Comments removed, so prose about sign-up reads as prose. The `[^:]` guard is
 * what keeps `https://…` from being mistaken for the start of a line comment
 * and swallowing the rest of a line of real code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

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

  /**
   * Read off the source tree, not off the mock above.
   *
   * This assertion used to be `expect(Object.keys(auth)).not.toContain('signUp')`
   * — which inspected the mock defined forty lines up, could not fail for any
   * change to `src/`, and claimed a guarantee it did not provide. The real
   * `GoTrueClient` necessarily exposes `signUp`, so there is nothing to assert
   * at runtime: what matters is that no shipped file calls it.
   */
  it('is not called from anywhere in the source', () => {
    const scanned = Object.entries(PRODUCTION_SOURCES)
    // A scan that found nothing to read would pass for the wrong reason.
    expect(scanned.length).toBeGreaterThan(20)

    const callers = scanned
      .filter(([, text]) => withoutComments(text).includes('.signUp('))
      .map(([path]) => path)
    expect(callers).toEqual([])
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

/**
 * This project's email cannot carry a six-digit code: the template editor is
 * read-only without custom SMTP, so Supabase sends its own default, which
 * carries only the link. Opening on the code field put the one field that
 * cannot be filled in front of the step that completes the sign-in.
 */
describe('after the email is sent', () => {
  it('opens on the route the email can actually be completed with', async () => {
    await askForALink('owner@example.com')

    await waitFor(() => expect(screen.getByLabelText(/paste the sign-in link/i)).toBeTruthy())
    expect(screen.queryByLabelText(/six-digit code/i)).toBeNull()
    expect(screen.getByText(/press and hold/i)).toBeTruthy()
  })

  it('still offers the code, which keeps working where the template carries one', async () => {
    await askForALink('owner@example.com')
    await waitFor(() => expect(screen.getByLabelText(/paste the sign-in link/i)).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: /code instead/i }))

    expect(screen.getByLabelText(/six-digit code/i)).toBeTruthy()
    expect(screen.queryByLabelText(/paste the sign-in link/i)).toBeNull()
  })

  it('submits the code on the sixth digit, with no button to find', async () => {
    await askForALink('owner@example.com')
    await waitFor(() => expect(screen.getByLabelText(/paste the sign-in link/i)).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /code instead/i }))

    await userEvent.type(screen.getByLabelText(/six-digit code/i), '123456')

    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalled())
    const sent = auth.verifyOtp.mock.calls[0]?.[0] as { token?: string; type?: string } | undefined
    expect(sent?.token).toBe('123456')
    expect(sent?.type).toBe('email')
  })
})
