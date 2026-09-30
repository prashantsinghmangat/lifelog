import { GoTrueClient } from '@supabase/auth-js'
import { PostgrestClient } from '@supabase/postgrest-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.')
}

/**
 * The two halves of the SDK the app actually uses, imported directly.
 * `createClient` also pulled in realtime, storage and functions clients this
 * app has never called, and the page was over its 150 KB budget carrying them.
 *
 * The storage key is the one `supabase-js` derives — `sb-<ref>-auth-token`,
 * ref being the first label of the project host — because the session on every
 * signed-in device lives under it. A different key here would read as "nobody
 * is signed in" and silently log the phone out on update.
 */
const ref = new URL(url).hostname.split('.')[0]

const auth = new GoTrueClient({
  url: `${url}/auth/v1`,
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  storageKey: `sb-${ref}-auth-token`,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
})

/**
 * What `createClient` wired invisibly, and what RLS depends on: every
 * PostgREST request carries the anon key and the *current* session's token —
 * read per request, not captured once, or a refreshed token would leave
 * queries signed with an expired one.
 */
const authedFetch: typeof fetch = async (input, init) => {
  const { data } = await auth.getSession()
  const headers = new Headers(init?.headers)
  headers.set('apikey', anonKey)
  headers.set('Authorization', `Bearer ${data.session?.access_token ?? anonKey}`)
  return fetch(input, { ...init, headers })
}

const rest = new PostgrestClient(`${url}/rest/v1`, { fetch: authedFetch })

/** The same surface `createClient` gave the app: `auth`, and `from`. */
export const supabase = {
  auth,
  from: (table: string) => rest.from(table),
}
