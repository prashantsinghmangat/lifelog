# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run android                    # build, then copy the web assets into android/
npm run android:open               # open the native project in Android Studio
npm run dev                        # vite dev server on :5173
npm test                           # vitest run (446 tests)
npm run test:watch                 # vitest watch
npx vitest run -t "yesterday"      # tests whose name matches a substring (4 of 446)
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

**A repeat is no exception to that, and used to be.** `soonestOf` counted from `now`, so arrowing
forward to Monday the 14th and typing `standup 10am weekdays` filed it on Friday the 11th — the
one entry `defaultDay` did not govern. It counts from `fallback` now: the soonest listed weekday
on or after the day you are looking at. A date typed in the line still wins over both.

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

An extra is `{ label, value }`, not a string, so `avg` and `first` read as named numbers rather
than as prose; a null label is for the facts that name themselves. **An upcoming date only leads
when the question named a subject** — or asked `when` outright. Without one, "what happened
around 6 September" was answered with "Tuesday 8 September": a reminder that merely fell inside
the window, offered as the answer to a question explicitly about the past. And with no subject
*and* no measure the lead is the **span the rows actually cover** (`4 — 8 Sep`), because that
question is asking which days, and a tally is not an answer to it. A subject or a measure turns
it back into a question about a quantity, and the quantity leads again. `avg` rounds to whole
rupees: money prints paise when it has them, which is right for a figure somebody typed and
wrong for a derived one. **`grouped` is
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

**A weekly repeat is one row with several alarms.** `standup 10am weekdays` stores
`data.rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'` and schedules five notifications, each with
`on: { weekday, hour, minute }` — a cron the OS keeps honouring. **"No recurring event expansion"
still holds in the data**: the log keeps one row for a standup that rings every working day, so
there is one thing to edit and one to delete. `alarms()` is the scheduling authority and
`alarmIds()` covers every id an entry could *ever* have owned, because editing a weekday standup
down to one Monday otherwise leaves four alarms armed with nothing left in the row to derive them
from.

**`occurred_on` is the day a repeat *starts*, not decoration, and three separate places had to
learn that.** A standup set up to begin on Monday the 14th rang on Friday the 11th: the row said
one thing and the phone did another.

- `nextOccurrence` scans from `max(today, occurred_on)` rather than from today.
- `occurrencesOn` will not draw it before that day.
- `alarms()` bounds the cron **per weekday, not per entry**. A `weekday` cron's first firing is
  simply the next matching day, so only the weekdays that would fire early are held back — each as
  a one-off at its first real occurrence, under the *same* notification id, so the first launch on
  or after the start date replaces it with the standing cron. Bounding the whole entry instead
  turned the ordinary case (typed today, starting tomorrow) into five one-offs that would stop
  repeating after a week. Predicting where a cron first fires must be **strictly after now**
  (`nextFiring`), or a Thursday standup set up on Thursday evening is judged against this morning's
  ten o'clock and needlessly held back.

The cost is that a repeat starting a whole week out gets one-offs for its first week, since every
weekday's cron would fire early; it converges to crons at the next launch on or after the start.
Capacitor's cron cannot express a start date, and there is no way around that from JS.

**A repeat is stored once and drawn on every day it lands on.** `src/lib/occurrences.ts` derives
those days — it does *not* store them, which is why "no recurring event expansion" survives intact:
still one row, one thing to edit, one to delete. What was wrong was treating the storage rule as a
reason to hide the occurrence. The alarms were armed for Monday to Friday, the row was drawn on
Monday alone, and Tuesday read as an empty day while the phone was set to go off — a working repeat
that looked broken from inside the app, reported three times before it was believed. Totals are
computed from the **stored** rows only, or a repeating entry would report five times what it cost.
It fixed yearly repeats in the same stroke: a birthday logged in 2010 was drawn in 2010 and nowhere
else, so 13 February 2027 showed nothing while the reminder fired.

**`repeatLabel` in `events.ts` is the only place a repeat is put into words** — `weekdays`,
`every Mon, Wed`, `every year`. The row, the bell and the editor all read it. Because nothing is
expanded in storage, that label on the row is the *only* evidence a repeat took effect; showing
the clock and nothing else made a five-day repeat identical to a one-off. `AheadSheet` had grown
its own copy of the wording, which is how two of them would eventually have disagreed.

**`weekdays` is an ordinary English word, so it needs a clock beside it.** Unanchored, it turned
"weekdays are busy" into a reminder ringing five times a week titled "are busy". A repeat modifies
an appointment and an appointment has a time; prose does not — so the bare form is read only when
`takeTime` also matches, and `every weekday` covers the rare timeless case because `every` says
outright that a repeat is meant. `takeRepeat` runs **before the date**, or `every monday` loses its
weekday to the plain weekday matcher and files on *last* Monday. And `takeTime` now runs before
the day is resolved, because `standup 10am weekdays` typed at eight in the evening means
tomorrow's standup — without the clock the row sat on today while `nextOccurrence` said tomorrow,
and the two disagreed about the same entry.

**Sound comes from the channel, not the notification.** On Android 8+ the channel owns the sound
and whether a notification pushes itself in front of you, and **its settings belong to the user
once it exists** — an app cannot raise them later. Reminders had been going out on Capacitor's
`default` channel, created at importance 3 with vibration off, which is exactly why every one of
them arrived silently. The fix is a *new* channel: `lifelog-reminders-v1` at importance 5, which
`dumpsys` confirms carries `mSound=…/notification_sound` and `mVibrationEnabled=true`. The daily
prompts get their own quieter channel so muting them in Android's settings does not also mute a
reminder you asked for.

**`src/lib/ahead.ts` is what is coming, and it costs no query.** The app could raise a reminder but
never show you the set of them, so the only way to know what the phone would do was to wait. A
weekly repeat contributes its *next* occurrence — one line, not one per weekday to the horizon. The
bell appears only when something is ahead: a bell that is always empty teaches you to ignore it.

**The bell reads this device's log, not the launch fetch — and that asymmetry is the point.**
`onThisDay` is fed from `history` because a memory of an earlier year cannot be made stale by
anything typed today. What is *coming* very much can: set up a standup and the bell went on
listing what was true when the app opened, which is the one question it exists to answer. So
`useEntries` exposes `all` (the whole local log, which this device already holds) and `ahead` reads
that. Costs no query either way.

**Two daily prompts, and they are not entries.** `9am` asks what is coming, `9pm` asks what
happened and what is wanted for tomorrow. One `schedule` call each with `on: { hour, minute }`,
which is a cron rather than a one-off, so the phone raises them for ever with the app closed and
nothing on a server involved — verified on the emulator by winding the clock: the 9pm prompt
fired and re-armed itself for the next day. They hold **ids 1 and 2**, and `notificationId` was
moved to start at 8 so a row can never hash onto one and silently replace it. On by default,
because a log nobody is reminded to keep is a log that stops after a fortnight; the switch is in
the profile sheet and states the times, because a daily notification is also the fastest way to
get an app muted. Stored per device (`lifelog.nudges`) rather than in the log — the same account
on a laptop has no business raising a 9am notification on a phone.

**Launch reconciles the OS's alarms with the log's.** `sync` cancels anything pending that this
launch does not want before re-arming: the OS holds alarms the app has no memory of — a row
deleted on another device, an entry whose time moved, or an id scheme that changed under a
pending alarm, which would otherwise leave the old copy to fire beside the new one. The prompts
are exempt; `scheduleNudges` owns those.

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

**`public/logo.svg` is the mark, and every other icon is derived from it.** A day's spine with
three entries hanging off it, the nodes in the same expense / time / event colours the rows use, on
the `ink` tile that is already the app's `theme-color`. Authored on a **24-unit grid**, and the
Android vector drawables carry those exact path strings — the launcher icon, the themed icon and
the notification silhouette cannot drift apart because they are the same geometry.

That grid is also the constraint that shaped it: Android draws a notification small icon as a flat
tinted silhouette at 24px, so the mark is three nodes and three bars and deliberately nothing
finer. `ic_stat_lifelog` is that silhouette; without it Capacitor falls back to a generic bell and
every reminder arrives looking like it came from nothing in particular. `capacitor.config.ts`
names it under `plugins.LocalNotifications` along with `iconColor`.

- `drawable/ic_launcher_foreground.xml` — the adaptive foreground, scaled into the central third
  of the 108dp canvas, which is the only part guaranteed not to be cropped.
- `drawable/ic_launcher_monochrome.xml` — the Android 13 themed-icon layer. Without it the system
  shrinks the full-colour icon inside a flat blob, which looks like a mistake beside every other
  themed icon on the screen.
- `mipmap-*/ic_launcher.png` and `ic_launcher_round.png` — legacy rasters, needed only for the two
  API levels below adaptive icons, since `minSdk` is 24.
- `public/icon-maskable-512.png` — see the maskable trap below.

The PNGs are generated, not drawn: there is no rasterizer on this machine and headless Chrome
returned a blank image at 144px, so they come from a small zero-dependency renderer (every shape
in the mark is an axis-aligned rounded rectangle, so coverage is analytic). It is not in the repo —
the SVG is the source of truth and the PNGs regenerate from it.

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

**Two ways a row is behind you, one treatment.** `passed()` is the clock's answer — a reminder
whose moment has gone. `done()` is yours, set by hand, and it is the only piece of state in the
app that neither the parser nor the clock decides: a note saying "send the revised scope" is
finished when you say so. `behindYou()` is the union, and it is what strikes the title through.
Stored as `data.done` rather than a column because nothing sums it, which is the rule the schema
already states — so it costs no migration. **Marking done silences the reminder**: `fireAt()`
returns null for a done event, which is the single choke point every scheduling path runs
through, and `forCalendar` drops them for the same reason. A reminder that rings at five for
something you did at three is worse than none, because it teaches you to ignore them.

**Nothing that repeats can be ticked off, so the editor does not offer it.** `done` sits on the
row, so marking today's standup done would silence every Monday after it — the same reasoning that
already keeps `passed` false for a repeat. Withholding the control is also what closed a real
data-loss path: the editor recomputed `rrule` from the title on every save, which is right for
`FREQ=YEARLY` (the word *birthday* is what makes it yearly) and wrong for a weekly rule, because
`weekdays` was typed as an instruction and survives nowhere in the title. A save that merely
toggled done therefore deleted the repeat, and since `alarms()` returns nothing for a done entry,
one tap silently cancelled five standing alarms with the row still on screen looking unchanged.
A weekly rule now survives every save; only leaving `kind: 'event'` drops it.

**A title gets two lines.** One line with an ellipsis told you an entry existed and not what it
was, and the longest titles are notes, where the words *are* the content. `line-clamp-2` in the
timeline and in an answer; the editor gives it a textarea, because editing a sentence through a
40-character window means scrolling sideways to read your own writing.

**Every row draws the same way, wherever it appears.** Title on top; clock, category and anything
else secondary on a quieter line beneath; the one number — money if the row has any, otherwise
duration — right-aligned, `tabular-nums`, and in `muted` at regular weight. **The number is
metadata, not the headline**: at medium weight in full-strength ink it competed with the title on
every row, including the many rows where it is incidental. What the entry *is* comes first. That number comes from `rowValue` in `format.ts`,
which used to be three copies of the same four lines in `EntryRow`, `AnswerCard` and a toast.
**`occurred_at` is optional, so a left-hand time gutter is not an option**: most rows have no
clock, and a column that is empty on most rows is a 56px indent that buys nothing. `AnswerCard`
had already discovered this and collapsed the column; the timeline's secondary line is the
version that survived.

**A day with nothing on it demonstrates the parser rather than describing it.** Three faded rows
carry the line to type and what it becomes — `350 lunch swiggy` / *becomes an expense · ₹350 ·
food* — drawn like the entries they would turn into, and tapping one fills the box so the next
move is editing something real. The transformation is the whole trick and an empty log is the one
place it cannot be seen. This replaced three example chips, which showed the syntax and hid the
result.

**A summary goes under what it summarises.** The day's totals sit below the last row, where the
row's own border is the rule above them. Above the capture box they read as a label for what you
are about to type instead of a summary of what you have just read.

**The capture control is two rows, and its height never changes.** The parse preview lives
*inside* the field — a rule beneath what you typed, then how it parsed, with the mic or send
button on that same row. It used to sit outside and below, reserving its line whether or not it
had anything to say, which left about 90px of dead space above the first entry on every
populated day. It cannot simply collapse: it is a live region, and a line that changes height
makes the timeline jump on every keystroke. Inside the control the height is fixed by the
control, so nothing below it moves.

**That second row is also where the mode lives: `Log · Ask`, then the parse, then send.** Asking
used to be reachable only by typing a leading `?`, which meant the box's second job was invisible
unless somebody told you the syntax. The toggle says it out loud, changes the placeholder to
*What do you want to know?*, and needs no prefix. **`?` still works from Log**, because it costs
nothing to keep and it is faster than reaching for a control — the mode is how the behaviour is
discovered, not the only way to reach it. The toggle sits *inside* the control rather than under
it for two reasons: this row has to exist anyway, and an empty strip inside a bordered box reads
as a rendering fault. 44px targets, so the row is 44px.

**A mode can be the wrong one, and a prefix cannot** — that is the cost of the toggle, and it is
paid in one place. Type `350 lunch swiggy` with Ask selected and the honest answer is "nothing
found", which is a dead end in front of something the app plainly understands. So that dead end
offers **Log instead**, carrying the parse it would record on the button. Held behind a tap, never
acted on by itself: automatic detection is what the leading `?` exists to avoid. Escape leaves Ask
and clears; every day opens in Log, because logging is the primary act.

**The answer is banded, not boxed.** `AnswerCard` was a bordered, recessed card; once day
headings took over the grouping the card was drawing a boundary nothing needed, since dates
separate the information and whitespace groups it. A pair of heavier rules and the size of the
number now do that job with less ink. **The closing rule is load-bearing** — without it the last
row of the answer and the first row of the day read as one list.

**A day opens on what is still live.** A *leading run* of already-passed reminders folds into one
`N already passed` line, from two upwards. Struck through at full size they made the loudest
thing at the top of the day the part that no longer matters. Only a leading run, so nothing is
reordered — a reminder that passed later in the day stays where it happened; and only from two,
because hiding one row behind a tap costs a row and saves none. `passed` is true of events
alone, so nothing carrying money or time is ever inside the fold, and the totals line still
counts the whole day while the fold states how many it is holding.

**`Sheet` owns modal correctness** — focus moves in, is trapped, and returns to the trigger on
close; Escape closes; body scroll locks. Any new modal goes through it rather than reimplementing
an overlay. Focus lands on the **dialog**, not its first control: focusing the first button drew
the focus ring on `Expense` every time the editor opened, which reads as a claim about the entry,
and focusing the first field would throw the keyboard up before anyone asked. A sheet's actions
are `sticky bottom-0` inside its scroll area, so the fields scroll behind them and Save is always
where you left it.

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

`data.rrule` holds the repeat: `FREQ=YEARLY` for a birthday or anniversary, and
`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` for `standup 10am weekdays`. It drives scheduling and the
bell; it never expands into rows.

## Traps

These cost real time to discover. None are visible from reading a single file.

**Never pipe `npm run android` through PowerShell's `Select-Object -First`.** It stops the upstream
pipeline once it has its objects, which kills npm *after* vite prints the asset name and *before*
`cap sync` copies anything into `android/`. Two APKs were built, installed and reported as verified
while carrying assets two builds old. `Out-String` the whole thing and match on it instead —
`Sync finished` is the line that proves the copy ran. **Verify what is actually running rather than
what was built**: read the bundle hash out of the APK (`unzip -l … | grep index-`) and out of the
live WebView (`document.querySelector('script[src]')`), and check they agree. Any assertion about
behaviour on device is worthless without that, and a launch that merely refetches can make old code
look fixed.

**`adb install -r` does not restart the app, and a screen that is off suspends the WebView.**
Without `am force-stop` the running page survives the update and reports the previous build; with
the display off, CDP stops answering entirely and looks like a broken tunnel. `input keyevent
KEYCODE_WAKEUP` first.

**Deleting anything under `android/app/src/main/res` needs a clean build.** Removing
`drawable-v24/ic_launcher_foreground.xml` and adding `drawable/ic_launcher_foreground.xml` in the
same change made aapt2 fail with `resource drawable/ic_launcher_foreground not found` for a file
plainly on disk — a stale incremental resource merge. `gradlew clean assembleDebug` fixed it with
no source change.

**A maskable icon only guarantees the central circle of 80% diameter.** The mark at full size put
the bottom bar's far corner 10.0 units from centre against a safe radius of 9.6, so the installed
PWA shortcut showed three dots with the bars clipped off — while the native adaptive icon, whose
own safe check passes at 30 of 33, was fine. The maskable PNG therefore insets its content to 0.85
and is full-bleed square: reusing the rounded tile showed transparent corners under a square mask.
A launcher caches an installed shortcut's icon, so fixing this does not fix an already-installed
one — it has to be removed and re-added.

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

**`env(safe-area-inset-bottom)` is 0 in the Android WebView.** Measured, not assumed. A bottom
sheet padded with `max(1rem, env(...))` therefore gets 16px, and Android's gesture bar is about
24, so the sheet's own buttons sat underneath it. The floor has to be a real number — the inset
adds nothing here and cannot be relied on to.

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

No AI or LLM calls, no SMS parsing, no notification listeners, no push notifications, no charts,
no category management UI, no search, no tags, no multi-day views. **No recurring event
expansion**, which still means what it always did — a repeat is one stored row however many times
it rings, so there is one thing to edit and one to delete. Drawing the days it lands on is a
derivation over that row, not a set of rows (see `occurrences.ts`). Capacitor and the native
Android app were on this list and came off it deliberately, along with the settings sheet. Time ranges are not a duration: `9-6` and `10 to 6` are
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
- **There is no control to remove a repeat.** Typing `weekdays` sets one; nothing takes it off
  again, so the only way out is to delete the row and retype it. An off switch has a wart worth
  designing around rather than shipping blind: a *yearly* rule is re-derived from the title, so
  turning off a birthday's repeat would resurrect it on the next save.
- Deleting a row deletes the whole series, including from a derived occurrence on another day.
  Consistent with one-row storage, and undo covers a mistake, but nothing on the sheet says so.
- A repeat whose start is more than a week out arms one-offs for its first week rather than
  standing crons, because every weekday's cron would otherwise fire early. It converges on the
  first launch on or after the start date; Capacitor's cron has no start parameter.
- Dictation uses the Web Speech API, which iOS Safari does not implement. `useDictation` reports
  `supported: false` there and `QuickAdd` hides the mic rather than offering a dead button.
- The session lives in `localStorage`, so it is per-browser. Opening the magic link in a different
  browser than the one that requested it leaves the original signed out. This is not a bug.
