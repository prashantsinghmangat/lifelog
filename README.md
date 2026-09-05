# lifelog

Live: **https://lifelog-timeline.netlify.app** — installable to an Android home screen.

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
- **Redirect URLs**: `http://localhost:5173/**` and `https://lifelog-timeline.netlify.app/**`

Login sends `emailRedirectTo: window.location.origin`. If that origin is not allow-listed the
magic link silently bounces to the Site URL and no session is created — with no error shown.

### 5. Set a password — the route that needs no email

Sign in once with the link or a code, then open the person icon → **Password** → type one →
**Save**. It goes through `updateUser` on the session you already have, which sidesteps the
confirmation email a password signup would normally need.

After that every device signs in with email and password, no message to route, no rate limit, no
deliverability. This is what makes the installed iOS app usable, since a link tapped in Mail
opens in Safari and cannot reach the app's storage.

Everything below is optional: it buys a branded email and a six-digit code, not access.

### 6. Put the code in the email template — needs custom SMTP first

**On the built-in email sender the template editor is read-only.** The banner reads *"Set up
custom SMTP to edit templates"* and the Subject field shows a lock. Supabase then sends its own
default template, which carries only the link and no code — so the code sign-in cannot be
completed, and an installed iOS PWA cannot be signed in at all.

Configuring custom SMTP fixes three things together: templates unlock, the 2/hour cap becomes
30/hour, and Supabase's own footer disappears. Brevo suits a setup with no custom domain, since it
verifies a single sender address.

**Without SMTP the app still works**, because the sign-in screen offers *"No code in the email?
Paste the link instead"*. Press and hold **Sign in** in the email, Copy Link, paste it in. The
token is read out of the URL and verified in the app, which is the only way to sign in an
installed iOS PWA — tapping the link opens Safari, and that has separate storage. Do not open the
link first; it works once.

#### Brevo SMTP, for a setup with no custom domain

Brevo is free to 300 emails a day and will verify a single sender address, so no domain is
needed.

1. Sign up at brevo.com and confirm the account email.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender.** Name `lifelog`, your own email
   address, then click the link Brevo sends. Without a domain this is the only address that can
   appear in the From field, and Brevo rejects anything else with a 550.
3. **SMTP & API → SMTP.** Note the login and generate an **SMTP key**. The key is the password —
   not the Brevo account password. If Supabase later reports an auth failure, regenerate the
   login and key: Brevo sometimes shows the account email where it wants
   `something@smtp-brevo.com`.
4. Supabase → Authentication → Emails → **SMTP Settings** → enable custom SMTP:

   | Field | Value |
   | --- | --- |
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` |
   | Username | the Brevo SMTP login |
   | Password | the Brevo SMTP key |
   | Sender email | the address verified in step 2 |
   | Sender name | `lifelog` |

5. Authentication → **Rate Limits** — the default becomes 30 emails/hour, which is ample.

Mail from a brand-new Brevo account can land in spam or Promotions the first time. Check those
folders before assuming it did not send.

#### Or Gmail, with no new account

Custom SMTP does not have to mean a new provider — `smtp.gmail.com` on port 465 or 587, username
and sender both your own Gmail address, password a 16-character **App Password** from
myaccount.google.com/apppasswords. That page needs 2-Step Verification enabled. It unlocks
template editing identically.

Fine for one recipient and a few messages a day, wrong for a real product: Gmail is a personal
mailbox, not a transactional sender, and caps at roughly 500 a day.

Then, Authentication → Emails → **Magic link or OTP**. The default only contains
`{{ .ConfirmationURL }}`; add the code as well:

```html
<p>Your code: <strong>{{ .Token }}</strong></p>
<p>Or <a href="{{ .ConfirmationURL }}">open this link</a>.</p>
```

The repo keeps a ready version at
[`supabase/templates/magic-link.html`](supabase/templates/magic-link.html). Paste it into
**Confirm signup** too: `signInWithOtp` uses Magic Link for an existing user but Confirm signup
for one that does not exist yet, and each template saves separately.

Note the built-in email service allows **2 messages per hour for the whole project**. Testing runs
into that quickly; the app then shows `email rate limit exceeded`. Custom SMTP raises the default
to 30/hour.

Without `{{ .Token }}` the email carries no code and the sign-in screen cannot be completed on
iOS. A link tapped in Mail opens in Safari, and an installed PWA has its own storage, so the app
itself would stay signed out with no way to fix it. A code typed into the app creates the session
in the app.

### 7. First login

```bash
npm run dev
```

`signInWithOtp` creates the user on first use, so the first sign-in is also the signup. Once you
are in, switch off **Allow new users to sign up** under Authentication → Sign In / Providers —
that is what actually makes this single-user.

## Scripts

```bash
npm run dev        # vite dev server on :5173
npm test           # vitest run — 199 tests
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
| Durations | `2h`, `90m`, `2.5h`, `1h30m`, `2h30`, `45 min`, `2 hrs` |
| Amounts | `350`, `₹350`, `rs 350`, `Rs.350`, `350rs`, `100 rupees`, `2,499`, `350.50` |
| Filler stripped | `spent`, `paid`, `bought`, `for`, `on`, `at`, `worked`, `did` |

Rules worth knowing:

- A bare weekday resolves **backwards** to the most recent past occurrence. `next friday` goes forward.
- Anything still ahead with no other signal means `event` — you cannot have already spent money
  tomorrow, nor done something at 8:15pm while it is 8:10pm. So `ping 8:15pm` is a reminder in the
  evening but a note the next morning, and `+` is only needed for an event whose time has passed
  or that has no time at all.
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

## The Android app

Capacitor wraps the same build. There is no second codebase: `android/` is a generated native
shell that loads `dist/`, so the web app and the Android app are the same React, the same parser
and the same Supabase calls.

**One-off setup.** What is required is the Android SDK and a **JDK 17 or newer** — Gradle 8.14
rejects Java 11. Android Studio is only a convenient bundle of those two and is not needed: every
line of real code here is TypeScript, so the IDE would rarely be opened.

*Either* install Android Studio and let its Standard setup fetch everything, *or* take the
command-line route and stay in VS Code:

```powershell
winget install Microsoft.OpenJDK.21

# Command line tools only, from developer.android.com/studio
# The zip's *contents* go into cmdline-tools\latest\, so that
# C:\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat exists.
# Getting that nesting wrong is what produces "Could not determine SDK root".

$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21'   # match the real folder name
$env:ANDROID_HOME = 'C:\Android\Sdk'
$sdk = "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
& $sdk --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
& $sdk --licenses
```

Persist `ANDROID_HOME` and add `%ANDROID_HOME%\platform-tools` to PATH for `adb`. Prefer setting
`JAVA_HOME` per session rather than globally if other projects on the machine need an older JDK.

Then enable Developer options and USB debugging on the phone.

```bash
npm run android         # build the web app, then copy it into the native project
npm run android:open    # open android/ in Android Studio, then press Run
```

Or from the command line, once the SDK is in place. On Windows this is `gradlew.bat`, and
`JAVA_HOME` must point at a JDK 17+ — Android Studio ships one at
`C:\Program Files\Android\Android Studio\jbr`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
cd android; .\gradlew.bat assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Testing on a device without reinstalling

Two things worth setting up once. Together they mean the APK is rarely rebuilt at all.

**Wireless adb**, so no cable and no copying files around. On the phone: Developer options →
**Wireless debugging** → *Pair device with pairing code*.

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb pair 192.168.0.50:41234        # the pairing dialog's ip:port, then the 6-digit code
& $adb connect 192.168.0.50:5555      # the ip:port from the Wireless debugging screen
& $adb devices
```

Then `cd android; .\gradlew.bat installDebug` builds and installs in one step, and
`& $adb logcat -s Capacitor:V chromium:V` streams the device's console.

**Live reload**, which removes the rebuild entirely. `CAP_DEV_URL` points the installed app at
the Vite dev server instead of its bundled assets:

```powershell
npm run dev:host                                     # terminal 1, binds 0.0.0.0
$env:CAP_DEV_URL = 'http://192.168.0.194:5173'       # terminal 2, your LAN IP
npm run android                                      # then reinstall once
```

After that, every edit appears on the phone immediately. Unset `CAP_DEV_URL` and re-run
`npm run android` to go back to a standalone build. It is an environment variable rather than an
edited-in URL deliberately: a hardcoded `server` block is the classic way to ship an APK that
only works on the network it was built on.

Windows Firewall blocks inbound 5173 by default, so the phone cannot reach the dev server until
this is allowed once, from an **admin** terminal:

```powershell
New-NetFirewallRule -DisplayName "Vite dev server" -Direction Inbound `
  -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
```

If the phone still cannot load it, check that the Wi-Fi network is marked **Private** rather than
Public in Windows, and that both devices are on the same subnet — a guest network will not work.

**`npm run android` before every device test.** The web assets are copied into the native project
at sync time, so a change that is not built and synced is a change the phone will not see.

`appId` is `com.prashant.lifelog`, `minSdk` 24, `compileSdk` 36. Build output, `local.properties`
and the copied web assets are gitignored; the rest of `android/` is committed, because it holds
the manifest and Gradle config that the app actually needs.

Nothing about the web target changed: `@capacitor/core` only reaches the browser bundle if
application code imports it, and the shell alone imports nothing.

## Asking

A leading `?` turns the same box into a question, the way a leading `+` forces an event. The
answer appears in the preview line **as you type** — nothing to submit, no screen to leave.

```
? when is deepak birthday              Saturday 13 February 2027 · in 161 days
? gym                                  14 entries · 11 days · 12h · last today
? how many days gym                    11 days · 12h · last today
? how many days deepak kiran store     6 days · ₹1,240 · last yesterday
? how much on swiggy last month        ₹3,480 · 9 entries · last 28 Aug
? hours worked this week               18h 30m · 12 entries
```

Every term must match, so `deepak kiran store` will not answer for a different Deepak. Titles,
categories and kinds are all searched. Periods understood: `today`, `yesterday`, `this week`,
`last week`, `this month`, `last month`, `this year`, `last N days`, `last N months`, and a bare
month name, which means the most recent one already begun.

**Anything upcoming answers with a date rather than a tally**, whether or not the question
remembered to say "when". A birthday carries `FREQ=YEARLY`, so one logged on 13 February answers
with next February once this one has passed — the date on the row would be the wrong answer for
most of the year.

A question the grammar does not recognise still answers with counts rather than an apology, and
`?` on its own summarises everything.

No AI is involved — it is arithmetic over rows, which is why the answers can be tested exactly
([`query.test.ts`](src/lib/query.test.ts)).

## Reminders

**In the Android app**, lifelog raises its own notification, scheduled on the device: no server,
no push, and it fires with the app closed, offline, and the Supabase project asleep.

```
ping me in 2 minutes        in 5 minutes / after 30 minutes / 10 mins from now
dentist tomorrow 5pm        at the event
+ Mom birthday 14 nov       9am on the day, every year
```

The toast confirms with the actual time — *"Reminder set for 12:04 pm"*. Reminders are cancelled
when an entry is deleted, re-armed when it is edited, and re-armed for everything upcoming on
launch, so an event logged on the web still fires on the phone.

Android grants notification permission per install, so a reinstall revokes it; the app asks again
above the timeline. **Allow "Alarms and reminders"** too (Settings → Apps → lifelog), or Android
downgrades the alarm to inexact and it can land minutes late. The profile sheet has a test
reminder that fires in ten seconds and reports its own outcome.

**On the web** none of this is possible — no shipped API raises a notification while the app is
closed — so the calendar takes over instead.

The operating system does the reminding. No web API raises a notification while the app is
closed — `setTimeout` dies with the tab, and Chrome's Notification Triggers API never shipped — so
a real reminder would need a server pushing at the right moment. A calendar alarm instead keeps
working with the app shut, the phone offline and the Supabase project paused, and needs no
notification permission.

Log an event and the toast offers **Add to calendar**. Any event can be added later from its
entry sheet, and **Send events to calendar** in the profile sheet exports everything upcoming at
once. On a phone this opens the share sheet, so the file goes straight to Calendar; on a desktop
it downloads.

- A timed event alarms at the event: `dentist tomorrow 5pm` fires at 5pm
- An all-day event alarms at **9am** on the day
- `birthday`, `bday` or `anniversary` repeat yearly, which is what `data.rrule` was always for

The alarm on an all-day event is a *relative* trigger nine hours after local midnight, so it is
9am in any timezone and stays correct every year. That is why no timezone is stored anywhere.

**The calendar receives a copy.** Editing or deleting the entry afterwards does not change it; it
has to be added again. That is the cost of having no backend.

## Backups

A Netlify scheduled function copies every row nightly to Netlify Blobs — somewhere that is *not*
Supabase, because a dump written back into Supabase shares the fate of the thing it is backing up.
The free tier pauses after seven days idle and has no point-in-time recovery, so the manual JSON
export was the only copy.

Soft-deleted rows are included: a backup that has already applied your deletions cannot undo them.
Thirty daily snapshots are kept, and the read is paged, because PostgREST caps a response at 1000
rows and a backup that silently truncates is the worst kind.

**Two environment variables**, in Netlify → Site configuration → Environment variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` |
| `BACKUP_TOKEN` | a long random string you invent |
| `SUPABASE_URL` | optional — falls back to `VITE_SUPABASE_URL`, which is already set for the build |

Make `BACKUP_TOKEN` URL-safe. A base64 token containing `+` breaks when passed in a query
string, because `+` decodes as a space and the comparison then fails for no visible reason. Hex,
or base64 with `+` and `/` swapped out, avoids the trap.

⚠️ The **service_role key bypasses RLS entirely**. It belongs only here, in a server-side
environment variable — never in `.env.local`, never in anything with a `VITE_` prefix, since
those are inlined into the browser bundle.

Getting the data back:

```
/.netlify/functions/backups?token=…                          list snapshots
/.netlify/functions/backups?token=…&key=entries-2026-09-05.json   download one
```

That endpoint returns every row and bypasses RLS, which is why it is guarded by `BACKUP_TOKEN`
and refuses to run at all when the variable is unset, rather than defaulting to open.

Run it once by hand after deploying, rather than waiting a day to discover a missing variable — a
scheduled function cannot be invoked over HTTP, so there is a separate trigger:

```
/.netlify/functions/backup-run?token=…    → {"snapshot":"entries-2026-09-05.json","rows":42,"pruned":0}
```

It reports failures rather than swallowing them, which is the point: seeing `SUPABASE_SERVICE_ROLE_KEY
is not set` immediately beats finding no snapshot tomorrow.

Note that environment variables reach a deployed function only on the **next deploy**. Editing
them and expecting the running function to notice is the usual first mistake.

## Bundle size

Measured with `npm run build`:

| File | Raw | Gzipped |
| --- | --- | --- |
| `assets/index-*.js` | 412.34 kB | **119.17 kB** |
| `assets/index-*.css` | 15.92 kB | 4.40 kB |
| `index.html` | 0.85 kB | 0.47 kB |
| **Total** | | **124.04 kB** |

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
2. Supabase → Authentication → URL Configuration: add `https://lifelog-timeline.netlify.app/**`
   to **Redirect URLs**. Otherwise the magic link bounces to the Site URL and no session is
   created, with no error shown.

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
  hooks/      useEntries.ts  useSession.ts  useTheme.ts  useSwipe.ts  useDictation.ts
  components/ Login.tsx  DayHeader.tsx  MonthGrid.tsx  MonthSheet.tsx
              ProfileSheet.tsx  QuickAdd.tsx  EntryRow.tsx  EntryEditor.tsx
              Sheet.tsx  Toast.tsx  Icons.tsx
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
- **There is a settings surface after all** — a profile sheet with theme (System / Light / Dark),
  Export JSON and Sign out. Dark mode needs somewhere to live, and the footer was already carrying
  export and sign-out.
- **Swipe left or right** changes day, alongside the arrows. Ignores gestures that start on a
  field, inside an open sheet, or within 24px of a screen edge, where Android's back gesture lives.
- **Dictation** via the Web Speech API. Unsupported in iOS Safari, where the mic button is hidden.

## Not built, on purpose

No AI or LLM calls, no SMS parsing, no notification listeners, no Capacitor or native Android,
no recurring event expansion, no push notifications, no offline sync, no charts, no category
management UI, no search, no tags, no multi-day views, no settings screen.
