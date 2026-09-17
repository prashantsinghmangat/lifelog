# Roadmap

Status, decisions and what is left. Judged against the product rule: **minimum interaction →
maximum outcome**, universal web standards, accessibility, clear feedback. A step added to logging
is a regression.

---

## Where it stands

| | |
| --- | --- |
| Status | **Release candidate.** UI, interaction model, data and parser are frozen; only release work and blocking bugs |
| Verified | browser and Android emulator — **physical Android, iOS and authenticated offline→reconnect are unverified** |
| Web | https://lifelog-timeline.netlify.app, auto-deployed from `main` |
| Android | Capacitor shell, installed by `npm run android:install` |
| iOS | the web app, installable as a PWA — **never tested** |
| Tests | 602, across the pure libraries plus component journeys for the app, the editor, the capture box, the sheets and the four destinations |
| Bundle | 147.5 KB gzipped across everything the page fetches, against a 150 KB budget |
| Data | one `entries` table, RLS verified, soft deletes, nightly backups off-site |
| Runtime deps | react, react-dom, supabase-js, date-fns, Capacitor (core, android, local-notifications, app), @netlify/blobs |

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

**A visual language.** Warm paper and warm charcoal in place of white-and-blue-grey, a two-line
editorial day header, quieter kind marks, a calendar demoted to navigation, a capture control that
is the one raised object on the page, and an answer whose conclusion leads. Verified at 320 / 375 /
430 / 768 / 1024 / 1440 in both themes and at 200% zoom. Every text token clears 4.5:1; `faint` had
been sitting at 2.9:1.

**Four destinations.** Today, Calendar, Ask and You in a bottom nav, reversing a rule the design
held for a long time. What earned it is that three of the four already existed and were reachable
only by knowing something — the month behind the date, the account behind a 20px glyph in the
quietest row on the screen, Ask behind a leading `?` and then behind a pill inside the capture
control. Nothing new was added; three things stopped hiding. The header paid for it by giving up
that quiet row, and the nav stands down whenever the capture field has text, so logging still
costs exactly what it did. `--dock` was retired in the same move: the toast, the control and the
nav are one block in flow, so an overlap is impossible by construction rather than kept away by a
constant two files had to agree about.

**Android's back button.** It used to background the whole app with a sheet still open behind it —
the one platform convention the app broke. `@capacitor/app` routes the event into `Sheet`'s own
`onClose`, so every sheet inherits it and there is still one close path. With nothing open the app
minimises, which is what back has always done at the root of an Android app. It gained a middle
layer with the nav: away from Today, back comes home before it minimises.

**Verification on real hardware.** A Pixel 7 emulator and a Galaxy S21 FE: keyboard open and
closed, the docked control riding the keyboard, the toast clearing the control, notification
permission granted through the app's own button, reminders actually armed and read back from the
OS, offline capture, swipe navigation, the full back-button lifecycle, and 2× font scale. Four
regressions were found this way and fixed — a date overflowing its disc at 2× text, a 36px target
on the one control the reminder feature depends on, a bottom bar floating 24px above the screen
edge because a sticky block cannot reach past its container's padding, and a capture control whose
fixed height turned out to be resting on a toggle that had just been hidden.

---

## What the bugs taught

Worth keeping, because they point at where effort belongs.

**Every bug of that period was in component wiring, not in the libraries.** The pure libraries
carried the bulk of the tests and produced almost nothing; the glue had none and produced the send
key that only dismissed the keyboard, a relative reminder measured from a cached clock, a question
filed away as a note, a dictation error covering the preview. That is what the component harness
was built for — it exists now, and the bugs it was built to catch have not recurred.

**The exception proves the rule the other way.** The two most recent defects were *in* a pure
library: `every tuesday and thursday` silently dropping the Thursday, and `every 2 weeks` being
read as ₹2. Both were found by probing the parser with realistic lines rather than by a failing
test — the tests all passed, because no test asked those questions. Coverage says nothing about
the inputs nobody thought to try.

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

**1. A component harness.** ~~Done.~~ `@testing-library/react` and `jsdom`, journeys rather than
coverage.

- ✅ quick add → submit, from Enter and from the button
- ✅ `?` question → answer appears, and does *not* become an entry
- ✅ prefill from the manual → box, edited before saving
- ✅ edit → save, including the time and the kind
- ✅ reminder created → outcome reported, blocked or scheduled
- ✅ delete → undo → restored, *through the toast*
- ✅ failed write → retry
- ⬜ dictation → preview → submit, which jsdom cannot exercise: the Web Speech
  API does not exist there, and the mic is correctly hidden as a result

**2. `useEntries` tests.** ~~Done.~~ Eleven, covering the transitions rather than the rendering:

```
optimistic insert → server ok      → row kept, flag cleared
optimistic insert → server fails   → flagged not removed, retry replays it
refetch            → server rows merged with unresolved optimistic ones
delete             → soft delete, and back if the write fails
delete → undo      → restored
off-day failure    → surfaced, since the timeline cannot show it
```

The Supabase fake has no `delete` method at all, so a hard delete would throw rather than pass.

**3. iPhone.** Before any substantial feature. Safari *and* standalone, ~375px, keyboard open:
open → capture → keyboard → save → timeline. Then the entry sheet with the keyboard up, swipe
against the iOS edge gesture, `dvh` with collapsing toolbars, the bottom nav, dark mode, the
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

## Held behind the freeze

The interface is frozen for the release candidate. One idea survived the review and is worth
doing **after** it, not instead of it.

**Kind marks become small kind-coloured dots.** Today each row carries a 15px glyph — the rupee
sign, a clock, a calendar, a note. A dot is quieter, and it is the one thing here that could grow
into a brand language: a trace through time rather than a set of icons.

It has to stay **coloured**, and that is the whole design of it. The mark exists so the expenses
in a day can be found without reading the rows, which is exactly what a monochrome dot would
throw away — it would be quieter and useless. Desaturated, one step back from the current kind
colours, it keeps the scanning affordance and loses the iconography. `KIND_NAME` still carries the
meaning in words, so nothing about it is colour-alone.

Nothing else from the visual review is outstanding. Typography, palette, timeline, capture,
calendar, sheets, toast, the empty state, the wide layout, spacing, shadows and dark mode were all
checked against the brief and are already in. Two ideas were considered and **closed**: a
left-hand time gutter (`occurred_at` is optional, so the column would be empty on most rows — see
CLAUDE.md), and boxing the two columns on a wide screen (they are two regions of one workspace,
not two cards).

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
- **Four destinations and no more: Today, Calendar, Ask, You.** The cap used to read "one screen,
  at most three" and the bottom nav spent it — three of those already existed and were merely
  hiding, and You joined them because the account belongs beside them rather than in the header.
  A fifth would be a new place rather than an old one surfaced, which is a different argument and
  a worse one.
- **The capture control stays on every destination but You, and the nav stands down while the
  field has text.** That clause is what the nav was granted on. A bar sitting over the box would
  cost a step in the one act this app exists for.
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
- **The light-mode status bar does not match the page on Android.** The native bar is painted by
  `Theme.AppCompat.DayNight.NoActionBar`, not by `theme-color`, so a paper-coloured page sits under
  a dark band; dark mode has no seam because the two happen to agree. Fixing it properly means
  following the *app's* theme rather than the OS's — the You screen lets the two disagree, so a
  `values-night` qualifier would get it backwards — which needs `@capacitor/status-bar` or native
  work. Making the bar transparent instead is worse: the header would land under the clock.
- **The bundle has 2.5 KB of headroom.** 147.5 KB gzipped across everything the page fetches,
  against a 150 KB budget. The main chunk alone reads a comfortable 138.6 KB, which is how the
  margin came to be overstated — the CSS and the lazy Capacitor chunks are the rest. The bottom
  nav cost 0.9 KB of it.

---

## What is verified, and what is not

Written down because "tested on Android" is the kind of claim that quietly becomes untrue.

| Path | State |
| --- | --- |
| Browser, 320→1440, both themes, 200% zoom | verified |
| Android emulator (Pixel 7, API 36) | verified — keyboard, back button, permissions, armed reminders, offline capture, swipe, 2× font scale |
| Physical Android (Galaxy S21 FE, Android 16) | verified for safe-area insets, dock clearance, targets and the Web Speech result; **not** for a full interaction pass |
| iOS, Safari and standalone | **never run** |
| Authenticated offline → reconnect | **never run** — the guest path makes no requests, so the sync queue, retry and reconcile logic has only unit coverage |
