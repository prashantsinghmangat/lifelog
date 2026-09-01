# lifelog

A personal life timeline. Expenses, work hours, events and notes are the same thing —
something that happened, or will happen, on a date. One table, one screen, one text box.

The entire value is that logging takes under five seconds:

```
350 lunch swiggy        → expense  ₹350   food      today
2h client work          → time     120m             today
dentist tomorrow 5pm    → event           5:00 pm   tomorrow
320 lunch yesterday     → expense  ₹320   food      yesterday
met rahul about the dtx → note                      today
```

Single user. No sharing, no onboarding, no settings.

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Backend | Supabase (Postgres + Auth) |
| Dates | `date-fns` |
| Tests | Vitest |
| PWA | `vite-plugin-pwa` |
| Deploy | Netlify (a Vercel config is committed too) |

Runtime dependencies are exactly four: `react`, `react-dom`, `@supabase/supabase-js`,
`date-fns`. No component library, no state manager, no data-fetching library, no icon
package. The handful of icons are inline SVG.

## Setup

```bash
npm install
```

### 1. Create the Supabase project

[supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Pick the region
closest to you (**South Asia (Mumbai) ap-south-1** for IST). Save the database password; the
app never uses it.

Leave **Enable Data API** on — `supabase.from('entries')` talks to PostgREST and nothing works
without it. Leave **Automatically expose new tables** on too, or the migration below succeeds
and then every query fails with `permission denied for table entries`, since it contains no
`GRANT` statements. Exposure is not access: RLS is what protects the rows.

### 2. Run the migration

SQL Editor → New query → paste all of [`supabase/migrations/0001_entries.sql`](supabase/migrations/0001_entries.sql)
→ Run. That one file creates the table, the index, RLS, the `own rows` policy and the
`updated_at` trigger.

### 3. Wire up the keys

Project Settings → **API**. Copy the **Project URL** and the **anon / publishable** key —
never the `service_role` key, which bypasses RLS and would ship inside the JS bundle.

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Vite reads env only at startup, so restart the dev server after editing this.

### 4. Allow the auth redirect

Authentication → **URL Configuration**:

- **Site URL**: `http://localhost:5173`
- **Redirect URLs**: `http://localhost:5173/**` and, after deploying, `https://<app>.netlify.app/**`

Login sends `emailRedirectTo: window.location.origin`. If that origin is not allow-listed the
magic link silently bounces to the Site URL and no session is created — with no error shown.

### 5. First login

```bash
npm run dev
```

`signInWithOtp` creates the user on first use, so the first magic link is also the signup.
Open the link in the same browser that requested it. Once you are in, switch off
**Allow new users to sign up** under Authentication → Sign In / Providers — that is what
actually makes this single-user.

## Scripts

```bash
npm run dev        # vite dev server on :5173
npm test           # vitest run — 61 tests, 177 assertions
npm run build      # tsc -b && vite build
npm run preview    # serve dist, the only way to exercise the service worker locally
```

## Syntax

The parser ([`src/lib/parser.ts`](src/lib/parser.ts)) is a pure function, tested before any UI
existed. Order matters: duration is read before amount, or `2h client work` becomes a ₹2 expense.

| Part | Recognised |
| --- | --- |
| Event override | leading `+` |
| Dates | `today`, `yesterday`, `tomorrow`, `3 days ago`, `3d ago`, `next friday`, `sat`, `friday`, `14 nov`, `nov 14`, `14/11`, `14/11/26` |
| Times | `5pm`, `5:30pm`, `17:30`, `9am` |
| Durations | `2h`, `90m`, `2.5h`, `1h30m`, `45 min`, `2 hrs` |
| Amounts | `350`, `₹350`, `rs 350`, `Rs.350`, `350rs`, `100 rupees`, `2,499`, `350.50` |
| Filler stripped | `spent`, `paid`, `bought`, `for`, `on`, `at`, `worked`, `did` |

Rules worth knowing:

- A bare weekday resolves **backwards** to the most recent past occurrence. `next friday` goes forward.
- A future date with no other signal means `event` — you cannot have already spent money tomorrow.
- With no date token, the entry files on **the day you are viewing**, so arrowing back a day and
  typing `500 groceries` backfills correctly.
- `birthday`, `bday` or `anniversary` on an event sets `data.rrule = 'FREQ=YEARLY'`. V1 stores it
  and does nothing with it.
- Nothing recognised at all → `note`, with the input kept untouched as the title.
- Money is an integer number of paise everywhere. ₹347.50 is `34750`. It becomes a string in
  exactly one place, [`src/lib/format.ts`](src/lib/format.ts).
- Local dates only. `toISOString().slice(0, 10)` returns yesterday for the first five and a half
  hours of every IST day, so everything goes through `format(d, 'yyyy-MM-dd')`.

Time ranges (`9-6`, `10 to 6`) are deliberately not parsed. `9h worked` covers the same need.

## Bundle size

Measured with `npm run build`:

| File | Raw | Gzipped |
| --- | --- | --- |
| `assets/index-*.js` | 393.70 kB | **113.59 kB** |
| `assets/index-*.css` | 12.35 kB | 3.44 kB |
| `index.html` | 0.58 kB | 0.34 kB |
| **Total** | | **117.37 kB** |

Against a 150 KB budget. The weight is `@supabase/supabase-js`, which pulls in `auth-js`,
`postgrest-js`, `storage-js`, `realtime-js`, `functions-js` and `phoenix` — only auth and
postgrest are used. If the budget ever gets tight, importing `@supabase/auth-js` and
`@supabase/postgrest-js` directly drops the rest.

Service worker files (`sw.js` 1.39 kB, `workbox-*.js` 14.76 kB) are fetched by the service
worker, not the page, and are not part of the above.

> Measure this **with `.env.local` present**. Without it, `src/lib/supabase.ts` throws at module
> scope, the bundler proves the throw unconditional, and the entire Supabase SDK is tree-shaken
> away — producing a ~49 KB bundle that cannot run.

## Deploy

Netlify, from GitHub — **Add new site → Import an existing project**, pick this repo. Build
settings come from [`netlify.toml`](netlify.toml) (`npm run build` → `dist`), so there is
nothing to fill in. Every push to `main` then deploys itself.

Two steps that are easy to miss, and both fail quietly:

1. Site configuration → **Environment variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`, then **trigger a redeploy**. Vite inlines them at build time, so a
   build that ran without them ships a bundle that throws on load — adding the variables alone
   changes nothing.
2. Supabase → Authentication → URL Configuration: add `https://<app>.netlify.app/**` to
   **Redirect URLs**. Otherwise the magic link bounces to the Site URL and no session is created,
   with no error shown.

`netlify.toml` also pins Node 22 (Vite 8 refuses Node 18) and serves `sw.js` with
`max-age=0, must-revalidate`, without which a cached service worker can stall `autoUpdate` on
an old build. The SPA redirect deliberately omits `force = true` so real files — `sw.js`, the
manifest, the icons — are served directly and only navigations fall through to `index.html`.

[`vercel.json`](vercel.json) is committed as well and does the same rewrite, if this ever moves.

### Install to a phone

Open the production URL in Chrome on Android → menu → **Add to Home screen**. It opens without
browser chrome (`display: standalone`). The service worker uses `registerType: 'autoUpdate'`,
so a new deploy is picked up on next launch.

## Verifying RLS

Querying from the Supabase SQL editor proves nothing — it runs as `postgres` and bypasses RLS.
Impersonate a different user instead:

```sql
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
select count(*) from entries;   -- must be 0
rollback;
```

The anon role is covered too: with only the publishable key, `GET /rest/v1/entries` returns `[]`
and an insert is rejected with `42501 new row violates row-level security policy`.

## Layout

```
src/
  lib/        supabase.ts  parser.ts  parser.test.ts  merchants.ts  format.ts
  hooks/      useEntries.ts  useSession.ts
  components/ Login.tsx  DayHeader.tsx  MonthSheet.tsx  QuickAdd.tsx  EntryRow.tsx  EntryEditor.tsx
  types.ts  App.tsx  main.tsx
supabase/migrations/0001_entries.sql
public/icon-192.png  public/icon-512.png
```

Four kinds, no more: `expense`, `time`, `event`, `note`. Kind-specific extras go in the `data`
jsonb column; anything that gets summed gets a real column. Deletes are soft — `deleted_at` is
set, rows are never removed.

## Deviations from the V1 spec

- **`parse()` takes an optional third argument**, `defaultDay`, so an entry with no date token
  files on the day being viewed. Without it, arrowing back a day and logging there silently saved
  to today, which broke a stated requirement.
- **A month calendar sheet exists.** Requested after the spec was frozen, replacing the invisible
  native `<input type="date">` on the date label. Costs 1.23 KB gzipped.
- **`created_at` is read into the `Entry` type** — untimed entries need a stable tiebreak within a
  day, and the export wants it. It was already a column.
- **`App.tsx` holds an inner `Day` component**, because `useEntries` cannot be called before the
  auth gate returns.

## Not built, on purpose

No AI or LLM calls, no SMS parsing, no notification listeners, no Capacitor or native Android,
no recurring event expansion, no push notifications, no offline sync, no charts, no category
management UI, no search, no tags, no multi-day views, no settings screen.
