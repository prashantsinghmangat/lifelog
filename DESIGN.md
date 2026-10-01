# DESIGN.md

The rules for building UI in this app, written to be followed.

**This file is the *what*. [ARCHITECTURE.md](ARCHITECTURE.md) is the *why*** — it carries the bug each rule
came out of, and it is the one to read when a rule seems arbitrary or you want to change it. Where
the two disagree, ARCHITECTURE.md wins and this file is out of date.

Nothing here is a suggestion. Every item is either a token, a measurement or a pattern already in
the code, and a change that breaks one of them will look wrong beside the rest of the app.

---

## 1. The two rules everything else serves

**Capture is the product.** Logging an entry takes under five seconds. Anything that adds a step
to logging is a regression, however good it looks.

**Minimum interaction → maximum outcome.** Before adding a control, ask whether a default removes
it. Before adding a screen, ask whether the thing can be derived onto a screen that already
exists. Two of this app's features — the memories strip and the repeat occurrences — cost no
query, no page and no control, and that is why they were allowed in.

A corollary that comes up constantly: **do not add a fifth kind, a second editor, or a search
field.** The bottom nav and one chart each came off that list once, argued for on evidence; §10
records what each cost and what neither is allowed to grow into.

---

## 2. Colour

**Only semantic tokens. Never a raw grey, never a `dark:` variant.**

`src/index.css` defines the palette and a `[data-theme='dark']` block swaps the values, so one
class is correct in both themes. Writing `text-gray-500` produces something that looks fine in
light mode and is unreadable in dark — it is a bug, not a shortcut.

| Token | Use |
| --- | --- |
| `surface` | page background |
| `raised` | sheets, the capture control, anything sitting above the page |
| `sunken` | inset wells, row hover, the unselected track of a segmented control |
| `ink` | primary text, and the fill of a primary button |
| `muted` | secondary text, and a clock on a row |
| `faint` | tertiary text, eyebrows, icon strokes that must recede |
| `line` | hairline rules between rows |
| `edge` | borders of controls and inputs |
| `focus` | the global focus ring |
| `expense` `time` `event` `note` | the four kinds, and nothing else |

**Amber is the default because it is the mark's own palette.** `logo.svg` draws the day's spine
on a near-black tile with its nodes in the kind colours; Amber's dark block is that ground, so
the icon on the home screen and the app behind it finally match. Its light block keeps Paper's
character while gaining the accent hue Paper deliberately refuses.

**Warm paper is Paper's argument, and it stands where Paper stands.** A pure-white page with
blue-grey text reads as a form to fill in; the same layout on paper reads as something to keep,
which is what a personal record should be — off-white paper and warm charcoal, neither the other
inverted. That is why Paper exists; it is not why Amber is the default.

**Every text token clears 4.5:1 on every surface it can be placed on — surface, raised and
sunken.** `faint` used to be 2.9:1, which is what "tertiary" had quietly come to mean — and later
shipped at 4.4:1 on `sunken` because it had only ever been verified against `surface`, which is
how this rule earned its longer wording. A token that is only safe in some places is a trap, the
same class as the retired `--dock` constant. `edge` clears 3:1 on all three grounds — an input
boundary has to be findable — while `line` alone stays below: it separates, it does not inform,
and nothing in the app is legible only because of a border. All of it is computed in
`src/lib/contrast.test.ts`, never eyeballed.

**Seven palettes, selectable in You → Appearance, Amber the default.** Mode and palette are
orthogonal axes (`data-theme` × `data-palette`); every palette ships a light and a dark block so
System keeps resolving whichever is chosen. The single source is `src/lib/palettes.ts` — the CSS
blocks and the picker's swatches both come from it, kept equal by test. The four kind colours are
mode-only: a palette must not repaint what a kind means. `focus` is each palette's own, anchored
to its accent and checked at 3:1 on all three grounds like `edge` — it was a fixed blue, which
read as the browser's default ring on every non-blue palette, and text fields always match
`:focus-visible`, so on a phone that ring is a constant companion of the capture box and has to
read as the app's. Paper is the original warm palette, preserved; Graphite and Sea are deliberate
cool departures a reader opts into; Mint is the Stitch mocks' own colour world, its light block
read straight from the mock token table (spec 019) and its dark block derived here.

**The four kind colours are scanning accents, not four UI colours.** Deep enough to read as ink
with a hue rather than as a highlight — carried by the timeline's tinted kind badge and by the
15px `KindMark` in the compact lists. They mark a row so the expenses can be found at a glance;
they are not allowed to compete with the title they are marking.

Usage in the code today: `text-faint` 57, `text-muted` 41, `text-ink` 41. **Most text in this app
is not full-strength ink**, and that is deliberate — the hierarchy is carried by how far back
things sit.

**Never interpolate a Tailwind class.** ``className={`text-${kind}`}`` compiles to nothing, because
Tailwind only emits classes it can literally see. Kind colours go through a written-out
`Record<Kind, string>` map. This is why `KindMark` and `EntryEditor` each carry a `TINT` object.

**Classes in a non-`.tsx` file are never compiled.** `index.css` pins
`@import 'tailwindcss' source(none)` plus `@source './**/*.tsx'`.

---

## 3. Type

The scale is narrow on purpose. `text-xs` and `text-sm` are the overwhelming majority of the sizes
in use; the large ones are single occurrences, and that is what makes them read as emphasis.

| Size | Where |
| --- | --- |
| `text-3xl` | the answer's lead number — the one figure a question returns |
| `font-display text-[26px]` / `text-[21px]` | the day header's two serif lines — the subject of the screen, and the only lines allowed this size (021) |
| `text-base` | anything a finger types into; **never** for display text |
| `text-sm` | row titles, button labels, values that matter |
| `text-xs` | secondary lines, captions |
| `text-[0.6875rem]` | eyebrows only — see below |

**`--font-display` is a system serif stack** (`Iowan Old Style`, Charter, Palatino, Georgia) —
no webfont, so it costs the bundle nothing. It belongs to the Variant-E editorial voice: the day
header and the ledger's display figures. Body text stays the system sans. Plus Jakarta Sans was
considered for the mocks and declined on budget (spec 019).

**One thing per screen is allowed to be big.** The timeline's is the date; an answer's is its
number. Before enlarging anything else, check what it would be competing with.

**`text-base` on inputs is not a style choice.** iOS Safari zooms the page on focus for anything
under 16px.

**There is one eyebrow, and it is written the same way everywhere:**

```
text-[0.6875rem] font-semibold tracking-[0.1em] text-faint uppercase
```

Where an eyebrow heads a **section** it also carries the grouping space: 26px above, 10px below.
The gap above a section must be visibly larger than the gaps inside it — that is what makes
grouping read at all.

`HORIZON BALANCE`, `ON THIS DAY`, `COMING UP`, `EDIT ENTRY`, an answer's caption, a day
heading inside an answer, and the name each destination that is not a day gives itself. **The one
exception is the bottom nav's four labels**, which are 11px sentence-case rather than eyebrows —
confined to that bar and nowhere else. 11px with the letters opened up reads as a label rather than as small
body text, which is what stops a caption being mistaken for the first line of the thing it
captions. Field labels in a sheet use `tracking-[0.08em]`, since they sit directly on their input.

**Titles are `leading-snug`.** Two lines of a note at default leading run together with the
secondary line under them; a title is the one place the app sets type tighter than the browser
would.

**Figures lead, their names sit back.** The day totals and an answer's extras both read as values
with labels attached rather than as a sentence:

```tsx
<span className="text-sm font-medium text-ink tabular-nums">{rupees(spent)}</span> spent
```

**`tabular-nums` on every number that sits in a column or changes in place.**

---

## 4. Layout

**One component tree, three layouts.** Breakpoints are compact (`<640`), medium (`sm`), wide
(`lg`, `≥1024`) — never device-specific. There are 15 `lg:` and 7 `sm:` prefixes in the whole app.

**Never create `MobileX.tsx` / `DesktopX.tsx`.** Where the interaction genuinely differs, one
component changes presentation:

- `Sheet` is a bottom sheet on compact, a centred dialog from `sm`.
- `MonthGrid` is the calendar; `Calendar` is a destination holding that grid and the `Stats`
  chart behind a Grid | Chart toggle, while the wide layout renders `MonthGrid` straight into the
  sidebar. **The stats are compact-only, as a decision rather than an oversight** — the wide
  layout gained no destinations, and a wide answer will be designed on its own if wanted.
- `You` is the account screen. It is a destination on compact and the same component inside a
  `Sheet` on `lg`, opened from the sidebar — one component, two surfaces.
- `BottomNav` is `lg:hidden`, and `WeekStrip` is too, because on a wide screen the sidebar already
  shows the month.
- The capture control docks to the bottom on compact and sits at the top on `lg` — **via flex
  `order`, one render site**. See §6.

### The four destinations

`view` in `App` is `'today' | 'calendar' | 'ask' | 'you'`. **State, not a route** — there is no
router here and nothing to put in one. It lives inside `Day`, beside `day`, so that switching
destination cannot remount `useEntries`: going to You and back must not refetch the log and must
not lose the day being read.

| Destination | Capture control | What is on it |
| --- | --- | --- |
| Today | yes, Log | the serif day header, the week strip card, the balance card, the epoch cards, the memories |
| Calendar | yes, Log | a Grid \| Chart toggle: the metric ribbon + `MonthGrid` + day peek, or the `Stats` chart |
| Ask | yes, **Ask** (box ordered first) | the topic-group cards, or the answer card |
| You | **no** | account, appearance, prompts, permission, App Lock (native), exports, the manual |

- **The control is on three of the four**, which is what keeps the nav from costing anything:
  logging is one tap from anywhere but You.
- **The bar stays up, including while the field has text.** It used to stand down on any text,
  which made it flicker on every entry and, in Ask, took away the only way off the screen at the
  moment an answer arrived. This is the rule that lets a
  nav and a five-second capture share one edge — do not weaken it.
- **On `lg` the view never leaves `today`**, because nothing visible there can change it. The nav
  is hidden, the sidebar owns the calendar and the account, and the control keeps its own
  `Log · Ask` toggle (`hidden lg:flex`). The wide layout gained no destinations.
- **Arriving wide is a different question from being wide**, and it needs a `matchMedia` watcher.
  A window dragged past 1024px while on Calendar or You strands the reader on a screen with no nav
  to leave it, beside a sidebar showing the same calendar. `App` watches the breakpoint and puts
  the view back on Today when it matches. Seen at 1440px, not reasoned about.
- The top chrome row's title names the screen (020); each destination keeps its own biggest
  thing, so no screen name claims a headline size of its own.
- The live nav item carries `aria-current="page"`, and an `sr-only` live region announces the
  destination on a change. Colour and weight alone do not say which one you are on.

### The header

Two layers on a phone since the mock clone (020/021); one serif line pair on a wide screen.

```
[L] Today                              [search] [avatar]     ← app chrome, compact only
Wednesday, 30                              Week 40  [bell]
September
```

The top chrome row is compact-only and every control on it is wired — the wordmark tile names
the app, search opens Ask, the avatar opens You. It reverses the nav-era removal of the quiet
first row, as a wired return rather than a wordmark (020). The day itself is said editorially in
the serif display stack: weekday and italic day number, the month italic and stepped back
beneath, the ISO week at the right with the bell (021). **The chevrons are gone** — swiping, the
week strip, the keyboard arrows and the calendar all still step days, and the pair of 44px
targets spent the widest part of the header on the one gesture that had four other routes.
`dayLabel` still packs the relation and the date into one string for the tab title and the
date's accessible name, and must keep doing so.

**The week strip is a raised card of seven cells of its own** — letter, number, dot; the
selected day an accent-filled pill, today accent-inked when not selected. It stopped sharing
`DayCell` in 021: the strip's anatomy genuinely diverged from the month grid's disc, and one
component bent to serve both is how they would drift. `DayCell` is the month grids' alone now.

**On a phone the date opens the Calendar destination; on `lg` it is a label and nothing else.**
The sidebar has held the whole month at no taps since long before the nav existed, and a second
route to something already on screen is a control that has to be explained.

**Every month grid draws the same cell.** `DayCell` owns what selected / today / has-entries
look like for the month sheet and the sidebar calendar (the week strip has its own cells — see
above). `WEEK_STARTS` is the one place the week begins on Monday. `useMarkedDays` is the one
place dots are loaded. Two grids disagreeing about the first day of the week is visible from
across the room and arrives by copy-paste.

**The cell is a 44px target with a 28px disc inside it.** Filling the whole cell made the selected
day a solid block the width of the column — the loudest thing on a surface whose only job is
navigation, and in dark mode a slab of near-white. Three states, three strengths, and only one is
filled: selected is `bg-ink`, today is a `border-edge` ring, everything else is plain. Two filled
cells read as two selections. The has-entries dot is neutral (`bg-faint`), not a kind colour — a
dot means something happened, not that a *note* happened.

---

## 5. Component anatomy

### A row

The timeline's row is the ledger (`EntryRow`, 021) — it retired the Today spine and the
timeline's 15px kind mark, and a `boxed` variant gives up its own border and gutter bleed when
an epoch card already draws them. **The compact lists keep the 15px `KindMark`** — an answer's
rows, the bell, the memories strip, the day peek, the empty-day examples. The split is the old
spine exception inverted and it is still on purpose: the ledger's clock column means *one day,
in order*, which is true of the timeline and false of an answer spanning four months. Do not
"fix" it in either direction.

```
[ 9:15 am ] [EXPENSE] in 47m · repeat · category       [ one number ]
 w-14 col    badge                                      or `completed`
            [ title, two lines max                   ]
```

- **The time column leads, blank where a row carries no clock.** The left gutter the old row
  refused ("empty on most rows buys a 56px indent for nothing") is taken knowingly — the
  two-tone ledger is built on the clock column, and the trade is recorded in the row's own
  comment (021). An event still ahead carries its time in `font-semibold text-ink`; everything
  else `text-faint tabular-nums`.
- **The kind badge is a tinted pill naming the kind in its own colour** (`bg-<kind>/10
  text-<kind>`, written-out map). It is `aria-hidden`; the `sr-only` kind name beside it stays,
  so the kind is said once and never carried by colour alone.
- **`in 47m` sits beside the clock, never instead of it** — the one coloured piece of text on a
  row, for an event still ahead today. `until()` in `format.ts`, recomputed on the global
  30-second tick.
- **Metadata line is `text-[0.6875rem] text-faint`, joined with ` · `**, built by filtering nulls
  out of an array — repeat label, category, off-day relation, sync state in words (`saved here,
  not synced` / `the server refused this`). No empty separators.
- **Title below, `line-clamp-2 leading-snug`.** One line with an ellipsis told you an entry
  existed and not what it was, and the longest titles are notes where the words *are* the content.
- **Never write `block` beside `line-clamp-2`.** The clamp needs `display:-webkit-box` and `block`
  wins the cascade, so the clamp silently does nothing.
- **The number comes from `rowValue()` in `format.ts`** — `text-sm font-semibold text-ink
  tabular-nums`, right-aligned. Do not recompute it.
- Struck through (`line-through text-muted`) when `behindYou()` — the moment passed, or it was
  ticked off; a done event also carries a sunken `completed` chip, for the glance that never
  reaches the title.

### Today's day structure

The day renders as up to two raised **epoch cards** — Daylight (timed rows before 6pm) and
Evening (6pm onward, plus untimed rows, which already sort last — the split is a prefix, so
concatenation never reorders the day). Headers carry a sun/moon glyph, the name and `n logs`;
the passed-fold stays at the top of the first card. The **now pill** (`● 7:12 PM now` + fading
rule) renders inside whichever card holds the moment, or as the full `NIGHT HORIZON` banner only
when the moment sits exactly on the boundary between two non-empty cards; absent off-today. The
**balance card** under the week strip (`HORIZON BALANCE`, tri-colour track, SPENT / FOCUS /
SCHEDULE columns) replaced the old totals line: money and minutes sum stored rows (the repeat
rule), while the counts and the track count what the day *shows*, occurrences included.

**A row is directly manipulable, and says so without an icon.** The button is inset past the page
gutter — `-mx-2 px-2 rounded-lg` plus `w-[calc(100%+1rem)]` where it is not a flex child — with
`hover:bg-sunken active:bg-sunken`. The highlight then reads as the row lighting up rather than as
a box appearing around the title. `w-full` beside `-mx-2` is a bug: the box stays 100% wide and
simply shifts 8px left, so the highlight is lopsided.

**The separator stays full width.** It goes on the wrapper, never on the inset button — a rule
that moved with the button would sit 8px wider than every other rule on the screen. In `EntryRow`
the wrapper already exists; in `AnswerCard` one was added for exactly this.

Tailwind v4 gates `hover:` behind `@media (hover: hover)`, so a hover state does not stick to a
row after a tap on a phone. No `@media` wrapper of your own is needed.

### A card

One recipe everywhere since the fidelity pass (018): `rounded-2xl border border-line bg-raised`,
**no shadow** — the capture control keeps the app's only shadow, and a second raised object
competing with it is exactly what a floating card would be. Epoch cards, the week strip, the
balance card, chart cards, topic groups, the answer and You's groups all use it.

### A segmented control

One component, `Segmented`: a 40px `sunken` track (radius 11, 3px padding) holding 34px
`raised` pills (radius 8). At ~68px the old per-screen versions were taller than the 52px rows
beside them, which is most of why controls looked inconsistent between screens. Each button is
still `h-11` by negative margin — the pill is decoration inside the target.

### An answer

A raised card — an explicit reversal of 016's "banded, not boxed", recorded in the component
header (018): the card grammar re-took the boundary job the `border-y` rules were doing.
Conclusion first — the question echoed, the `text-3xl` lead on a tinted inner panel, a labelled
category-distribution bar (single-hue opacity ramp, never the kind palette), the honest
`From your log · n` badge, extras, then the rows grouped under day headings, with one follow-up
pill under a money/hours `this <period>` answer that refills the box with the shifted question —
a refill, never an action.

### A sheet

**`Sheet` owns modal correctness** — focus moves in, is trapped, returns to the trigger, Escape
closes, **Android's back button closes**, body scroll locks. Any new modal goes through it rather
than reimplementing an overlay.

- **Back is wired in `Sheet`, not per sheet.** It registers the sheet's own `onClose` with
  `lib/back.ts`, so there is one close path and every sheet gets it for free. Registered against a
  ref rather than the prop, because `onClose` is an inline arrow at every call site and the page
  re-renders on the clock tick. **Beneath the sheets sits one more layer**: away from Today, back
  returns to Today, registered by `App` through `onHome` only while there is somewhere to come back
  from. Sheets first, then home, then minimise — so the sheet opened from a destination closes
  *onto* that destination. Adding the listener takes the default away from Capacitor, so the root
  case has to be answered rather than left to fall through. Do not add a second back handler
  anywhere.

- Focus lands on the **dialog**, not its first control. Focusing the first button draws a focus
  ring on `Expense` every time the editor opens, which reads as a claim about the entry.
- Actions are `sticky bottom-0` inside the scroll area, so the fields scroll behind them.
- A sheet stacks **above** the toast. At a lower z-index a message still on screen sat over Save,
  and `elementFromPoint` confirmed the tap hit the toast — pressing Save restored a row you had
  just deleted.

### A toast

Three ways out — close button, sideways swipe, timer — and two lifetimes: 6s when it carries an
action, 3s when it only reports. **Undo, not confirmation**: reversible actions happen immediately
and offer `Undo`. Do not add "are you sure?" to a normal delete.

---

## 6. The bottom block

On compact the bottom edge of the screen is **one block, in flow, in this order**:

```
toast            ← when there is one
capture control  ← fixed height, absent on You
bottom nav       ← lg:hidden, and it stays up while the field has text
```

On `lg` the block collapses to the top of the column via flex `order` and the nav is hidden.
**On Ask the block turns `display: contents`** so the box orders itself first on the screen, the
toast and nav keep the bottom, and the nav alone carries the floor — the 019 reorder, done with
no new mechanism and no height constant.

**There is no `--dock`, and re-introducing one is the wrong fix.** The toast used to be `fixed` at
the bottom and subtract a constant from `index.css` to clear the control, because a message over
that control put `Undo` where `Save` is and the tap hit the wrong one. The constant had to be
re-derived every time the bottom edge changed, it was wrong by two paddings the first time, and
once the nav could come and go mid-entry one value could no longer describe the edge at all. As
siblings the two cannot overlap, and nothing has to be kept in agreement.

**The floor belongs to whatever is last in the block.** `FLOOR` in `App` is one written value —
`pb-[max(0.75rem,env(safe-area-inset-bottom))]` — and it goes on the nav normally, on the control
which is always last in the block. Two elements both carrying it would stack two safe-area insets on the
handset that reports 48px; one `pb` on the block itself would sit *under* the bar's own background
and leave it floating a centimetre off the gesture bar.

Other invariants here:

- **The control's height never changes.** The parse preview lives *inside* the field precisely so
  that a live region changing height cannot make the timeline jump on every keystroke. If nav work
  ever makes the control taller, shorter or variable, the work is wrong.
- **It is `bg-raised` on a `surface` page, with a hairline `edge` and a 1px shadow.** This is the
  strongest interactive thing on the screen and the only one that has to be found without looking.
  A bigger shadow would make it a floating card; the app has none of those. **The nav takes no
  shadow at all** for the same reason — a second raised object competing with the control is
  exactly what a floating bar would be.
- **The control carries `class="capture"`, which `index.css` reads.** The focus ring goes round the
  control, not round the field nested inside it — see §7.
- **One slot: the mic while the box is empty, send once there is something to save.** The mic
  sits in an accent disc (Variant E, 021); send takes its place filled, because an outline arrow
  the same weight as the mic said "there is a button here" without saying that pressing it is the
  thing you came to do. The dock's hint line is three tappable example chips that fill the box
  (44px targets inside the row's own height).
- **`Log · Ask` is a 28px pill inside a 44px button, and it is `hidden lg:flex`.** On a phone the
  mode is a destination; the toggle survives for `lg`, where there is no nav and it is the only
  thing that can say the box has a second job. `QuickAdd` takes `ask` as a prop and the two can
  never disagree, because `ask` is only ever true on a screen that has a nav.
- **The extras render above the field on compact**, below it on `lg` — again by flex `order`, so
  the answer and the examples are never pushed off the bottom of the screen.
- **`pb` floors are real numbers, not bare `env()`.** `env(safe-area-inset-bottom)` measures 0 on
  some Android WebViews and 48px on others. `max(0.75rem, env(...))` is correct in both.

### The bottom nav

60px tall plus the floor. `bg-raised`, `border-t border-line`, no shadow.

- Four items, each a `<button>` filling a quarter of the bar: a 20px inline SVG at stroke 1.8, a
  3px gap, then an 11px label. At 60 by roughly 97 they clear 44px in both directions comfortably.
- **The live item** is `font-semibold text-accent` behind a 56×28 accent-tint pill
  (`bg-accent/10`); the rest are `text-faint`. The pill is decoration inside the target, never
  instead of it — the same discipline as the day cell's 28px disc inside its 44px cell.
- 11px (`text-[0.6875rem]`) is used here as a plain label rather than as an eyebrow. It is the one
  exception to §3's rule, and it is confined to this bar.
- No per-component focus styles. The one global `:focus-visible` rule covers it.

## 7. Targets, motion, accessibility

**Accessibility is a build requirement, not a pass at the end.**

- **44px targets.** `h-11` everywhere. A list row uses `min-h-12` (48px), and the timeline's own
  row `min-h-[3.25rem]` (52px), because it carries two lines of text. Use a negative margin to keep
  a target 44px without inflating its container (`-my-2 h-11`, as the toast's buttons do).
  **Decoration never shrinks the target**: `Log · Ask` is a 28px pill inside a 44px button, a day
  cell a 28px disc inside a 44px one. Making the box you can see the box you can hit is how 44
  quietly becomes 32.
- **One global `:focus-visible` outline** in `index.css`, so no component can forget it. Do not
  add per-component focus styles. There are exactly two exceptions, and both live in that same
  file rather than in a component:
  - `[role="dialog"]` takes no ring. A sheet is focused so the keyboard starts inside it, not
    because it is something to act on, and the global rule matches any `[tabindex]` — so a 2px
    outline was drawn round the whole sheet every time one opened.
  - `#quick-add` hands its ring to `.capture`, the control it sits in. The field fills the top row
    of a bordered box, so a ring round the field drew a box inside a box on every launch. Three
    rules do it, and the order is the fallback: the ring is on for any focus inside the control,
    then taken off again unless the field is what is keyboard-focused. Where `:has()` is
    unsupported the third rule is dropped whole and the ring shows more eagerly — louder, never
    absent.
- **Meaning is never carried by colour alone.** The kind icon is `aria-hidden` and an `sr-only`
  kind name sits beside it. Same pattern for done/passed state.
- **`prefers-reduced-motion` is honoured globally.** One 100ms fade on new rows and the sheet
  entrance; nothing else is animated. Do not add a transition without checking that block.
- Live regions: `role="status" aria-live="polite"` for the parse preview and the toast. An answer
  is announced as one sentence by `phrase()`, not walked through as a table.

---

## 8. Empty states teach

**A day with nothing on it demonstrates the parser rather than describing it.** Three faded rows
carry the line to type and what it becomes — `350 lunch swiggy` → *becomes an expense · ₹350 ·
food* — drawn like the entries they would turn into. Tapping one fills the box so the next move is
editing something real.

**Switching to Ask does the same for questions.** Topic-group cards (Spending, Deep Focus,
Events — 017/020) hold tappable questions that are deliberately **subject-free** — a suggestion
naming a merchant answers "nothing found" on a log that has never mentioned them, which is the
worst possible introduction to the feature being introduced.

The pattern to copy: *show the transformation, fill the input rather than submitting, and never
suggest something that can come back empty.*

---

## 9. Checklist for a UI change

1. Does it add a step to logging? If yes, stop.
2. Could a default remove the control entirely?
3. Semantic tokens only — no raw greys, no `dark:`, no interpolated class names.
4. Does anything else on the screen already claim the largest size?
5. 44px targets, `sr-only` text beside any icon carrying meaning.
6. One component, `sm:`/`lg:` variants — not a second component.
7. If it touches the bottom edge on compact: is it inside the bottom block, and does exactly one
   element still carry `FLOOR`?
8. `npx tsc -b` and `npm test` both clean. There is no linter; `tsc` is the gate.
9. If the change is visual, **look at it on a device**. Three of this app's UI bugs were invisible
   in tests and obvious in a screenshot.

---

## 10. Do not add

No component library, no state manager, no data-fetching library, no icon package — icons are
inline SVG on a 24-box stroked with `currentColor`. Runtime dependencies are `react`, `react-dom`,
`@supabase/auth-js` + `@supabase/postgrest-js`, `date-fns`, Capacitor, and the two native
security plugins argued for in spec 023 (`@aparajita/capacitor-biometric-auth`,
`@capacitor/privacy-screen`). **Ask before adding anything else.**

No dashboard, no tabs, no search field, no tag UI, no category manager, no multi-day view, no
second editor, no fifth kind, no "are you sure?" dialog, no onboarding carousel, no skeleton
spinner where placeholders will do.

**"No charts" was here and came off for exactly one screen.** What earned the exception: the
stats view needs no query — the whole log is already on the device — no new table, no fifth kind
and no settings, and it lives inside the Calendar destination as a Grid | Chart toggle rather
than as a fifth place to go. All of its arithmetic is in `stats.ts`, pure and tested exactly like
the parser; the component turns numbers into pixel heights and nothing else. What it is **not
allowed to grow into**: a second screen, a filter UI, a goal, a budget, a streak, or an insight.
Each of those turns a record into a scoreboard, and any one of them must be argued for on its
own in ARCHITECTURE.md the way the other exceptions were. **A comparison to the period before
was on that list and came off it** in the Stitch revamp (spec 017) — an explicit product
decision, recorded rather than argued. Its whole licence is the headline's badge: computed in
`growthPercent` from stored rows or absent, one figure with no target, trend line or streak
beside it.

**"No bottom nav" was on that list and came off it.** What earned the exception is that three of
the four destinations already existed and were reachable only by knowing something: the month was
a sheet behind the date, the account was a 20px glyph in the quietest row on the screen, and Ask
was a mode you had to be told about. Nothing new was added; three things stopped hiding. What it
cost is 60px of the bottom edge and the header's quiet first row, which is where the wordmark and
the account used to live. What it did **not** cost is a step added to logging — the control is on
three of the four destinations. That last
clause is the whole licence. A nav that stayed up over the box would not have earned it.

The app is still one text box. Most UI work here is deciding what *not* to put on it.
