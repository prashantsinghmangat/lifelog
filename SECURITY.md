# Security & privacy

What protects the data, what deliberately does not, and how each claim was verified. Facts only —
every item is either in the code, measured on a device, or explicitly labelled a limitation.
Dated measurements are from 2026-10-01 (specs 023–024).

## The threat model, honestly

A single-user app holding one person's money, hours and private notes. The realistic threats are:
someone holding the unlocked phone, a lost device, a leaked Supabase key, and the app's own bugs
silently losing data. Nation-state and malware-on-device threats are out of scope.

## Implemented

### Server side

- **Row-level security is the only thing protecting the data**, since the publishable key ships
  in the JS bundle. One `entries` table, one `own rows` policy
  ([supabase/migrations/0001_entries.sql](supabase/migrations/0001_entries.sql)). Verified: with
  the anon key alone, reads return `[]` and inserts fail `42501`; README's *Verifying RLS* shows
  the impersonation SQL.
- **The app cannot create accounts.** `Login` passes `shouldCreateUser: false`. The project-level
  "Allow new users to sign up" toggle is the third layer and lives outside this repo — see
  *Known gaps*.
- **The nightly backup's token has a strength floor.** `BACKUP_TOKEN` shorter than 32 characters
  is treated as unset (503) by both functions ([netlify/lib/backup.ts](netlify/lib/backup.ts)
  `usableSecret`); the endpoint bypasses RLS via the service-role key, which exists only as a
  Netlify server-side env var and must never carry a `VITE_` prefix.

### Session and sign-out

- **A request with no session is never sent.** `authedFetch` in
  [src/lib/supabase.ts](src/lib/supabase.ts) rejects instead of falling back to the anon key —
  an expired session once produced a verified-empty `200 []` that `reconcile` read as "your log
  is empty" and wiped the device's synced rows. Status 0 now means unreachable, and the local log
  is returned untouched. Verified on the emulator with a revoked refresh token.
- **Sign-out clears the session at rest on every outcome, offline included.** `onSignOut` forgets
  the remembered identity, awaits `reminders.cancelAll()` — entry alarms, follow-ups, both daily
  prompts — then asks Supabase to sign out. The `sb-<ref>-auth-token` key is removed in a
  `finally`, so it goes whether that call resolves cleanly, resolves with an error, or **throws**:
  auth-js clears its own storage only after the server call succeeds, and it rethrows what it does
  not recognise as an auth error, which previously escaped as an unhandled rejection and left the
  identity forgotten but the refresh token live — signed out on screen, signed back in on the next
  launch. The page is reloaded on anything but a clean sign-out, which is what kills the
  in-memory session and the refresh timer that would otherwise write the token straight back.
  Verified on the S21 FE: airplane-mode sign-out, relaunch → signed out, pending alarms 18 → 0;
  all three outcomes are pinned in `App.test.tsx` (*signing out*).
- **An offline token expiry is not a sign-out.** `identity.ts` remembers who the device belongs
  to so the log stays readable on a flight; it grants nothing server-side — every request still
  carries whatever token Supabase has, and a real `SIGNED_OUT` forgets it.

### On the device

- **App Lock (native only).** An OS biometric prompt with device-credential fallback
  (`@aparajita/capacitor-biometric-auth`, weak-biometry + credential) gates the whole app —
  above `Login`, so the remembered email is covered, and identically in guest mode; Supabase is
  never consulted. No biometric data reaches the app, only a result. Timeout Immediately / 1 min
  / 5 min, state in `lifelog.lock`; a cold launch or an expired stamp locks. Android back while
  locked only minimises ([src/lib/back.ts](src/lib/back.ts) short-circuits ahead of the sheet
  stack). On a device with no screen lock the switch stays off — no app-grown passcode.
  [src/lib/applock.ts](src/lib/applock.ts), [src/components/LockScreen.tsx](src/components/LockScreen.tsx).
- **FLAG_SECURE while the lock is on** (`@capacitor/privacy-screen`): the recents thumbnail is
  blank and screenshots are blocked — that cost is stated in the setting's caption. Verified via
  window flags: `fl=SECURE` present exactly while the lock is on.
- **Notification privacy is the OS contract, stated truthfully.** Reminders go out on
  `lifelog-reminders-v2`; Android 16 ignores app-set channel lock-screen visibility (measured:
  every channel lands VISIBILITY_NO_OVERRIDE), so redaction on a secured lock screen is governed
  by the user's own "sensitive notifications" setting — the same contract every app lives under.
  The `-v2` migration deleted the v1 channel and re-armed every alarm onto v2.
- **Android backup and device-to-device transfer are excluded.** `allowBackup="false"` plus
  `dataExtractionRules` excluding cloud backup and D2D transfer — the WebView storage holds a
  live session token and the notification plugin's SharedPreferences persist entry titles, so
  neither may leave the device by that route.
- **The production bundle drops `console.*`.** Rolldown minify config in
  [vite.config.ts](vite.config.ts); direct console calls went 32 → 2 (the two survivors are
  assigned-never-invoked or operational-text indirections), closing the path that printed
  AuthError objects on the refresh-token path.
- **Export and camera temp files are cleaned up.** A shared export is deleted from the app cache
  after the share sheet settles; the camera's temp capture is best-effort deleted after its bytes
  are read ([src/lib/deliver.ts](src/lib/deliver.ts), [src/lib/camera.ts](src/lib/camera.ts)).
- **The photo store cannot be mass-wiped by a bad read.** `sweepOrphans` with an empty live set
  is a no-op — the quota fallback and a parse-failed store both produce one
  ([src/lib/attachments.ts](src/lib/attachments.ts)).
- **A release build refuses a dev server block.** [scripts/gradle.mjs](scripts/gradle.mjs) exits
  before any `*Release*` task if the synced Capacitor config carries `server` — `CAP_DEV_URL`
  left exported can no longer bake `cleartext: true` into a signed APK.

### Data handling

- **Deletes are soft** (`deleted_at`); backups include soft-deleted rows so a backup cannot have
  pre-applied your deletions. Thirty daily snapshots in Netlify Blobs — deliberately not in
  Supabase, which is the thing being backed up.
- **Photos never leave the device.** They live in IndexedDB, outside Supabase, outside the
  nightly backup, outside Android backup. Losing the device loses the photos; the entry rows
  survive on the server.
- **A guest log lives on one device and nothing backs it up.** The honest trade for opening
  straight into the text box; the You screen says so. Export JSON is its only copy.

## Planned / known gaps

- **The Supabase sign-up toggle is the invariant's third layer and is outside this repo.** The
  required state is `disable_signup: true`; it measured `false` on 2026-10-01 while a tester had
  access, and `false` again on 2026-10-02 during the authentication audit. The settings endpoint
  answers it in one line, and needs the key header — without it the reply is only
  `No API key found in request`:

  ```bash
  curl -s "$VITE_SUPABASE_URL/auth/v1/settings" -H "apikey: $VITE_SUPABASE_ANON_KEY"
  ```

  Re-check after letting anyone in. While it is `false`, a pasted sign-in link is the route that
  carries the risk: anyone who can create an account here can obtain a valid magic link for it,
  and the paste route now refuses tokens that are not addressed to this project's own host
  ([src/lib/signinLink.ts](src/lib/signinLink.ts)), which is the half of that this repo can hold.
- **Restore** (spec 025): `backup-restore` reads a named snapshot back through the
  `restore_entries` RPC — `security definer`, executable by `service_role` alone, so the trigger
  bypass it exists for is never reachable from a client key. Same `BACKUP_TOKEN` gate as the
  other two endpoints; the service-role key never leaves the function. The live destructive
  drill is recorded in the spec's Log — until that ran, this entry still read "untested".
- **Backup monitor** (spec 042): a dead-man's switch — the nightly function pings
  healthchecks.io only after a successful snapshot write, so a failed run *or a dead schedule*
  becomes an email within a day. The ping URL is not a secret worth guarding: replaying it can
  only falsely mark a backup healthy, which is why it still lives in an env var, not the repo.
- Not implemented, knowingly: encryption at rest, session/device management, account deletion
  self-service, 2FA, photo namespacing by account, clearing the device log on sign-out (it is
  also the only offline copy).

## Not a security boundary

- **The web/PWA has no lock and never pretends to.** A JS overlay is a courtesy screen; App Lock
  is native-only on purpose.
- **Local data is readable on a rooted/debuggable device.** The log is plaintext `localStorage`,
  photos plaintext IndexedDB; the device lock and App Lock are the protections, not encryption.
- **The client's `shouldCreateUser: false` and RLS do not stop a second user existing** — only
  the project setting above does; RLS merely keeps their rows apart.
- **Sync is last-write-wins per row** across devices. Not a vulnerability — the expected
  behaviour for a single user — but there is no merge and no conflict UI.
