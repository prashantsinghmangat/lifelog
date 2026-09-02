/**
 * Extracts the verification token from a pasted sign-in link.
 *
 * This exists because a link tapped in Mail on iOS opens in Safari, which has
 * its own storage, so an installed PWA can never be signed in that way. Pasting
 * the link into the app verifies the same token where the session is wanted.
 *
 * Input is whatever the clipboard held: a bare URL, a Gmail-wrapped redirect
 * with the real URL percent-encoded inside it, or an entire email pasted whole.
 */

/** `\b` matters: without it, `access_token=` matches on its `token=` tail. */
const TOKEN = /\b(?:token_hash|token)=([A-Za-z0-9._~-]+)/

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    // A stray % makes decodeURIComponent throw. Fall back to the raw text.
    return text
  }
}

export function tokenFrom(text: string): string | null {
  for (const candidate of [text, decoded(text)]) {
    const found = TOKEN.exec(candidate)
    if (found?.[1] !== undefined) return found[1]
  }
  return null
}
