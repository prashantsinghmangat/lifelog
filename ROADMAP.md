# Roadmap

Nothing here is committed to. It is the option set, with costs and a recommendation for each,
so a decision can be made in one read rather than rediscovered every time.

Judged against the product rule: **minimum interaction → maximum outcome**, universal web
standards, accessibility, clear feedback. A step added to logging is a regression.

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

Alarm defaults: at the event time for a timed event; 9am on the day for a birthday, via a
`TRIGGER;RELATED=START:PT9H` relative trigger so it recurs correctly every year.

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

## 5. Debt and risk

**Only the parser is tested.** `useEntries` is the second-most load-bearing file — the refetch
merge, the retry closure map, optimistic rollback, restore — and has no tests at all. Either mock
the Supabase client or extract the state transitions into pure functions and test those. This is
the most valuable non-feature work available.

**There is no backup.** A single-user financial history exists in one Supabase project with manual
JSON export as the only copy, and point-in-time recovery is not on the free tier. Worth an
automated periodic export.

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

## 6. What should not change

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

## 7. Decisions needed

1. **Reminders:** A (one-tap export), A (subscribable feed, with the token exposure), or straight
   to B?
2. **Alarm defaults:** birthday at 9am on the day, the day before, or both?
3. **Order:** phone testing first, or reminders first?
4. **Month totals in the sidebar** — the honest fix for the empty space, but it is the first step
   of §3a, which was parked. Yes or wait?
