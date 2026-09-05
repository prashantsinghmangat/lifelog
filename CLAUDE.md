# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run android                    # build, then copy the web assets into android/
npm run android:open               # open the native project in Android Studio
npm run dev                        # vite dev server on :5173
npm test                           # vitest run (86 tests, 223 assertions)
npm run test:watch                 # vitest watch
npx vitest run -t "yesterday"      # tests whose name matches a substring (2 of 86)
npx tsc -b                         # typecheck only (add --force to ignore the build cache)
npm run build                      # tsc -b && vite build
npm run preview                    # serve dist — the only way to exercise the service worker locally
```

There is no linter and no formatter. `tsc -b` is the gate.

## What this is

A single-user life log. Expenses, work hours, events and notes are one thing: something that
happened, or will happen, on a date. **One table, one screen, one text box.** The entire value is
that logging takes under five seconds, so anything that adds a step to logging is a regression.

Live at https://lifelog-timeline.netlify.app, auto-deployed from `main`.

## Architecture

**`src/lib/parser.ts` is the core of the app.** Everything else is plumbing around it. It is a
pure function — it imports nothing from React, Supabase or anything stateful, and never calls
`new Date()`. `now` is injected so tests are deterministic.

```ts
parse(input: string, now: Date, defaultDay?: string): ParsedEntry | null
```

Its order of operations is load-bearing and documented in the function: leading `+` → date →
clock time → **duration → amount** → infer `event` from anything still ahead → strip filler
words → title. That inference covers both a future date and a clock time later today, which is
what makes `ping 8:15pm` a reminder without a leading `+`; it runs *after* amount, so
`500 dinner 9pm` stays an expense. Duration must be read before amount, or `2h client work` becomes a ₹2 expense. Once a
duration has matched, only a *currency-marked* amount is accepted, which is why
`2h call with agency 99` keeps the `99` in its title. Reordering these breaks tests in ways that
look unrelated to the change.

`defaultDay` is the day the entry lands on when no date token is typed. `QuickAdd` passes the
day being viewed, so arrowing back a day and typing `500 groceries` backfills correctly. Relative
words (`yesterday`, `next friday`) still resolve against `now`, never against `defaultDay`.

**`src/hooks/useEntries.ts` owns every Supabase call.** Components never touch the client
directly (except `Login`/`App` for auth). Writes are optimistic: a row enters local state
synchronously with a `crypto.randomUUID()` id, then persists. Each write registers its own retry
closure in a ref map keyed by row id, so `retry(row)` replays whichever operation failed —
insert, update or soft delete — with no branching at the call site. `failedElsewhere` surfaces
failed writes belonging to *other* days, which would otherwise be invisible after a backfill.
The refetch on day change deliberately preserves rows whose writes are still unresolved.

**`src/App.tsx`** holds an inner `Day` component because `useEntries` cannot be called before the
auth gate returns. `now` lives in state and refreshes on `focus`/`visibilitychange`, otherwise a
tab left open overnight keeps parsing `today` as yesterday.

**`src/lib/format.ts`** is the only place money becomes a string, and the only place dates become
`yyyy-MM-dd`.

**`android/` is a generated Capacitor shell around the same `dist/`, not a second codebase.** The
web app and the Android app are the same React, parser and Supabase calls. Web assets are copied
in at `cap sync`, so `npm run android` must run before every device test or the phone shows stale
code. Editing files under `android/` by hand is almost always wrong — the exception is the
manifest and Gradle config, which are committed for that reason.

**Reminders exist twice, because the two platforms can do different things.**
`src/lib/reminders.ts` schedules a real notification on the device through
`@capacitor/local-notifications` — native only, and better than anything the web offers: no
server, no push, fires with the app closed and the Supabase project paused. On the web there is no
such option, so `ics.ts` hands the event to the OS calendar instead. `App` offers whichever
applies: natively the reminder is already set, so pushing "Add to calendar" there would be asking
for a step the app just took.

**Never return a Capacitor plugin from an `async` function.** Resolving an async return value
reads `.then` to test whether it is thenable, and the plugin proxy forwards *every* property
access to native as a method call — so returning it invents a native method named `then` and the
promise rejects with `"LocalNotifications.then()" is not implemented on android`. This took out
permission checks, scheduling, cancelling and syncing at once, silently, and cost hours. `plugin()`
therefore returns `{ api }`; the wrapper is load-bearing.

**A silent reminder is worse than a broken one.** Every path through `reminders.ts` reports an
outcome (`scheduled` / `blocked` / `skipped`) or a caught message, because three separate bugs here
were invisible for exactly as long as their promises rejected into nothing.

**`src/lib/ics.ts`** is the web's answer: the OS calendar raises the alarm, because no
web API can while the app is closed. Pure and `now`-injected like the parser, so it is tested
rather than hoped at. An all-day alarm is a *relative* trigger (`PT9H` past local midnight), which
is why nothing stores a timezone — change that to an absolute time and yearly birthdays break in
every timezone but one. `src/lib/deliver.ts` prefers the share sheet over a download, since
downloads are unreliable inside a standalone iOS PWA.

**Colour never appears as a raw grey.** `src/index.css` defines semantic tokens — `surface`,
`raised`, `sunken`, `ink`, `muted`, `faint`, `line`, `edge`, `focus`, plus the four kind colours —
and a `[data-theme='dark']` block swaps their values. Components write `text-muted`, `bg-raised`,
`border-line`. **Do not add `dark:` variants**; the token swap covers both themes, so a new
`text-gray-500` is a bug that will look fine in light mode and unreadable in dark. A third theme
would be one more block and no component changes. `useTheme` resolves `system` against
`prefers-color-scheme` and stamps `data-theme` on `<html>`.

**Tailwind classes are never interpolated.** ``className={`text-${kind}`}`` compiles to nothing,
because Tailwind only emits classes it can literally see. Kind colours go through written-out
`Record<Kind, string>` maps.

## UX rules that are architecture, not taste

**Minimum interaction → maximum outcome.** Before adding a control, ask whether a default can
remove it. Capture is the product: anything that adds a step to logging is a regression.

**One component tree, three layouts.** Breakpoints are compact (`<640`), medium, wide (`lg`,
`≥1024`) — never device-specific. **Never create `MobileX.tsx` / `DesktopX.tsx`.** Where the
interaction genuinely differs, one component changes presentation: `Sheet` is a bottom sheet on
compact and a centred dialog from `sm` up. `MonthGrid` is the calendar; `MonthSheet` is that same
grid in a `Sheet` for narrow screens, while the wide layout renders `MonthGrid` straight into the
sidebar where navigation costs no taps at all.

**`Sheet` owns modal correctness** — focus moves in, is trapped, and returns to the trigger on
close; Escape closes; body scroll locks. Any new modal goes through it rather than reimplementing
an overlay.

**Undo, not confirmation.** Reversible actions happen immediately and offer `Undo` in the toast
(`useEntries.restore` clears `deleted_at`). Do not add "are you sure?" to a normal delete.

**Accessibility is a build requirement.** Interactive targets are 44px (`h-11`), focus is a single
global `:focus-visible` outline so no component can forget it, `prefers-reduced-motion` is honoured
globally, and meaning is never carried by colour alone — the kind icon is `aria-hidden` and an
`sr-only` kind name sits beside it.

## Data model

One table, `entries` ([supabase/migrations/0001_entries.sql](supabase/migrations/0001_entries.sql)).
Four kinds — `expense`, `time`, `event`, `note`. Do not add a fifth.

- **`amount_paise` is an integer. Money is never a float anywhere.** ₹347.50 is `34750`.
- **`occurred_on`** (a local date) is what everything queries and groups by.
- **`occurred_at`** is optional, used only to sort within a day and show a clock time.
- **Deletes are soft** — set `deleted_at`, never `DELETE`. Every read filters `deleted_at is null`.
- Kind-specific extras (merchant, project, payment method) go in the `data` jsonb column.
  Anything that gets summed gets a real column.
- RLS is the only thing protecting the data, since the publishable key ships in the bundle.
  Verified: with the anon key, reads return `[]` and inserts fail `42501`.

`data.rrule = 'FREQ=YEARLY'` is set for birthday/anniversary events and currently does nothing.

## Traps

These cost real time to discover. None are visible from reading a single file.

**Bundle size must be measured with `.env.local` present.** Without it,
[src/lib/supabase.ts](src/lib/supabase.ts) throws at module scope, the bundler proves the throw
unconditional and tree-shakes the entire Supabase SDK away — producing a ~49 KB bundle that
cannot run. The honest figure is ~117 KB gzipped against a 150 KB budget.

**Never `toISOString().slice(0, 10)`.** In IST that returns yesterday's date for the first five
and a half hours of every day. Use `dayKey()` / `format(d, 'yyyy-MM-dd')`.

**Tailwind's automatic content detection is switched off.** `src/index.css` uses
`@import 'tailwindcss' source(none)` plus `@source './**/*.tsx'`. Without the pin, Tailwind
scanned the README and test files, so editing prose changed the CSS bundle. Classes written
anywhere other than a `.tsx` file will not be compiled.

**Env vars are inlined at build time.** Changing them on Netlify does nothing until a redeploy.

**Supabase auth needs the origin allow-listed.** `Login` sends
`emailRedirectTo: window.location.origin`; an origin missing from Authentication → URL
Configuration makes the magic link bounce with no error shown anywhere.

**`Login` has three routes in and each covers a hole in the others. Do not "simplify" any away.**

- **Password** is the default and the only route that touches no email. Normally unusable here,
  because creating a password account needs a confirmation email this project cannot send — so
  the password is set instead from `ProfileSheet` via `updateUser`, from inside a session that
  already exists.
- **Six-digit code** needs `{{ .Token }}` in the email template, which requires custom SMTP:
  Supabase locked template editing for free projects created after 3 June 2026.
- **Paste the sign-in link** works with the default template as it ships.
  `src/lib/signinLink.ts` pulls the token out of whatever was pasted (tested — note `access_token`
  must not match, and Gmail percent-encodes wrapped URLs).

The last two exist because a link tapped in Mail opens in Safari, and an installed iOS PWA has
separate storage, so a tapped link can never sign in the app itself.

**The git remote uses an SSH host alias**, `git@github-personal:...`. The machine's default key
belongs to a different GitHub account and a plain `github.com` URL is rejected. `gh` is logged
into both accounts with the wrong one active.

**Commits carry no `Co-Authored-By` or "generated with" trailers.** Author is the repo owner only.

## Code standards

TypeScript strict with `noUncheckedIndexedAccess`. No `any`, no non-null assertions. Flat file
layout — no barrel files, no `index.ts` re-exports, no directory per component.

**The runtime dependency list is `react`, `react-dom`, `@supabase/supabase-js`, `date-fns` and
Capacitor. Ask before adding anything else.** The original "four dependencies only" rule was
retired deliberately when the Android app was added, not broken by accident: Capacitor plugins
are runtime dependencies. The bar is unchanged for everything else — no component library, no
state manager, no data-fetching library, no icon package. No component library, no state manager, no data-fetching library, no icon package;
icons are inline SVG. Comments only where the *why* is unobvious. Plain, dense, fast UI: system
fonts, one 100ms fade on new rows, nothing else animated.

## Deliberately not built

No AI or LLM calls, no SMS parsing, no notification listeners, no Capacitor or native Android, no
recurring event expansion, no push notifications, no offline sync (the service worker precaches
the app shell only — **never cache API responses**), no charts, no category management UI, no
search, no tags, no multi-day views. Time ranges (`9-6`, `10 to 6`) are explicitly out of the
parser; `9h worked` covers the same need.

Added after the spec froze, on the owner's request: the month calendar sheet (replacing an
invisible native date input), a **profile sheet** holding theme, export and sign out — which is
the settings screen the spec said not to build — swipe-to-change-day, and dictation. The
deviations are listed at the end of [README.md](README.md).

## Known rough edges

- A submit that lands on another day gives no confirmation — the row just vanishes from the
  current view. This is the app's one genuine source of confusion.
- The filler-word list is exactly `spent, paid, bought, for, on, at, worked, did`, so `to` in
  `20000 to neha` survives into the title.
- Supabase's free tier pauses a project after 7 days idle; unpausing is manual.
- Dictation uses the Web Speech API, which iOS Safari does not implement. `useDictation` reports
  `supported: false` there and `QuickAdd` hides the mic rather than offering a dead button.
- The session lives in `localStorage`, so it is per-browser. Opening the magic link in a different
  browser than the one that requested it leaves the original signed out. This is not a bug.
