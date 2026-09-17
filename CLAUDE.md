# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run android                    # build, then copy the web assets into android/
npm run android:open               # open the native project in Android Studio
npm run dev                        # vite dev server on :5173
npm test                           # vitest run (602 tests)
npm run test:watch                 # vitest watch
npx vitest run -t "yesterday"      # tests whose name matches a substring (4 of 602)
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

**A read is evidence about the log as it was when it was sent, which is why `reconcile` takes
`since`.** A read that returns without a row is normally proof the row is gone, and that is how a
delete made on the laptop reaches the phone. But an entry typed while a read was in flight, whose
own write then landed first, is absent from that reply and no longer pending — so it was dropped
from the device, vanishing off the screen while sitting safely on the server until something
happened to fetch it again. Arrowing to another day and typing straight away is enough to reach it.
Both readers stamp `since` *before* the request, and a row created after it is kept whatever the
reply says. Compared as moments rather than as text, because the server stamps `+05:30` and the
client stamps `Z`.

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

**And a refusal is not always worth repeating.** `refused` is a server that said no *this time* —
a token about to refresh, a rate limit, a bad minute — and waiting is the right response, which is
what the 30-second retry exists for. `rejected` is a 4xx that objects to the *row* rather than to
the moment, and no amount of asking will change it; a single such row otherwise made a request
every thirty seconds for as long as the app was open. Both still read as `failed` with a Retry
chip, because the row is still visible, still editable, and an explicit Retry still sends it — an
edit re-attempts it immediately, which is the actual way out. Only the automatic timer knows the
difference. 401, 403, 408 and 429 are deliberately *not* permanent: each of those does come back.

**The app can be used with no account at all, because nothing it does needs one.** The auth gate
was the last thing here that waited on a network it did not need: parsing, drawing a day,
totalling it, answering a question and raising a reminder are all local, and yet the first screen
demanded an email and a round trip before any of it could be seen. `guest()` in `identity.ts`
mints a `local-…` id that keys this device's log exactly as a Supabase user id does, so every
layer above `store.ts` is unchanged. `useEntries` takes a `local` flag and makes **no request at
all** — no read, no flush, no retry timer — and reports no status on any row: with no server to be
behind, labelling every entry `saved here, not synced` would be the app apologising for working
as designed.

**A changed `userId` reloads the log, and forgetting that undid the adoption.** `useEntries` read
its initial state once, which was correct for as long as the id could not change under a mounted
hook — and then a guest could sign in. `adopt` rewrites the account's key *before* the hook sees
the new id, so keeping the previous user's state meant the persist effect wrote it straight back
over the adopted log, taking the account's own unsynced writes with it. Silent, and only visible
on the next launch. The swap is made **during render** rather than in an effect, for the same
reason `apply` advances the ref and the state together: `write` reads the ref in the same tick, so
a log that is still the previous user's for one commit is a log an entry can be added to and lost
from.

**Signing in later adopts the guest log rather than stranding it.** The key changes with the id,
so without `adopt` in `store.ts` every entry made as a guest stays on the device and becomes
unreachable — which reads exactly like the app threw them away, a worse first impression than the
wall it replaces. Every adopted row is re-queued, since the server has never seen one and each
write is a full-row upsert anyway. The guest's *pending* list is deliberately dropped: it records
writes owed for rows the server never had, including deletes of entries that never reached it, and
replaying those would ask the server to remove rows that do not exist. `You` offers an account
instead of a sign-out, because a sign-out button beside the only copy of a log reads as
"delete my log".

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

**`byClock` compares moments, not text.** `occurred_at` carries an offset and the writers do not
agree on which: `occurrences.ts` built a derived occurrence with `toISOString()` (UTC), the parser
writes the local offset, and PostgREST answers in UTC again. Compared as strings that is
`04:30:00.000Z` against `06:30:00+05:30`, which put a ten o'clock standup above a half past six
reminder on every day a repeat lands on — and, because the head of the day was then a repeat rather
than a passed reminder, silently switched off the `N already passed` fold. A feature turned off by
a sort. `movedTo` now stamps the same local format as everything else as well, so the shapes match
even where nothing compares them.

**`line-clamp-2` must not be written beside `block`.** Tailwind emits `.line-clamp-2{display:
-webkit-box}` and `.block{display:block}` *later* in the sheet, so `block` won and the clamp did
nothing: "a title gets two lines" was a rule the CSS had never once applied, and long notes ran to
whatever height they liked. Verified in a browser, not inferred — the class was there the whole
time.

**A `Sheet` stacks above the toast, and that is load-bearing.** The toast is `fixed bottom-0` at
`z-30`; a sheet's actions are sticky along its own bottom edge. At `z-20` a message still on screen
sat squarely over Save, Cancel and Delete — `elementFromPoint` at the middle of Save returned the
toast. The tap did not miss, it hit the wrong control, and on a toast carrying Undo that meant
pressing Save restored the row you had just deleted. Logging something and editing an entry within
the next few seconds is all it takes.

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

**Reading may be derived; writing may not.** A derived occurrence carries the day it was *drawn*
on, so handing one to anything that writes saves that day back onto the row. It did: opening
Tuesday's standup and pressing Save moved the series start to Tuesday, and opening a birthday
logged in 2010 from this year's view rewrote its year to this one — the original date gone, with
nothing on screen to say so. Delete and Undo went the same way, since Undo restores whatever row it
was handed. `App`'s `asStored` resolves an occurrence back to the row by id before the editor,
`remove` or `restore` ever see it, which is what `isOccurrence` was always for.

**`nextFireAt` is the one place a day becomes a moment, and the editor is the
first thing that has to *say* it.** `nextOccurrence` answers with a day; gluing a
clock onto that day (or 9am when the entry carries none) was being done
separately in `ahead`, in the yearly branch of `alarms`, and would have been done
a third time in the editor. Three readings of what an entry with no clock means
is two too many — the one that disagreed would have been a reminder ringing at an
hour the app had never shown anybody. It also owns the rule that **a moment that
has gone is not a next one**: `nextOccurrence` hands back *today* for a reminder
that rang this morning, which is right of a day and wrong of a moment, and both
callers were separately remembering to drop it. It says nothing about whether
anything is *armed* — a done entry still has a next occurrence, it just does not
ring, and `fireAt` stays the single choke point for that.

**The editor states when the entry next happens, because the row could only name
the rule.** A repeat is stored once and expanded nowhere, so `weekdays` on the
row was the *only* evidence one had taken effect — and that word says what the
rule is, never that a moment is coming. Opening the entry and still not knowing
when it next lands is exactly how a working standup reads as broken from inside
the app. The line is worded as a fact about the calendar (`Next tomorrow at 5:00
pm`), **not about a notification**: whether an alarm actually reaches you also
depends on an OS permission the sheet knows nothing about, which `App` already
reports in its own banner. Promising "rings" from here is the one class of claim
this app must not make and then fail to keep. It reads from the form's *pending*
values rather than the stored row, so a time edited under it cannot leave a
confident sentence describing the moment Save is about to replace — which is why
the repeat and `done` derivation moved out of `save` and above it, where one
reading now serves both. Marking done replaces the line with `Done — no
reminder`, since silencing is a documented consequence of that button that the
button itself never mentioned.

**A repeat can be switched off, and the thing that made that impossible was the yearly rule being
re-read from the title on every save.** Clear a birthday's repeat and the word *birthday* put it
straight back the next time Save was pressed, so no control could be built. The title is now read
**only when a note becomes an event** — the one case that needs it, since a birthday whose date
had passed parses as a note and must gain the rule when corrected. An existing event simply keeps
whatever rule it has, which also retires the weekly special case: `weekdays` is typed as an
instruction and survives nowhere in the title, so the old recompute deleted it and a save that
merely marked a standup done silently unscheduled five alarms. One rule now covers both. The cost
is that retitling an existing event to "deepak birthday" no longer makes it yearly by itself, and
a repeat you can turn off is worth more than one that appears from a word. Only *yearly* can be
switched back on from the sheet: a weekly rule needs its days, and the text box is where those
are said.

**A row says how long until something happens today.** `until` in `format.ts` gives `in 47m`
beside the clock, never instead of it — the clock is the fact you repeat to somebody else, the
countdown is the one you were reading the row for. Today only: beyond it `relativeDay` already
says "tomorrow", which reads far better than "in 19h 20m". It is recomputed on the same
30-second tick everything else uses rather than ticking per row, so it is a statement and not a
countdown. `AheadSheet` prefers it over its own "today", which was only repeating what the sheet
already said.

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

**A repeat may name several days, and dropping one was the worst thing this parser did.** `every
tuesday and thursday 7pm` kept the Tuesday and lost the Thursday — and the orphaned `thursday` was
then read by `takeDate` as a plain weekday, which files on the *last* one. So a line asking for
twice a week produced one repeat starting **in the past**, with `and` left in the title, and
nothing on screen said any of it. `takeRepeat` now reads a *run* of weekday names after `every`,
joined by a comma, `and`, `&` or nothing at all — `every mon wed fri` is how people type it. A bare
space is safe as a separator because the run only continues while the next word *is* a weekday, so
`every friday gym` stops at Friday and leaves `gym` to be the title. The invariant is that **every
weekday the line names survives into the stored rule**. Nothing downstream changed: `BYDAY=TU,TH`
is what `weeklyRule` always wrote, `repeatLabel` already said "every Tue, Thu", and `alarms`
already armed one cron per weekday — only the grammar could not say it.

**A number straight after `every` is never money.** `gym every 2 weeks` is an interval this app
cannot express, and the bare-number branch of `takeAmount` was reading that `2` as ₹2 — so the line
became an expense titled "gym every weeks": wrong kind, invented amount, and the typed words
mangled. It is recorded as a note with the line intact instead, which is honest about what the app
can and cannot do. Currency-marked amounts are untouched, because `₹2` says money outright.

**Cancelling an alarm must never decide whether the new one is set.** `rearm` in `reminders.ts`
owns the order, because `cancel().then(schedule)` in `App` meant a cancel that *rejected* skipped
the schedule entirely — so the failure that merely might leave a spare notification instead
reliably lost the reminder the user had just edited. Scheduling after a failed cancel is safe
rather than noisy: the ids come from the entry, so each alarm is replaced in place, and only an id
the *new* plan has dropped can survive until launch reconciliation clears it. `stale` is the one
narrow case worth saying out loud — the entry schedules nothing now and the old alarms are still
armed, so something really is going to ring for a row that should be silent.

**A yearly repeat is armed for its next occurrence, not for the date on the row.** `fireAt`
answers with the stored date, which for an anniversary is almost always in the past — so `alarms`
returned nothing and a birthday was never scheduled at all. Everything *around* it worked, which is
what kept it hidden: the bell listed it, the day it lands on drew it, the `.ics` carried
`RRULE:FREQ=YEARLY`, and the README promised "9am on the day, every year". Only the notification was
missing. It is a one-off at the next occurrence rather than a yearly cron, deliberately: `{ at }` is
the mechanism already proven here, and `sync` re-arms it on every launch under the same id — the
same converge-on-next-launch shape the held-back weekday crons use.

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
the You screen and states the times, because a daily notification is also the fastest way to
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
three entries hanging off it, the nodes in expense / time / event colours on a near-black tile.

Those are the palette as it stood when the mark was drawn, and they are **deliberately frozen**
there. The PNGs, the Android drawables and any already-installed launcher icon are rendered from
this file by a tool that is not in the repo, so a colour changed here and nowhere else is exactly
how the launcher icon, the themed icon and the notification silhouette come to disagree — the one
thing the shared geometry exists to prevent. `theme-color` no longer matches the tile and should
not: that meta carries the *surface*, because the chrome is a continuation of the page. Authored on a **24-unit grid**, and the
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

**Both palettes are warm, and neither is the other inverted.** Light is off-white paper with a
near-black warm ink; dark is warm charcoal with a warm off-white. This is not decoration: an app
whose entire content is a person's own record of their week reads as a form to fill in on pure
white with blue-grey text, and as something worth keeping on paper. The dark palette is built from
the dark end rather than by flipping the light one, which is how a dark theme ends up looking like
a lit screen instead of a dim room.

Every *text* token clears 4.5:1 on the surface it is used over. `faint` did not — it sat at 2.9:1,
which is what "tertiary" had quietly come to mean on a screen where most of the type is 12px.
`line` and `edge` stay below that deliberately: they separate, they do not inform, and nothing
here is legible only because of a border. The `theme-color` meta, the manifest and `useTheme` all
carry the *surface*, not the ink — drawn edge-to-edge the browser chrome is a continuation of the
page, and a dark bar over a paper-coloured page reads as a header the app does not have.

**The four kind colours are scanning accents, not four UI colours.** They are deep enough to read
as ink with a hue rather than as a highlight, and the mark is 15px in a 20px gutter. At 16px in
the old saturated hues, four of them down a column competed with the titles they were marking —
the colour is there so the expenses in a day can be found at a glance, not so the row can be
categorised by looking at it. `KIND_NAME` still carries the same fact in words, as it always did.

**Tailwind classes are never interpolated.** ``className={`text-${kind}`}`` compiles to nothing,
because Tailwind only emits classes it can literally see. Kind colours go through written-out
`Record<Kind, string>` maps.

## UX rules that are architecture, not taste

> **Building UI? Read [DESIGN.md](DESIGN.md) first.** It is the followable form of this section —
> the tokens, the type scale, the row anatomy, the 44px targets, the bottom block and a
> checklist — written so a change can be made without reading the whole of this file. **This
> section is the reasoning and stays the source of truth**; DESIGN.md is what to do, and if the two
> ever disagree, this one is right and DESIGN.md needs updating.

**Minimum interaction → maximum outcome.** Before adding a control, ask whether a default can
remove it. Capture is the product: anything that adds a step to logging is a regression.

**One component tree, three layouts.** Breakpoints are compact (`<640`), medium, wide (`lg`,
`≥1024`) — never device-specific. **Never create `MobileX.tsx` / `DesktopX.tsx`.** Where the
interaction genuinely differs, one component changes presentation: `Sheet` is a bottom sheet on
compact and a centred dialog from `sm` up. `MonthGrid` is the calendar; `Calendar` is that grid
plus the month's own figures as a destination, while the wide layout renders `MonthGrid` straight
into the sidebar where navigation costs no taps at all. `You` is the account screen, a destination
on compact and the same component inside a `Sheet` on `lg`. `BottomNav` and `WeekStrip` are both
`lg:hidden` for that reason — on a wide screen they would repeat what the sidebar already shows.

**Every date grid draws the same cell.** `DayCell` owns what selected, today and has-entries look
like, and `WEEK_STARTS` is the one place the week begins on Monday; `useMarkedDays` is the one
place dots are loaded. Two grids disagreeing about which day starts the week is a bug you can see
from across the room, and it is exactly the kind that arrives by copy-paste.

**The calendar is navigation, so only one state is allowed to be loud.** The selected day is a
filled 28px disc; today is a ring; everything else is plain. It used to fill the whole 44px cell,
which made the selected day a solid block the width of the column — the loudest thing on a surface
whose only job is getting somewhere else, and in dark mode a slab of near-white. Two *filled*
cells would read as two selections, which is why today is a ring rather than a second fill. The
has-entries dot is neutral rather than a kind colour: a dot means something happened that day, not
that a note happened.

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
else secondary on a quieter line beneath — with the **clock one step forward of the rest of that
line**, `muted` against `faint`. Where a row carries a time, that time is what anchors it in the
day, and flattened in with the categories and repeat rules it read as one more tag. That
emphasis-in-place is the answer to the time gutter rather than a compromise with it: the gutter
stays out for the reason below, and the fact it would have carried is not lost. Then the one
number — money if the row has any, otherwise duration —
right-aligned, `tabular-nums`, and in `muted` at regular weight.

**A row is directly manipulable and says so without an icon.** Its button is inset past the page
gutter (`-mx-2 px-2 rounded-lg`) and takes `hover:bg-sunken active:bg-sunken`, so the feedback
reads as the row lighting up rather than as a box appearing round the title. The *separator* stays
on the wrapper: a rule that moved with the inset button would sit 8px wider than every other rule
on the screen, which is why `AnswerCard` grew a wrapper it did not previously need. And `w-full`
beside `-mx-2` is a bug rather than a shorthand — the box stays 100% wide and shifts 8px left, so
the highlight overhangs one side and falls short on the other; `w-[calc(100%+1rem)]` is the fix
wherever the button is not already a flex child. **The number is
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

**The day is the biggest thing on the screen, and used to be the same size as a placeholder.**
Every piece of text in the app sat between 12px and 16px, so `Today` in the header and `What
happened?` inside the box were identical in weight — nothing claimed to be the subject of the
screen. Size is the cheapest hierarchy there is and the header is one line, so it costs no
density: the rows are untouched. `AnswerCard` had already proved this, putting its number at
`text-3xl` over 12px working.

**And it is said in two parts, because one string could only be one size.** `dayLabel` packs the
relation and the date together — `Today`, `Sat, 30 Aug` — which is right for a tab title and for
an accessible name, and wrong for the largest line on the screen: at one size the weekday, the
date and the word "Today" all claim the same weight, so the header stated everything and
emphasised nothing. `dayEyebrow` and `dayTitle` split it, and `dayLabel` is untouched — every
control and every tab title that named a day still names it exactly as before.

The chevrons moved with it. Centred between two 44px arrows, the widest part of the header was
spent on the arrows and the date competed with them for the middle; paired on the right they are
one place to aim rather than two screen edges to cross, and on a phone they sit under the thumb.
The bell joins them, because what is coming is about the day and not about the app — which is what
the quiet row above, holding only the wordmark and the account, is for.

**The day's totals lead with the figures and let their names sit back**, the same shape an
answer's extras use. Flat 12px muted, that line was the quietest thing on screen while carrying
the only number that sums the day — *smaller than the per-row amounts it totals*, which is
exactly backwards. The count stays quiet, because it names the list rather than measuring it.

**The capture control is docked to the thumb on a phone and stays at the top on a wide screen.**
Sticky either way — capture is the whole product and the control must never scroll out of reach —
but on a 6.4in phone the top third is the hardest place to reach one-handed, and it is also where
the keyboard is not. Docked, the control rides up with the keyboard instead of leaving several
hundred pixels of dead space between the two; verified on the device. There is **one render site
and no `MobileQuickAdd`**: `main` is a flex column, so `order-last lg:order-none` swaps it, and
`QuickAdd` reverses its own two halves the same way so the answer and the examples stay *above*
the field rather than below the screen edge. The `pb` floor is a real number because
`env(safe-area-inset-bottom)` measures 0 in the Android WebView while the gesture bar is about
24px.

**Three destinations were already there and two of them were hiding, which is what bought the
bottom nav.** This app held "no bottom nav" as a rule for a long time and the rule was right while
there was one screen. There were not: the month was a sheet behind the date, the account was a
20px glyph in the quietest row on the phone, and Ask was a mode nobody finds without being told —
first behind a leading `?`, then behind a pill inside the capture control. `BottomNav` adds no
screen that did not exist; it stops three of them hiding, and gives the account a destination
instead of the least looked-at corner there is. The header pays for it by giving up that quiet
first row, which held a wordmark nobody needs on a screen they had to open the app to reach.

**What makes it affordable is that the bar stands down the moment there is something to log.** A
nav sitting over the box while you type would have cost a step in the one act this app exists for,
and no amount of discoverability buys that back. `QuickAdd` reports through `onTyping` whether the
field has anything in it; the nav unmounts and the control takes the whole bottom edge back. The
control is also present on three of the four destinations, so a line can be typed from anywhere
but You — which has no box deliberately, since a capture field under the settings is an invitation
to log the settings. This is the clause the exception rests on: weaken it and the nav stops being
worth its 60px.

**A wide screen has to be *put* on Today, not assumed to be there.** The nav is `lg:hidden`, so
nothing visible on `lg` can change the destination — which is exactly why the view never leaves
Today there, and exactly why *arriving* is a different question. A window dragged past 1024px
while on Calendar or You strands the reader on a screen with no nav to leave it, next to a sidebar
showing the same calendar. `App` watches the breakpoint with `matchMedia` and settles the view
back on Today whenever it matches. Found by emulating 1440px in the device's own WebView, which is
the only reason it was found at all: the unit tests stub `matchMedia` to `matches: false` and the
phone never crosses the breakpoint.

**The toast, the control and the nav are one block in flow, and that is what retired `--dock`.**
A toast over the control is not a cosmetic overlap — `Undo` and `Save` sat on top of each other
once and pressing one hit the other — and the answer for a while was a constant in `index.css`
that the toast subtracted from the bottom edge. The constant was the bug. It had to be re-derived
every time the bottom edge changed, it was wrong by exactly the two paddings holding the control
off the gesture bar the first time, and once the nav could come and go mid-entry no single value
could describe the edge at all: the honest version needed two numbers and a rule for which
applied, and that rule is the thing that keeps being got wrong. As siblings in one block — toast,
control, nav, in that order — clearing each other is not arithmetic anybody has to do. A sheet
still stacks above the toast: the overlay is `fixed z-40` and the block is `z-10`.

**The floor belongs to whatever is last in that block.** `FLOOR` in `App` is one written value and
it goes on the nav normally, on the control while the nav is down. One `pb` on the block itself
would sit *under* the bar's own background and leave it floating a centimetre above the gesture
bar; both of them carrying it would stack two safe-area insets on the handset that reports 48px.
Neither failure is visible from reading either component.

**The capture control is two rows, and its height never changes.** The parse preview lives
*inside* the field — a rule beneath what you typed, then how it parsed, with the mic or send
button on that same row. It used to sit outside and below, reserving its line whether or not it
had anything to say, which left about 90px of dead space above the first entry on every
populated day. It cannot simply collapse: it is a live region, and a line that changes height
makes the timeline jump on every keystroke. Inside the control the height is fixed by the
control, so nothing below it moves.

**The control is raised off the page rather than drawn on it.** `bg-raised` on a `surface` page, a
hairline `edge` and a 1px shadow — enough to be the strongest interactive thing on the screen and
the only one that can be found without looking, and not enough to become a floating card, which is
a thing this app has none of. Send fills once there is something to save: an outline arrow the
same weight as the mic beside it said "there is a button here" without saying that pressing it is
the thing you came to do.

**Asking is a destination on a phone and a toggle on `lg`, and one of those had to go where the
other could not.** It was reachable only by typing a leading `?`, which meant the box's second job
was invisible unless somebody told you the syntax; the `Log · Ask` pill inside the control said it
out loud, and then the nav said it louder still. So the pill is `hidden lg:flex` — on a wide
screen there is no nav and it is the only thing that can say the box has a second job, and it sits
*inside* the control because that row has to exist anyway and an empty strip inside a bordered box
reads as a rendering fault. `QuickAdd` takes `ask` as a prop and falls back to its own toggle; the
two can never disagree, because `ask` is only ever true on a screen that has a nav. **`?` still
works from Log** on both, because it costs nothing to keep and it is faster than reaching for a
control — the mode is how the behaviour is discovered, not the only way to reach it.

**Switching to Ask shows what Ask can answer, because a placeholder names the job
and not the capability.** The toggle made the second job discoverable and then
handed over a blank field, so the half of the app that answers questions was
reachable and unknowable at the same time. Three tappable questions sit under the
control while Ask is selected and the box is empty — the same move the empty day
makes for logging, the feature demonstrated rather than described. They are
deliberately **subject-free** (a period and a measure, nothing else): a
suggestion naming a merchant or a person answers "nothing found" on a log that
has never mentioned them, which is the worst possible introduction to the thing
being introduced. Tapping fills the box rather than submitting, exactly as the log
examples do — but here that *is* asking, since the answer computes as you type,
and the text stays put so the question can be edited into the next one. They are
gone the moment there is any text, so they never sit under a result, and the log
examples are held to Log mode so an empty day never shows two lists at once.

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

**The focus rule has exactly two exceptions and both live in `index.css` beside it**, so focus is
still decided in one file rather than negotiated per component. A `[role="dialog"]` takes no ring:
a sheet is focused so the keyboard starts inside it, not because it is something to act on, and
the global rule matches any `[tabindex]` — so every sheet opened with a 2px outline drawn round
the whole panel. And `#quick-add` hands its ring to `.capture`, the control it sits inside: the
field fills the top row of a bordered box, so the ring drew a box inside a box, and because the
field is autofocused that was the first thing anybody saw. Three rules do the handover, and their
order is the fallback — the ring is on for any focus inside the control, then taken off again
unless the field is what is keyboard-focused. Where `:has()` is unsupported the third rule is
dropped whole and the ring simply shows more eagerly. Louder, never absent, which is the only
direction this is allowed to degrade in.

**Decoration never shrinks a target.** `Log · Ask` is a 28px pill inside a 44px button and a day
cell is a 28px disc inside a 44px one — the same negative-margin trick the toast's buttons already
used. Making the box you can see the box you can hit is how 44px quietly becomes 32px.

## Data model

One table, `entries` ([supabase/migrations/0001_entries.sql](supabase/migrations/0001_entries.sql)).
Four kinds — `expense`, `time`, `event`, `note`. Do not add a fifth.

- **`amount_paise` is an integer. Money is never a float anywhere.** ₹347.50 is `34750`. It is
  *signed*, and that is not an accident: `rupees` prints a leading minus and `paiseFrom` reads one,
  so a refund is an expense of −₹50 rather than a fifth kind. The parser used to be the only layer
  that disagreed, dropping the sign and filing `-50 refund` as fifty rupees *spent* — the one
  money reading here that could be wrong without looking wrong. A minus is read only at the start
  of a word (`(?:^|\s)-`), or `covid-19 test 500` becomes minus nineteen rupees.
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
cannot run. The honest figure is ~138.6 KB gzipped for the main chunk, and **147.5 KB across
everything the page fetches**, against a 150 KB budget. The headroom is 2.5 KB, not the
comfortable margin the raw JS figure suggests — count the CSS and the lazy Capacitor chunks.

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

**Android's back button reaches nothing unless a plugin hands it over, and the default is to
dismiss the app.** Verified on a Pixel 7 emulator: with the editor open, BACK put the launcher in
front and left the sheet exactly where it was — the app was still running with a modal on screen.
Back is *the* dismiss gesture on Android, so this was the one platform convention the app broke.

**A history entry does not fix it**, which was worth establishing before building on it:
`targetSdkVersion` is 36, where `onBackPressed` is superseded by the predictive-back API and a bare
`BridgeActivity` registers no handler, so `pushState` followed by BACK still backgrounded the app.
`@capacitor/app` was added for its `backButton` event, and nothing else.

`src/lib/back.ts` holds the whole of it, and it now has three layers rather than two: **it closes
a sheet, then it comes home, then it minimises.** There is still no router here and nothing else
back could mean. `Sheet` registers its *own* `onClose`, the same function the scrim, the close
button and Escape already call, so there is one close path rather than a second copy of it — and
`HelpSheet`, `AheadSheet` and `EntryEditor` are all covered without knowing this exists.
Registered against a **ref**, not the prop: every caller passes an inline `() => setEditing(null)`,
which is a new function on each render, and the page re-renders on the 30-second clock tick.

**The middle layer arrived with the bottom nav, and without it leaving You would have dismissed
the app.** Three destinations became reachable in one tap, and back is how an Android reader
leaves any of them — the launcher in front of a still-running log is precisely the bug
`@capacitor/app` was added to fix, one screen further in. `onHome` is **one slot rather than a
stack**: there is exactly one home and the destinations do not nest. `App` registers it only while
`view` is not `today`, so what back means is decided by whether that slot is set and never by a
listener reading a `view` it closed over — the same failure the sheet stack avoids by splicing on
function identity rather than index, and the removal here is identity-guarded for the same reason.

**The order is what makes two presses read correctly.** Sheets stay on top, so the editor opened
from the calendar closes *onto* the calendar and only the next press comes home. Coming home first
would leave a sheet on screen over a screen it was never opened from.

Adding a `backButton` listener **takes the default away from Capacitor**, so the no-sheet case has
to be answered explicitly or back would do nothing at all on the timeline — a worse bug than the
one being fixed. It minimises, never exits: the log is on the device either way, but killing the
process is not what back means at the root of an Android app. `back()` is pure and exported for
exactly one reason — a test that needs an emulator is a test that does not run.

**Pressing back *asks* a sheet to close; it does not decide that it has.** The stack does not pop
itself. Deregistering belongs to the unmount, or a close that is refused or merely re-rendered
would leave a sheet on screen with nothing listening, which is the original bug one press later.

Verified on device, whole lifecycle: each of the four sheets and the editor closes and the app
stays foregrounded, focus returns to the control that opened it, the handler re-registers after a
save-and-reopen, and with nothing open the app minimises. **With the keyboard up the first BACK
closes the keyboard and the sheet stays** — the IME consumes it before the WebView ever sees it,
which is what every Android app does and is not something to work around.

**The Android status bar is not `theme-color`, and in light mode it does not match the page.**
`theme-color` is a browser meta; the native bar is painted by `Theme.AppCompat.DayNight.NoActionBar`
in `android/app/src/main/res/values/styles.xml`, and there is no `@capacitor/status-bar` plugin
here. On the emulator the WebView gets 412×839 of a 411×914 screen — the system bars are opaque
and outside it, which is also why both safe-area insets measure 0. The result is a dark band above
a paper-coloured page in light mode; dark mode has no seam because the two happen to agree.
Verified on a Pixel 7 / Android 16 emulator. Fixing it properly means following the *app's* theme
choice rather than the OS's, since the You screen lets the two disagree — a `values-night`
qualifier would get that backwards. Making the bar transparent instead is worse: the insets read
0 here, so the header would sit under the clock, which is the exact bug the safe-area padding
exists to prevent.

**A `sticky` element cannot reach past its container's padding, which is how a bottom bar comes to
float.** The page container carried `pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]` and the
bottom block is sticky *inside* it, so the nav sat 24px above the screen edge with page colour
underneath — a bar that does not touch the edge reads as a rendering fault rather than as a bar.
That padding is `lg:` only now, where the block is at the top and the timeline really does need it.
On compact the block owns the bottom edge and `FLOOR` is the only thing holding it off the gesture
bar. Found on the emulator; invisible in jsdom, which lays nothing out.

**A row whose height came from its contents loses it when the contents go.** The capture control's
second row was 44px because the `Log · Ask` buttons in it were `h-11`. Hiding the toggle on
compact — where the mode is a destination now — collapsed that row to 1px and took the control's
fixed height with it, 46px instead of 90: nothing else in the row has a height of its own, since
the preview is empty until you type and the send button only appears once there is something to
save, with no mic beside it on native. The row states `h-11` itself now. The control's height is
load-bearing enough to be written down rather than inherited.

**`env(safe-area-inset-bottom)` cannot be relied on either way in the Android WebView, so every
floor is a real number.** It was measured as **0** on the emulator: a bottom sheet padded with
`max(1rem, env(...))` got 16px against a gesture bar of about 24, and the sheet's own buttons sat
underneath it. On a Galaxy S21 FE it reads **48px** — read out of the live WebView via CDP, not
guessed — presumably because `targetSdk 35` draws edge-to-edge and the inset is now reported. Both
numbers are real on real devices, which is the point: `max(<a real number>, env(...))` is correct
in both worlds, and anything that trusts the inset alone is wrong on one of them.

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
  the password is set instead from the You screen via `updateUser`, from inside a session that
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
Capacitor (`core`, `android`, `local-notifications`, `app`). Ask before adding anything else.**
The original "four dependencies only" rule was retired deliberately when the Android app was
added, not broken by accident: Capacitor plugins are runtime dependencies, and each one was argued
for on its own — `local-notifications` because no web API can raise an alarm with the app closed,
`app` because Android's back button reaches nothing without it. The bar is unchanged for
everything else: no component library, no state manager, no data-fetching library, no icon
package; icons are inline SVG. Comments only where the *why* is unobvious. Plain, dense, fast UI: system
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

Added after the spec froze, on the owner's request: the month calendar (replacing an
invisible native date input), a **You screen** holding theme, export and sign out — which is
the settings screen the spec said not to build, and which is now one of four destinations in a
**bottom nav**, itself a reversal of a rule this file held for a long time — swipe-to-change-day,
dictation, and **On this
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
- **A guest log lives on one device and nothing backs it up.** That is the honest trade for
  opening straight into the text box, and the You screen says so in as many words — but losing
  the phone loses the log, and there is no prompt nagging anyone to sign in. `adopt` runs once, on
  the first sign-in; a guest who signs into a *second* account later has already had their log
  moved to the first.
- "On this day" is computed from the corpus fetched at launch, so backfilling an entry into a
  previous year does not appear there until the app is reloaded. Deliberate: refetching the whole
  log on every write would cost a round trip to keep a strip current that changes about never.
- A repeat can be removed from the editor now, but **only a yearly one can be put back** — a
  weekly rule needs its days and the parser is the only place those are expressed, so a standup
  cleared by mistake has to be retyped. Cancel covers it within the sheet.
- Deleting a row deletes the whole series, including from a derived occurrence on another day.
  Consistent with one-row storage, and undo covers a mistake, but nothing on the sheet says so.
- A repeat whose start is more than a week out arms one-offs for its first week rather than
  standing crons, because every weekday's cron would otherwise fire early. It converges on the
  first launch on or after the start date; Capacitor's cron has no start parameter.
- **Dictation is web-only, and that is the settled answer rather than a gap.** It uses the Web
  Speech API, which iOS Safari does not implement — and which Android's System WebView *exposes
  without implementing*: the constructor is there, and calling `start()` fails `not-allowed`
  whatever permissions are granted. Verified on a Galaxy S21 FE running Android 16, on the shipped
  build. So `useDictation` returns `supported: false` for anything native and `QuickAdd` hides the
  mic rather than offering a dead button. On Android the **keyboard's own microphone** already
  dictates into the capture box, which is the platform's way of doing this and costs no
  dependency, no `RECORD_AUDIO`, and no second permission state. A native speech plugin was
  considered and declined for exactly that reason.
- **The ceiling is ₹21,474,836.47, and it is refused rather than owed.** `amount_paise` and
  `duration_minutes` are Postgres `integer`, so a bigger number would be stored here, counted into
  the day and refused by the server for ever with `22003`. `format.ts` owns the bound
  (`amountFits` / `minutesFit`); the parser declines to read such a number as an amount, so the
  digits stay in the title as they do for any other number it cannot use, and the editor says why
  and will not save. Raising the ceiling is a `bigint` migration, not a change in either place.
- **A leap-day anniversary reminds you every four years.** That is what the date means and what
  the exported `FREQ=YEARLY` already does, and it is what `occurrencesOn` and `onThisDay` have
  always said. It is a limitation, not a bug — but the alternative would have been a clamping rule
  the `.ics` export would then contradict.
- The session lives in `localStorage`, so it is per-browser. Opening the magic link in a different
  browser than the one that requested it leaves the original signed out. This is not a bug.
