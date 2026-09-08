# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run android                    # build, then copy the web assets into android/
npm run android:open               # open the native project in Android Studio
npm run dev                        # vite dev server on :5173
npm test                           # vitest run (365 tests)
npm run test:watch                 # vitest watch
npx vitest run -t "yesterday"      # tests whose name matches a substring (4 of 365)
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

**A written date takes an optional four-digit year, and it must begin 19 or 20.** Without the
year `anniversary 12 sep 2025` filed to *this* September and left the `2025` behind to be read as
₹2,025 — wrong day, invented amount, and nothing on screen said so. The narrow year pattern is
what keeps `12 sep 1200` reading the 1200 as the number it plainly is. The slash forms already
handled a year; only the month-name forms did not.

**Relative times are also said, not only counted:** `in an hour`, `in half an hour`, `in a
minute`, `an hour from now`. These fell through to a *note* — a reminder that silently was not
one, which is the worst thing this parser can produce. `half` is matched before `an`, or
`half an hour` matches the `an hour` pattern and leaves `half` in the title. The unit letters are
single characters, so the trailing `\b` is load-bearing: without it `in a house`, `after a hard
day` and `meeting in a moment` all become reminders. Durations are deliberately *not* extended
this way — `45 min gym` is a time log, and `half an hour of yoga` is still a note.

**`src/lib/store.ts` is the log; the server is a copy of it.** This is the offline story, and it
is the app's actual position rather than a fallback: nothing about parsing an entry, showing a
day, totalling it, answering a question or raising a reminder needs a network, so none of it
waits for one. Writes land in `localStorage` synchronously and durably, then sync when they can.

**A pending write is a desired end state, not an operation.** The obvious design — a FIFO queue of
insert / update / delete — must replay in order, and every failure raises the question of what the
rest of the queue now means: an `update ... eq(id)` replayed before its insert lands matches no
rows and reports no error, losing an entry in silence. Instead each dirty row carries its full
current state including `deleted_at`, and syncing is **one idempotent upsert per row**. Order stops
mattering, a row edited five times offline is one write, and a failure affects only that row.
The cost is last-write-wins per row across devices, which for a single-user log is the expected
behaviour rather than a compromise. `queued_at` exists so `settle` can tell an acknowledgement
apart from one describing a version the row has already moved past.

**`src/hooks/useEntries.ts` owns every Supabase call** and is the only writer of the store.
Components never touch the client directly (except `Login`/`App` for auth). Rows enter local
state synchronously with a `crypto.randomUUID()` id. Reads *fold into* the local log rather than
replacing it, so a day already seen stays readable with no network — and since launch fetches
everything anyway to re-arm reminders, one online launch makes the whole log readable offline.
`fetchAll` and `fetchDays` fall back to that copy, which is what keeps questions, memories,
the export and the calendar dots working. Sync is woken by launch, `focus`/`visibilitychange`,
the `online` event, and — the one that actually does the work on Android — a 30-second retry
armed only while something is owed. See the offline traps below for why the event cannot be
trusted to fire.

**The state is a mirror of a ref, not the other way round.** `apply` advances both together
because `write` has to attempt a sync in the same tick, before React has re-rendered; reading
state there reads the log as it was before the entry existed and sends nothing.

**`queued` is not a failure.** A write waiting for a network is durable and going to land, so it
says so quietly; only a server that *answered and refused* is a failure worth a Retry chip.
Conflating the two put a red Retry on every entry logged on a train. Same distinction for a
delete: a refused one puts the row back, because claiming it is gone when it is not is a lie the
next full read undoes, while a queued one stays gone because it is going to land.
`failedElsewhere` surfaces refusals belonging to *other* days, invisible after a backfill.

**`src/lib/identity.ts` is why the auth gate does not lock you out of your own offline log.**
Supabase access tokens last an hour. Log entries in airplane mode, come back more than an hour
later, and `getSession()` cannot refresh — it returns null, and the sign-in screen appears in
front of a log that is sitting on the device, intact and unsynced. Verified on the emulator, and
it is what a flight looks like rather than an edge case. So `useSession` returns an **identity**,
not a session: a live session provides one, and a remembered one answers when there is no
network. It grants nothing on the server — every request still carries whatever token Supabase
has and RLS still decides what comes back — and `SIGNED_OUT` forgets it, so a genuinely revoked
refresh token signs the user out as soon as there is a network to discover that on. Only an
actual sign-out forgets; a *failed refresh* also arrives with a null session, and treating that
as a sign-out is the entire bug. `useSession` also starts from the remembered identity rather
than waiting on `getSession()`, which offline retries for around twenty seconds — the app used
to sit on a bare "…" for all of it.

**`src/App.tsx`** holds an inner `Day` component because `useEntries` cannot be called before the
auth gate returns. `now` lives in state and refreshes on `focus`/`visibilitychange`, otherwise a
tab left open overnight keeps parsing `today` as yesterday.

**`src/lib/format.ts`** is the only place money becomes a string, and the only place dates become
`yyyy-MM-dd`.

**`src/lib/query.ts` answers questions, and returns parts rather than a sentence.** `answer()`
gives the caption, the lead, the extras and every matching row; `AnswerCard` lays those out and
`phrase()` joins the same parts into the one line the live region announces. Build the sentence
independently and it will eventually say something the card does not show. The rows are ordered
by *next* occurrence for a date answer and by recency for everything else, which is the whole
reason "when is deepak birthday" leads with next February rather than the row from seven months
ago.

An extra is `{ label, value }`, not a string, so `avg` and `first` read as named numbers in a
column rather than as prose; a null label is for the facts that name themselves. **`grouped` is
the answer's own decision, not the card's.** Rows in day order let each date become a heading
over the rows beneath it, which is what stopped `Aug 20` from being the loudest thing on four
separate rows. It is *not* the same as `!oneDay`: a date answer is ordered by next occurrence, so
a yearly birthday logged in 2010 sorts first while its date sorts last — group that and the same
heading appears twice. Those answers carry the date on the row instead. There is one answer
renderer and there should stay one; five would be five things `phrase()` does not know about.

**`src/lib/history.ts` is the look-back layer, and it costs no query.** `onThisDay()` filters the
corpus `App` already fetches on launch to re-arm reminders — that result used to be discarded.
Held in its own state rather than in `corpus`, deliberately: `corpus` is dropped on every write
so an answer is never computed from a stale log, while a memory of an earlier year cannot be
made stale by anything typed today. Days are matched on month and day *as text*, so 29 February
only ever recalls another 29 February rather than quietly answering with the 28th.
`byClock` lives here and is shared with `useEntries`, so a day recalled from last year lists its
entries in the same order the timeline would.

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

**Component tests cover journeys, not rendering.** `*.test.tsx` files carry
`// @vitest-environment jsdom` at the top rather than a config file, and assert with plain DOM
reads instead of `jest-dom`. They exist because every recent bug was in wiring — the send key that
only dismissed the keyboard, a question filed away as a note — while the pure libraries with far
more tests produced almost none. A new test here should describe something a user does that could
silently go wrong, not that a component renders.

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
sidebar where navigation costs no taps at all. `WeekStrip` is `lg:hidden` for that reason — on a
wide screen it would repeat what the sidebar already shows.

**Every date grid draws the same cell.** `DayCell` owns what selected, today and has-entries look
like, and `WEEK_STARTS` is the one place the week begins on Monday; `useMarkedDays` is the one
place dots are loaded. Two grids disagreeing about which day starts the week is a bug you can see
from across the room, and it is exactly the kind that arrives by copy-paste.

**Every row draws the same way, wherever it appears.** Title on top; clock, category and anything
else secondary on a quieter line beneath; the one number — money if the row has any, otherwise
duration — right-aligned and `tabular-nums`. That number comes from `rowValue` in `format.ts`,
which used to be three copies of the same four lines in `EntryRow`, `AnswerCard` and a toast.
**`occurred_at` is optional, so a left-hand time gutter is not an option**: most rows have no
clock, and a column that is empty on most rows is a 56px indent that buys nothing. `AnswerCard`
had already discovered this and collapsed the column; the timeline's secondary line is the
version that survived.

**A summary goes under what it summarises.** The day's totals sit below the last row, where the
row's own border is the rule above them. Above the capture box they read as a label for what you
are about to type instead of a summary of what you have just read.

**`Sheet` owns modal correctness** — focus moves in, is trapped, and returns to the trigger on
close; Escape closes; body scroll locks. Any new modal goes through it rather than reimplementing
an overlay.

**Undo, not confirmation.** Reversible actions happen immediately and offer `Undo` in the toast
(`useEntries.restore` clears `deleted_at`). Do not add "are you sure?" to a normal delete.

**A toast has three ways out and two lifetimes.** Close button, sideways swipe, or the timer —
waiting used to be the only one, which made a six-second message feel like being stuck with it.
A toast carrying an action lives twice as long as one that only reports, because Undo has to be
noticed and decided on while "Reminder set for 5:00 pm" only has to be read.

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
cannot run. The honest figure is ~130 KB gzipped against a 150 KB budget.

**Every column of `Entry` must stay in `COLUMNS`.** A write is a full-row upsert now, so a column
that is read into the type but missing from the select would be sent back as `undefined` and
nulled on the server. The two lists are the same list; they only look independent.

**Three offline traps, all found on the emulator and none of them visible from the unit tests,
which were simulating the wrong failure the whole time.** Together they are why reachability is
*observed* rather than asked about.

**`navigator.onLine` lies on Android, and nothing may be shown from it.** With airplane mode on
and `ping` failing, the WebView still reports `onLine === true`. Trusting it labelled every
unsent row `failed` with a red Retry chip, on the exact platform the offline story exists for,
and the offline notice never appeared. It never reports coming *back* either, so the `online`
event cannot be relied on to fire at all — hence the 30-second retry while anything is owed,
which is what actually recovers a write. `useOnline` survives only as one more wake-up trigger.

**A failed fetch does not reject; it returns `status: 0`.** postgrest-js catches the fetch and
hands back an ordinary error result, so the `catch` meant to notice never ran and
`TypeError: Failed to fetch` went on screen as though the server had refused something. `status`
is the discriminator: an HTTP status is proof the server answered, its absence proof it did not.
That distinction is the whole difference between `queued` and `failed`.

**A request can also never settle at all.** Offline with an expired access token, supabase-js
waits on auth for a token that is not coming, so a write neither succeeded nor failed: the row
read "saving" indefinitely, and — much worse — the sync loop's in-progress flag was never
released, so *every later sync was blocked too*, including the one due when the network returned.
Hence `PATIENCE`: stop waiting after 10s and treat it as no network. Abandoning a request is safe
here precisely because every write is an idempotent upsert.

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
recurring event expansion, no push notifications, no charts, no category management UI, no
search, no tags, no multi-day views. Time ranges are not a duration: `9-6` and `10 to 6` are
explicitly out of the parser, and `9h worked` covers that need. A *clocked* span (`8 am to 9 am`,
`10:00 to 11:00`) is read for its start only — half-reading one swept `to 9 am` into the title —
and a colon or meridiem somewhere is what tells the two apart. There is no end-time column.

**Offline sync used to be on this list and is not any more.** The service worker rule stands
unchanged — it precaches the app shell and **never caches API responses**, because an invisible
cache serving stale JSON is a different and worse thing than an explicit local log the app knows
it is reading. What replaced the exclusion is `store.ts`: a durable local log plus a per-row
upsert queue. The reasoning that retired the rule is that none of this app needs a server, and
the only thing that ever failed offline was that a logged row lived in React state and was thrown
away on reload — while its reminder still fired, so the alarm outlived the entry.

Added after the spec froze, on the owner's request: the month calendar sheet (replacing an
invisible native date input), a **profile sheet** holding theme, export and sign out — which is
the settings screen the spec said not to build — swipe-to-change-day, dictation, and **On this
day**, which is the closest thing here to a multi-day view. It earns the exception by costing no
query, no page, no control and no fifth kind: it is a filter over rows already in memory, sitting
at the bottom of the timeline where you arrive by scrolling rather than by navigating. A photo
wall or a statistics dashboard is not the same trade and is still out. The deviations are listed
at the end of [README.md](README.md).

## Known rough edges

- A submit that lands on another day gives no confirmation — the row just vanishes from the
  current view. This is the app's one genuine source of confusion.
- The filler-word list is exactly `spent, paid, bought, for, on, at, worked, did`, so `to` in
  `20000 to neha` survives into the title.
- Supabase's free tier pauses a project after 7 days idle; unpausing is manual. Reads fall back to
  this device's copy while it is paused, so the app keeps working — it just stops syncing.
- Sync is last-write-wins per row. Edit the same entry on a phone and a laptop while both are
  offline and the one that reconnects second wins. There is no merge and no conflict UI.
- The local log lives in `localStorage`, which is synchronous and around 5 MB. At roughly 200
  bytes a row that is tens of thousands of entries, so the ceiling is decades away — but a write
  does stringify the whole log, and IndexedDB would be the move if that ever mattered.
- Signing out does not clear this device's log; it stays keyed by user id, so unsynced writes are
  still there on signing back in. Two accounts on one browser therefore each keep their own.
- "On this day" is computed from the corpus fetched at launch, so backfilling an entry into a
  previous year does not appear there until the app is reloaded. Deliberate: refetching the whole
  log on every write would cost a round trip to keep a strip current that changes about never.
- Dictation uses the Web Speech API, which iOS Safari does not implement. `useDictation` reports
  `supported: false` there and `QuickAdd` hides the mic rather than offering a dead button.
- The session lives in `localStorage`, so it is per-browser. Opening the magic link in a different
  browser than the one that requested it leaves the original signed out. This is not a bug.
