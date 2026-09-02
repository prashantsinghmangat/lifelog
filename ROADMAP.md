# Roadmap

Judged against the product rule: **minimum interaction → maximum outcome**, universal web
standards, accessibility, clear feedback. A step added to logging is a regression.

## Decided

| Question | Decision |
| --- | --- |
| Reminders | **A — one-tap `.ics` export.** Not Web Push, not a token feed |
| Birthday alarm | **9am on the day.** Not the day before, and not exposed as a setting |
| Next step | **Real device testing**, before anything else is built |
| Month totals in the sidebar | **Wait.** An empty sidebar is not a reason to introduce analytics |
| Wave 4 | Only after evidence from real usage |

The reasoning worth keeping: reminders via the calendar need no backend, no notification
permission, no service-worker rewrite, and keep working when the app is closed, the phone is
offline and the Supabase project is paused. Web Push is a large architectural jump for a need that
has not been demonstrated. And LifeLog is drifting from *record my life* toward *analyse my life*
the moment totals appear on screen — that is Wave 4, and it stays parked.

## Order of work

1. **Real device testing** — iPhone Safari, Chrome Android, 375px and 1440px
2. **Fix only the friction that testing actually finds** — not a speculative Wave 3B
3. **Automated backup** — before any new functionality, `.ics` included
4. **Use it normally for one to two weeks**
5. ~~**`.ics` calendar handoff**~~ — **built**, ahead of the phone test at the owner's request.
   `src/lib/ics.ts` with 21 tests, delivery via the share sheet with a download fallback. The
   share path is the one part that still needs a real installed PWA to confirm
6. **`useEntries` tests**
7. **Then** decide whether Wave 4 is justified at all

Backup sits at 3 rather than after `.ics`: the stated principle was "before adding significant new
functionality", and `.ics` is significant new functionality.

**Explicitly not now**, despite each being defensible: recurring expenses, offline queue, category
learning, search, recently-deleted, Web Push, Ask, month analytics. The risk is no longer whether
useful things can be built. It is whether LifeLog stays small enough to be opened every day.

## Device test checklist

The one thing that cannot be verified from a terminal. Known-risky items are marked, with what to
do if they fail.

**Capture**

- [ ] Quick Add is reachable and feels instant; typing `350 lunch swiggy` and pressing Enter is one motion
- [ ] The parser preview line is readable at arm's length
- [ ] ⚠️ **`autoFocus` behaviour differs by platform.** iOS generally will not open the keyboard
      without a gesture; Android Chrome may. Either is acceptable — note which happens
- [ ] Enter on the on-screen keyboard submits (`enterKeyHint="done"`)
- [ ] ⚠️ **Dictation is absent on iOS entirely** — the mic is hidden by design, not broken. On
      Android, check whether it beats the keyboard's own mic

**Sheets against the keyboard** — the likeliest failure

- [ ] ⚠️ Open an entry and focus a field. **iOS resizes the visual viewport, not the layout
      viewport**, so a `fixed` sheet can end up behind the keyboard. If it does, the fix is
      `interactive-widget=resizes-content` on the viewport meta, or the VisualViewport API
- [ ] The sheet scrolls internally rather than the page behind it
- [ ] Closing returns focus and the page has not jumped to the top
- [ ] The bottom sheet clears the iOS home indicator (`env(safe-area-inset-bottom)`)

**Navigation**

- [ ] ⚠️ Sticky Quick Add versus swipe: does a horizontal drag starting on the input still get
      swallowed, and does the sticky box behave during iOS rubber-band scrolling
- [ ] ⚠️ Swipe versus the platform back gesture. The guard ignores the outer 24px; iOS Safari's
      gesture zone is wider. Inside the installed PWA there is no back gesture, so compare both
- [ ] Chevrons and the calendar button are comfortable one-handed, not merely 44px
- [ ] The month sheet is thumb-reachable; dots are visible on a bright screen outdoors

**Platform**

- [ ] ⚠️ `min-h-dvh` behaves on iOS Safari with the toolbars collapsing
- [ ] Dark mode: follows the system, and the **native date input** in the entry sheet is legible
      (this is what `color-scheme` is for)
- [ ] PWA opens with no browser chrome; the status bar colour matches the theme
- [ ] A hard refresh keeps you signed in
- [ ] The undo toast appears above the home indicator and is tappable before it expires
- [ ] It feels fast — the 100ms row fade should be the only thing perceptible

## Everything below is options, not commitments

---

## Where it stands

Shipped and live at https://lifelog-timeline.netlify.app, installed to a phone.

| | |
| --- | --- |
| Parser | 86 tests, 223 assertions |
| Bundle | 121.7 KB gzipped, budget 150 KB |
| Runtime deps | 4 (`react`, `react-dom`, `@supabase/supabase-js`, `date-fns`) |
| Data | one `entries` table, RLS verified, soft deletes |
| Shipped | day timeline, quick add, month calendar, swipe, dark mode, dictation, undo, sheets, keyboard shortcuts |

**Never verified by anyone:** the app on Safari iPhone or Chrome Android at 375px. Specifically
whether the entry sheet clears the on-screen keyboard, and whether the sticky capture box now
fights the swipe gesture. This is the largest unknown in the project and it blocks nothing else,
so it should be done first.

---

## 1. Notifications and reminders

The three asks are not equally possible.

| Ask | Reality |
| --- | --- |
| "notify me today at 4pm" | Possible, but **only with a server** that pushes at 4pm |
| "set a 4pm alarm" | **Not possible on the web.** No API sets a system alarm. Needs native |
| Birthday reminders | Possible, and cheapest by letting the OS calendar do it |

No shipped web API raises a notification while the app is closed. `setTimeout` dies with the tab;
Chrome's Notification Triggers API never left an origin trial. So a reminder means something
outside the browser wakes up and pushes.

### Option A — calendar handoff, no backend · **recommended first**

Export events as an `.ics` file. The OS calendar raises the alarms, and `RRULE:FREQ=YEARLY`
finally makes the `data.rrule` flag already stored on birthdays do something.

Keeps working with the app closed, the phone offline, and the Supabase project paused. No
notification permission, no push infrastructure, identical on every platform. Pure text
generation, so it is unit-testable rather than hope-driven.

- **One-tap export of the whole calendar** — safe: no server, no secret URL, nothing exposed.
  Stable `UID`s per entry so re-importing updates rather than duplicates, though client behaviour
  varies. Cost: re-export after adding events.
- **Subscribable feed** (`webcal://`) — subscribe once, forever. Better UX, but calendar clients
  cannot do OAuth, so it needs an unguessable revocable token URL, and **whoever holds that URL
  reads your events**. A real privacy trade, not a technicality.

Alarm defaults: at the event time for a timed event; **9am on the day** for a birthday, via a
`TRIGGER;RELATED=START:PT9H` relative trigger so it recurs correctly every year. Not exposed as a
setting.

One detail still open, to settle at step 5 rather than now: the decision says *one-tap export of
the calendar*, while the sketched UX shows an **Add to calendar** action on a single event
(`+ Mom birthday 14 nov` → one optional action). Those are different features — per-entry handoff
at the moment of capture, versus exporting everything at once. Per-entry fits "the calendar owns
the reminder" better; export-all is the one that catches up on history. They can coexist, but the
first one built should be the per-entry action.

### Option A — implementation plan

Decided and specified, to be built at step 5. No schema change, no backend, no new dependency,
no notification permission. Everything below is derivable from what `entries` already stores.

**`src/lib/ics.ts` — `toIcs(entries: Entry[], now: Date): string`.** Pure, `now` injected, so the
output is byte-identical for the same input and the tests do not chase the clock. Mirrors the
parser's arrangement: the logic is testable, the plumbing around it is not interesting.

Rules:

| Case | iCalendar |
| --- | --- |
| Timed event | `DTSTART`/`DTEND` as UTC stamps (`20261114T113000Z`), `VALARM TRIGGER:-PT0M` |
| All-day event | `DTSTART;VALUE=DATE`, `DTEND` the next day, `VALARM TRIGGER;RELATED=START:PT9H` |
| Birthday / anniversary | the above plus `RRULE:FREQ=YEARLY`, from the `data.rrule` flag already stored |

The 9am alarm is a **relative** trigger on purpose. An all-day event starts at local midnight, so
`PT9H` is 9am wherever the reader is, and it recurs correctly every year — an absolute trigger
would fire once and be wrong in another timezone. This is also why no timezone needs storing: the
only absolute timestamps are converted to UTC.

Details that break strict parsers if skipped: CRLF line endings, lines folded at 75 octets with a
leading space, and `\` `;` `,` and newlines escaped in every text value. `UID` is
`<entry id>@lifelog`, stable so a re-import updates rather than duplicates — though client
behaviour varies, and without a `SEQUENCE` some clients ignore the update. Deriving `SEQUENCE`
from `updated_at` is the fix if that turns out to matter.

Only `kind === 'event'` is exported; an expense is not something to be reminded about. Past
one-offs are filtered out, yearly ones are kept regardless of their year because the `RRULE` is
what makes them recur.

**Delivery is the part with a real unknown.** A `Blob` download is the desktop answer, but in a
standalone iOS PWA downloads are unreliable. The Web Share API is the idiomatic mobile path:

```
navigator.canShare?.({ files: [file] })  →  navigator.share({ files: [file] })
                                        →  fall back to a blob download
```

Sharing hands the file straight to the Calendar app. This needs verifying on a real installed PWA
before the feature can be called done — it is the one step that cannot be reasoned about.

**Where it appears**, in order of how often it will be used:

1. **The toast after capture.** Typing `+ Mom birthday 14 nov` already produces a toast; for an
   event it gains an **Add to calendar** action. Zero navigation, one optional tap, exactly the
   sketched UX.
2. **The entry sheet**, for any event — the catch-up path for anything already logged.
3. **Export calendar** in the profile sheet, beside Export JSON, for everything at once.

**Tests** (~15, following `parser.test.ts`): timed versus all-day output, the yearly rule, alarm
triggers, escaping of a title containing a comma and a semicolon, folding a long title, CRLF
endings, past one-offs excluded, yearly kept, non-events excluded, and a golden-file comparison
for one full calendar.

**The honest limitation:** the calendar receives a copy. Editing or deleting the entry afterwards
does not change it — the copy has to be re-added. That is the price of having no backend, and it
is the strongest argument for Option B later.

**Explicitly not in scope:** lead-time settings, per-entry alarm times, reminders on expenses,
time logs or notes, and the subscribable feed with its token exposure.

### Option B — real Web Push

Works on Chrome desktop, Chrome Android, and iOS Safari 16.4+ **only for a home-screen-installed
PWA**, which is already the case here. Not in an iOS browser tab.

Needs, in order:

1. Migration `0002`: `remind_at timestamptz`, `reminded_at timestamptz` (not a boolean — retries
   would double-send), indexed `where reminded_at is null`. Real columns, because the scheduler
   queries them.
2. `push_subscriptions` table with RLS. One row per browser, since each device subscribes
   separately.
3. **A custom service worker.** `vite-plugin-pwa` currently uses `generateSW`, which cannot hold
   custom code; `push` and `notificationclick` handlers mean switching to `injectManifest` and
   owning the worker. Riskiest single step in the whole roadmap — a mistake breaks the installed
   app for everyone, including shell loading.
4. VAPID keypair, private key server-side only.

Scheduler:

| Approach | Cost | Accuracy |
| --- | --- | --- |
| **pg_cron + pg_net → Edge Function** | free; cron runs inside Postgres, function invoked only when work exists | ±1 min |
| Netlify scheduled function, every minute | 43,200 invocations/month of a 125k allowance, mostly finding nothing | ±1 min |
| Netlify scheduled function, every 5 min | 8,640/month | ±5 min |

**Free-tier pause is the killer argument for A as the baseline:** a Supabase project idle for 7
days pauses, and a paused project pushes nothing.

### Option C — in-app only

Show what is due on open. Trivial and useless: the app gets opened *because* something was
remembered.

### Syntax

Ideally none. `dentist tomorrow 5pm` should simply produce a reminder at 5pm — no new tokens, no
extra taps. Explicit control (`remind 30m before`) is a parser change worth deferring until it is
actually wanted.

### Recommendation

A now, B only if "it should buzz in the app, not my calendar" still grates after two weeks. A's
data work is what B needs anyway, so nothing is wasted.

---

## 2. Interaction polish, in priority order

Cheap, no new destinations, all within the current model.

| Item | Why | Cost |
| --- | --- | --- |
| **Test on a real phone** | Nothing here has been seen on iOS at all | an afternoon |
| **Notes visually lighter** | Notes carry no number; eight in a row read as a wall next to expenses and time logs | small |
| **Time-of-day grouping** | Morning / afternoon / evening dividers, but only pays off on days with several timed entries | small |
| **PWA `shortcuts` in the manifest** | Long-press the home-screen icon → straight into the input. Manifest-only, zero JS, saves a tap | tiny |
| **`share_target` in the manifest** | Share any text into lifelog to log it. Android only, degrades silently. The closest legitimate route to the SMS-capture idea without notification listeners | small |
| **Update-available toast** | `autoUpdate` swaps the app out silently; saying so is clearer | tiny |
| **High-contrast theme** | One more `[data-theme]` block, no component changes — the token system was built for this | small |

---

## 3. Understanding the data

Parked deliberately until there is real data to understand.

**3a. Deterministic insights, no AI.** Month totals in the sidebar dead space
(`₹12,400 spent · 42h logged · 87 entries`) come nearly free: the calendar already fetches that
date range for its dots, so it is one query returning sums instead of dates. No charts, no new
destination, no taps. Then a stats sheet, and a small query box reusing the parser's date tokens
(`food last month`, `total august`).

**3b. Natural-language Ask.** Needs a Supabase Edge Function, because an API key can never ship in
the client. The function reads rows under the user's JWT and asks a model. Adds a backend, a paid
API, per-question latency, and contradicts the spec's *no AI* line.

**Do 3a first.** 3b should answer from computed totals, not raw rows, so it needs 3a regardless.

---

## 4. Bigger changes worth considering

| Idea | Case for | Case against |
| --- | --- | --- |
| **Recurring expenses** | Rent and subscriptions are the same entry every month; auto-entry removes the most repeated taps in the app | recurrence expansion was explicitly out of V1; needs a generator and a "did this actually happen?" confirmation |
| **Offline capture queue** | Logging on the metro with no signal currently fails to a retry affordance. Capture is the product, so capture should survive a dead network. IndexedDB outbox + Background Sync, falling back to retry-on-load | "no offline sync" was a V1 rule; adds real complexity and a second source of truth |
| **Category learning** | `merchants.ts` is hardcoded; correcting a category teaches nothing. Storing corrections would make categories improve with use | a new table, and a category management UI was ruled out |
| **Search** | Inevitable once there are months of data | needs a real decision about scope — client filter over a range, or Postgres full-text |
| **Recently deleted** | Soft-deleted rows are unreachable after the 6-second undo expires, despite still being in the database | a view for a rare need |

---

## 5. Native apps, and when they would be worth it

Not now, but the destination if reminders become the point of the app.

**The constraint that decides most of this: building and signing an iOS app requires macOS and
Xcode.** That is Apple's rule, not a framework's, so no toolchain escapes it — Capacitor, React
Native and Flutter are identical on this point. Development here is Windows and the daily device
is an iPhone, so "native" means one of: cloud CI (Codemagic, Appflow — free tiers exist, signing
is fiddly), a Mac, or borrowing one. Distribution to one's own phone still needs the Apple
Developer Program at $99/year, TestFlight included. Android alone is free and buildable on Windows
today, but does not help an iPhone user.

### What native buys over the web

| Capability | Web today, or with Push | Native |
| --- | --- | --- |
| Own notifications at an exact time | with Web Push | yes |
| **Scheduled on-device, no server** | no — needs a backend awake | **yes, strictly better** |
| Fires when the Supabase project is paused | no | yes |
| **Writing to a calendar silently** | impossible | yes, with a permission prompt |
| System alarm in the clock app | no | Android only — **iOS forbids it even natively** |
| Widget, share-target, SMS capture | no | Android |
| Deploy in under a minute | yes | no: build, sign, submit |

Local notifications scheduled on the device are the real prize — no server, no paused-project
failure, works offline. "Set a 4pm alarm" still will not be a system alarm on an iPhone, though;
iOS permits no app to do that.

### Which toolchain

| | iOS needs a Mac | Reuses this codebase |
| --- | --- | --- |
| **Capacitor** | yes | **all of it** — the existing build *is* the app |
| React Native | yes | the parser and libs could port; every component is rewritten |
| Flutter | yes | nothing. Dart rewrite, and its web output discards the bundle budget and the accessible DOM |

Capacitor wins on the only axis that matters here: `npx cap add ios android` wraps what already
exists. Same components, same parser, same Supabase calls, and the web build keeps deploying to
Netlify untouched. Reminder logic stays; only delivery changes. Which also means **postponing
costs nothing** — no work done now is wasted by going native later.

### Triggers for revisiting

Go native when one of these is actually true, not before:

- An Android widget or share-target capture is wanted
- Reminders must fire on a project that has been idle a week
- Silent calendar writing matters more than one tap
- It belongs in the App Store

### Order, if it is ever wanted

Backup → Web Push (proves the reminder habit and the data shape) → Capacitor for Android as a free
experiment on Windows → iOS once build infrastructure exists. That way native is a delivery
change rather than a discovery exercise.

Note that Capacitor plugins are runtime dependencies, so **the four-dependency rule would have to
be retired deliberately**, not broken by accident.

## 6. Debt and risk

**Only the parser is tested.** `useEntries` is the second-most load-bearing file — the refetch
merge, the retry closure map, optimistic rollback, restore — and has no tests at all. Either mock
the Supabase client or extract the state transitions into pure functions and test those. This is
the most valuable non-feature work available.

**There is no backup.** A single-user financial history exists in one Supabase project with manual
JSON export as the only copy, and point-in-time recovery is not on the free tier. Now scheduled at
step 3.

One trap when it is built: **a dump written into Supabase Storage is not a backup**, because it
shares the fate of the thing it is backing up. It has to leave the project — a commit to a private
repo, an object store, or an emailed attachment. The scheduler can be a Netlify scheduled function
holding the service-role key as a server-side environment variable, which must never reach the
client bundle.

**Sign-ups are still open.** Anyone with the publishable key from the bundle can create an account
on the project. RLS keeps them out of the data — verified — but there is no reason to leave it
open. Authentication → Sign In / Providers.

**Accessibility is asserted, not measured.** 44px targets, focus rings, reduced motion,
`sr-only` labels and no colour-only meaning are all in place by construction, but no axe or
Lighthouse run has confirmed it and no screen reader has been used.

**Bundle headroom is 28 KB.** The weight is `@supabase/supabase-js` pulling in `storage-js`,
`realtime-js`, `functions-js` and `phoenix`, none of which are used. Importing `auth-js` and
`postgrest-js` directly would recover roughly 30 KB if a feature ever needs the room.

**The "Powered by Netlify" badge** is injected at their edge, not present in the build. It comes
off via Netlify's settings or plan, not via code.

---

## 7. What should not change

The constraints are what keep this app fast, and each has already resisted a plausible reason to
break it.

- **Four kinds.** No fifth.
- **One screen, at most three destinations** — Today, Calendar, Ask. Not a dashboard.
- **Money is integer paise**, formatted in exactly one place.
- **Soft deletes only.**
- **Four runtime dependencies.**
- **No `MobileX.tsx` / `DesktopX.tsx`.** Same data, same components, responsive CSS; presentation
  differs only where the interaction genuinely does.
- **Semantic colour tokens, never `dark:` variants.**
- **Undo, not confirmation.**
- **The parser stays pure** and never calls `new Date()`.

---

## 8. Decisions needed

1. **Reminders:** A (one-tap export), A (subscribable feed, with the token exposure), or straight
   to B?
2. **Alarm defaults:** birthday at 9am on the day, the day before, or both?
3. **Order:** phone testing first, or reminders first?
4. **Month totals in the sidebar** — the honest fix for the empty space, but it is the first step
   of §3a, which was parked. Yes or wait?
