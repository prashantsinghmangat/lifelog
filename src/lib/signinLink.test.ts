import { describe, expect, it } from 'vitest'
import { tokenFrom } from './signinLink'

// A stand-in project. `tokenFrom` takes the host it must match as a parameter,
// so nothing here depends on a real one — and pinning a live project's endpoint
// in a public repository hands it to anyone reading the tests.
const HOST = 'project.supabase.co'
const REF = `https://${HOST}/auth/v1/verify`

describe('tokenFrom', () => {
  it('reads token from a Supabase verify link', () => {
    expect(
      tokenFrom(`${REF}?token=abc123&type=magiclink&redirect_to=https://x.dev`, HOST),
    ).toBe('abc123')
  })

  it('reads the token_hash spelling', () => {
    expect(tokenFrom(`${REF}?token_hash=pkce_9f8e7d&type=magiclink`, HOST)).toBe('pkce_9f8e7d')
  })

  it('unwraps a Gmail redirect with the real URL percent-encoded inside', () => {
    const wrapped = `https://www.google.com/url?q=https%3A%2F%2F${HOST}%2Fauth%2Fv1%2Fverify%3Ftoken%3Dwrapped99%26type%3Dmagiclink`
    expect(tokenFrom(wrapped, HOST)).toBe('wrapped99')
  })

  it('finds the token when a whole email is pasted', () => {
    const email = `Your sign-in link
      Follow the link below to sign in.
      Sign in: ${REF}?token=frompaste&type=magiclink
      You're receiving this email because you signed up.`
    expect(tokenFrom(email, HOST)).toBe('frompaste')
  })

  it('does not mistake access_token for the verification token', () => {
    // An implicit-flow callback carries session tokens, not a verify token —
    // and they arrive in the fragment, which is not the query string.
    expect(tokenFrom('https://x.dev/#access_token=eyJhbGc&refresh_token=v1abc', HOST)).toBeNull()
    expect(tokenFrom(`https://${HOST}/#access_token=eyJhbGc&refresh_token=v1abc`, HOST)).toBeNull()
  })

  it('prefers token_hash when both spellings appear', () => {
    expect(tokenFrom(`${REF}?token_hash=hashed&other=token=decoy`, HOST)).toBe('hashed')
  })

  it('tolerates dots, tildes, underscores and hyphens in the token', () => {
    expect(tokenFrom(`${REF}?token=a.b_c~d-e`, HOST)).toBe('a.b_c~d-e')
  })

  it('returns null for text with no token', () => {
    expect(tokenFrom('https://lifelog-timeline.netlify.app/', HOST)).toBeNull()
    expect(tokenFrom('', HOST)).toBeNull()
    expect(tokenFrom('just some words', HOST)).toBeNull()
  })

  it('returns null for an empty token value', () => {
    expect(tokenFrom(`${REF}?token=&type=magiclink`, HOST)).toBeNull()
  })

  it('does not throw on a malformed percent escape', () => {
    expect(tokenFrom('100% broken', HOST)).toBeNull()
    // The genuine link is still found once decoding has given up on the text.
    expect(tokenFrom(`100% broken ${REF}?token=stillfound&type=magiclink`, HOST)).toBe('stillfound')
  })
})

/**
 * The host rule. A pasted link is an instruction to create a session, and the
 * only thing that makes one safe to follow is that it was addressed to this
 * project: a valid magic link for *another account on this project* would
 * otherwise sign its reader into that account, and `adopt` would then carry
 * their whole local log onto it.
 */
describe('tokenFrom only trusts this project', () => {
  it('refuses a token from a foreign host', () => {
    expect(
      tokenFrom('https://evil.example.com/auth/v1/verify?token=ATTACKER&type=magiclink', HOST),
    ).toBeNull()
  })

  it('takes the genuine link over a decoy token earlier in the paste', () => {
    const email = `Your sign-in link
      Unsubscribe: https://mkt.example.com/u?token=DECOY_UNSUB
      Sign in: ${REF}?token=REAL&type=magiclink`
    expect(tokenFrom(email, HOST)).toBe('REAL')
  })

  it('does not read a token smuggled into another parameter of a genuine link', () => {
    // Our host, but the token is inside `redirect_to` rather than in the query
    // string of its own right — so it is not this URL's token.
    const smuggled = `${REF}?type=magiclink&redirect_to=https%3A%2F%2Fevil.example.com%3Ftoken%3DINJECTED`
    expect(tokenFrom(smuggled, HOST)).toBeNull()
  })

  it('refuses a bare query fragment with no URL around it', () => {
    // There is no host to check, so there is nothing to trust.
    expect(tokenFrom('?token=stillfound', HOST)).toBeNull()
  })

  it('accepts nothing at all when no project host is configured', () => {
    expect(tokenFrom(`${REF}?token=abc123&type=magiclink`, '')).toBeNull()
  })
})
