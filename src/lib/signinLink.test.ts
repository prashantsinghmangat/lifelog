import { describe, expect, it } from 'vitest'
import { tokenFrom } from './signinLink'

const REF = 'https://awdsolgrnxnwnaczkdny.supabase.co/auth/v1/verify'

describe('tokenFrom', () => {
  it('reads token from a Supabase verify link', () => {
    expect(tokenFrom(`${REF}?token=abc123&type=magiclink&redirect_to=https://x.dev`)).toBe(
      'abc123',
    )
  })

  it('reads the token_hash spelling', () => {
    expect(tokenFrom(`${REF}?token_hash=pkce_9f8e7d&type=magiclink`)).toBe('pkce_9f8e7d')
  })

  it('unwraps a Gmail redirect with the real URL percent-encoded inside', () => {
    const wrapped =
      'https://www.google.com/url?q=https%3A%2F%2Fx.supabase.co%2Fauth%2Fv1%2Fverify%3Ftoken%3Dwrapped99%26type%3Dmagiclink'
    expect(tokenFrom(wrapped)).toBe('wrapped99')
  })

  it('finds the token when a whole email is pasted', () => {
    const email = `Your sign-in link
      Follow the link below to sign in.
      Sign in: ${REF}?token=frompaste&type=magiclink
      You're receiving this email because you signed up.`
    expect(tokenFrom(email)).toBe('frompaste')
  })

  it('does not mistake access_token for the verification token', () => {
    // An implicit-flow callback carries session tokens, not a verify token.
    expect(tokenFrom('https://x.dev/#access_token=eyJhbGc&refresh_token=v1abc')).toBeNull()
  })

  it('prefers token_hash when both spellings appear', () => {
    expect(tokenFrom(`${REF}?token_hash=hashed&other=token=decoy`)).toBe('hashed')
  })

  it('tolerates dots, tildes, underscores and hyphens in the token', () => {
    expect(tokenFrom(`${REF}?token=a.b_c~d-e`)).toBe('a.b_c~d-e')
  })

  it('returns null for text with no token', () => {
    expect(tokenFrom('https://lifelog-timeline.netlify.app/')).toBeNull()
    expect(tokenFrom('')).toBeNull()
    expect(tokenFrom('just some words')).toBeNull()
  })

  it('does not throw on a malformed percent escape', () => {
    expect(tokenFrom('100% broken ?token=stillfound')).toBe('stillfound')
  })
})
