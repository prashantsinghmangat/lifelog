# Roadmap

Status, decisions and what is left. Judged against the product rule: **minimum interaction →
maximum outcome**, universal web standards, accessibility, clear feedback. A step added to logging
is a regression.

---

## Where it stands

| | |
| --- | --- |
| Web | https://lifelog-timeline.netlify.app, auto-deployed from `main` |
| Android | Capacitor shell, installed by `npm run android:install` |
| iOS | the web app, installable as a PWA — **never tested** |
| Tests | 185, across parser, format, ics, query, reminders, sign-in links and backup |
| Bundle | ~127 KB gzipped against a 150 KB budget |
| Data | one `entries` table, RLS verified, soft deletes, nightly backups off-site |
| Runtime deps | react, react-dom, supabase-js, date-fns, Capacitor, @netlify/blobs |

---

## Done

**The V1 spec, in full.** Parser, magic-link auth, `useEntries` with optimistic writes and
per-row retry, the single day screen, PWA, Netlify deploy. Every acceptance criterion met.

**Capture.** One box. Expenses, time logs, events and notes from one line of text; dates,
clock times, durations, amounts, relative reminders and yearly birthdays; an undated entry lands
on the day being viewed, so arrowing back a day and typing backfills.

**Navigation.** Month calendar with a dot on days that hold entries — a sheet on narrow screens,
permanently in the sidebar on wide ones. Chevrons, swipe, and keyboard shortcuts on desktop.

**A design system rather than styling.** Semantic colour tokens that swap under `[data-theme]`,
so dark mode needed no `dark:` variants and a third theme would need no component changes. One
`Sheet` primitive owning focus trap, focus return, Escape and scroll lock — a bottom sheet on
compact, a dialog on wide. Undo instead of confirmation. 44px targets, one global focus ring,
reduced motion, screen-reader labels, no meaning carried by colour alone.

**Three ways to sign in**, each covering a hole in the others: password (needs no email at all,
set from inside an existing session), a six-digit code (needs custom SMTP), and pasting the
sign-in link (works with Supabase's default template, and is the only route into an installed iOS
PWA).

**Reminders, twice over.** Natively the app schedules a real notification on the device: no
server, no push, fires with the app closed and the Supabase project asleep. On the web, events
are handed to the OS calendar as `.ics`, with birthdays repeating yearly and alarming at 9am.

**An Android app.** Capacitor around the same build — same React, same parser, same Supabase
calls. Build tooling that finds its own JDK and SDK, wireless adb, and live reload against the
dev server.

**Answers.** A leading `?` turns the box into a question and the answer appears while typing.
Counting distinct days, totalling money and time, over periods from `today` to a bare month name.
Deterministic arithmetic, no model, so the answers are tested exactly.

**Backups.** A nightly Netlify function copies every row — soft-deleted ones included — to
Netlify Blobs, keeping thirty snapshots, with a token-guarded endpoint to read them back.
Verified end to end at 69 rows.

**The manual, in the app.** Every example tappable, filling the box rather than saving, reachable
from the empty state as well as settings.

---

## What the bugs taught

Worth keeping, because they point at where effort belongs.

**Every recent bug was in component wiring, not in the libraries.** `parser.ts`, `ics.ts`,
`query.ts` and `format.ts` carry 185 tests between them and have produced almost nothing. The glue
has no tests and produced: the send key that only dismissed the keyboard, a relative reminder
measured from a cached clock, a question filed away as a note, a dictation error covering the
preview.

**Three separate reminder bugs were invisible for exactly as long as their promises rejected into
nothing.** Every path now reports an outcome.

**Returning a Capacitor plugin from an `async` function rejects every call**, because resolving
the return value reads `.then` and the proxy forwards it to native. It cost hours and was found by
attaching a debugger, not by reasoning.

**A service worker inside the native shell served the old app after every reinstall**, so several
verified installs never reached the running code. Instrument before inferring: `dumpsys`, the
DevTools protocol and a pulled APK each answered in minutes what guessing had not in hours.

---

## Next — Wave 4: prove lifelog deserves to exist

Not "insights". The bundle size, the test count, the Android shell, the reminders and the backups
are all easy to mistake for validation. They are not. The only measure that matters now:

> **When something happens, do I instinctively open lifelog to record it?**

**1. A component harness.** `@testing-library/react` and `jsdom` — devDependencies, no bundle
cost. Not generic coverage: **user journeys where something can silently go wrong**, which is
precisely the failure mode every recent bug had.

- quick add → submit
- `?` question → answer appears, and does *not* become an entry
- prefill from the manual → box, edited before saving
- reminder created → outcome reported
- edit → save, with the reminder moving too
- delete → undo → restored
- failed write → retry
- dictation → preview → submit

**2. `useEntries` tests.** The transitions, not the rendering:

```
optimistic insert → server ok      → row kept
optimistic insert → server fails   → flagged, retry replays it
refetch            → server rows merged with unresolved optimistic ones
delete             → soft delete, never DELETE
delete → undo      → restored
```

**3. iPhone.** Before any substantial feature. Safari *and* standalone, ~375px, keyboard open:
open → capture → keyboard → save → timeline. Then the entry sheet with the keyboard up, swipe
against the iOS edge gesture, `dvh` with collapsing toolbars, the calendar sheet, dark mode, the
mic's absence, and the `.ics` share sheet.

**Do not fix hypothetical iOS problems before seeing them.**

**4. Seven days of real use.** Not a feature sweep — lifelog as the actual memory system. Every
expense, work session, event, birthday, stray thought. Record only the friction: what did I want
to log, what did I type, where did I hesitate, what did I expect, what happened, would I do it
again.

That evidence decides what comes next. If the answer is *"I use it"*, improve retrieval and
insight. If it is *"I don't"*, the problem is capture or the habit loop, and no amount of
intelligence on top will save it.

---

## Considered, not doing

**Reading bank SMS or notifications** to capture expenses automatically. Technically feasible
natively; **not publishable** — Google Play excludes financial parsing from the approved SMS use
cases, and notification listener access is limited to wearables, focus aggregation and alternate
launchers. Viable only as a sideload-only build, with a Gradle flavour so the Play APK never
declares the permission. The publishable alternatives are a share target and statement import.

**Natural-language Ask over an LLM.** Needs an Edge Function to hold the key, adds latency and
cost, and should answer from the totals `query.ts` already computes. Worth revisiting only if the
deterministic answers prove insufficient in use.

**Native iOS**, until there is a reason to pay for build infrastructure.

**Recurring expenses, offline capture queue, category learning, search, recently-deleted.** All
defensible. The risk is no longer whether useful things can be built, but whether lifelog stays
small enough to open every day.

---

## Should not change

Each of these has already resisted a plausible reason to break it.

- Four kinds. No fifth.
- One screen, at most three destinations: Today, Calendar, Ask.
- Money is integer paise, formatted in exactly one place.
- Soft deletes only.
- No `MobileX.tsx` / `DesktopX.tsx`. Same data, same components, responsive CSS.
- Semantic colour tokens, never `dark:` variants.
- Undo, not confirmation.
- The parser stays pure and never calls `new Date()`.
- Never return a Capacitor plugin from an `async` function.

---

## Open chores

- **Make the single-user invariant explicit**, rather than switching sign-ups off and forgetting.
  The intended state is: *expected users 1, allowed account mine, account creation disabled.*
  Sign-ups are enabled at the moment only because a friend is testing; left on, the project keeps
  an authentication system behaving like a public SaaS for a product that is single-user by
  design.
- **Alarms and reminders** permission on the phone, or Android downgrades reminders to inexact.
- The `.ics` share sheet has only been proved on Android.
