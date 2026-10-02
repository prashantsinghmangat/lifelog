/**
 * Extracts the verification token from a pasted sign-in link.
 *
 * This exists because a link tapped in Mail on iOS opens in Safari, which has
 * its own storage, so an installed PWA can never be signed in that way. Pasting
 * the link into the app verifies the same token where the session is wanted.
 *
 * Input is whatever the clipboard held: a bare URL, a Gmail-wrapped redirect
 * with the real URL percent-encoded inside it, or an entire email pasted whole.
 *
 * **The token must come from this project's own host, and from the URL's own
 * query string.** The first version matched `token=` anywhere in the pasted
 * text, which was two bugs wearing one coat. The mild one: any tracking or
 * unsubscribe link carrying `token=` ahead of the real one won, so pasting a
 * whole email sometimes verified a stranger's parameter and reported "Token has
 * expired or is invalid" with nothing to explain it. The sharp one: a link to
 * *another account on this project* verified happily, so an attacker who could
 * get a magic link of their own — which project-level signups being on makes
 * possible — could mail it over as a sign-in prompt and have the paste route
 * sign its owner into the attacker's account, at which point `adopt` carries
 * the whole local log onto it. Parsing each URL properly and keeping only the
 * ones addressed to this project closes both: a foreign host is refused, and a
 * token smuggled inside another parameter (`redirect_to=…%3Ftoken%3Dx`) is not
 * in the outer URL's query string and so is never read.
 */

/** The spellings Supabase uses, in the order they should be preferred. */
const NAMES = ['token_hash', 'token'] as const

/** What a verification token may contain. Rejects a decoded space or `+`. */
const SHAPE = /^[A-Za-z0-9._~-]+$/

/** Where an absolute http(s) URL starts. */
const SCHEME = /https?:\/\//g

/** Where one ends: whitespace, or a quote that was wrapped around it. */
const DELIMITER = /[\s<>"'`]/

/** Trailing prose punctuation, which is not part of the link that preceded it. */
const TRAILING = /[.,;:!?)\]}'"]+$/

/**
 * Every URL in the text, **including ones nested inside another**. A Gmail
 * redirect decodes to `…google.com/url?q=https://<project>/…`, which is one
 * unbroken run of non-whitespace: scanning for whole URLs finds only the
 * outer one and throws the real link away with it. So each `https://` is its
 * own starting point, and the scan resumes one character in rather than past
 * the match it just took.
 */
function urlsIn(text: string): string[] {
  // A fresh regex per call: a module-level one carries `lastIndex` between
  // calls, and this function has to answer the same for the same input.
  const scheme = new RegExp(SCHEME.source, 'g')
  const found: string[] = []
  let match: RegExpExecArray | null
  while ((match = scheme.exec(text)) !== null) {
    const rest = text.slice(match.index)
    const end = rest.search(DELIMITER)
    found.push(end === -1 ? rest : rest.slice(0, end))
    scheme.lastIndex = match.index + 1
  }
  return found
}

/**
 * The project this build talks to. Read once from the same env var the Supabase
 * client is built from, so there is nothing to keep in step — and defaulted
 * rather than imported, which keeps this module free of the client (and of the
 * throw-at-import that missing env vars raise there).
 */
function configuredHost(): string {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname
  } catch {
    // No usable project URL: nothing can be proven to belong to it, so nothing
    // is accepted. The app itself cannot reach this — `supabase.ts` throws at
    // import without the same variable.
    return ''
  }
}

const PROJECT_HOST = configuredHost()

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    // A stray % makes decodeURIComponent throw. Fall back to the raw text.
    return text
  }
}

/** The token this URL carries, if it is one of ours and the value is usable. */
function tokenIn(candidate: string, host: string): string | null {
  let url: URL
  try {
    url = new URL(candidate.replace(TRAILING, ''))
  } catch {
    return null
  }

  if (host === '' || url.hostname !== host) return null

  for (const name of NAMES) {
    // `searchParams` percent-decodes, so a `%2B` arrives as `+` and is refused
    // by SHAPE rather than silently truncated at it.
    const value = url.searchParams.get(name)
    if (value !== null && SHAPE.test(value)) return value
  }
  return null
}

/**
 * @param host The Supabase hostname a token must belong to. Defaulted from the
 *   environment; a parameter so the rule is testable without one, and so this
 *   stays pure — same text, same host, same answer, every time.
 */
export function tokenFrom(text: string, host: string = PROJECT_HOST): string | null {
  // The raw text first, then the decoded form: a Gmail redirect carries the
  // real URL percent-encoded inside its own `q` parameter, and only decoding
  // makes it a URL that can be parsed at all.
  for (const candidate of [text, decoded(text)]) {
    for (const found of urlsIn(candidate)) {
      const token = tokenIn(found, host)
      if (token !== null) return token
    }
  }
  return null
}
