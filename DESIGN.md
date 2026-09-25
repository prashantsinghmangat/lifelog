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

**The palette is warm in both themes, and that is the decision the rest hangs off.** Light mode
is off-white paper with a near-black warm ink; dark mode is warm charcoal with a warm off-white —
not the light palette inverted. A pure-white page with blue-grey text reads as a form to fill in;
the same layout on paper reads as something to keep, which is what a personal record should be.

**Every text token clears 4.5:1 on the surface it sits on.** `faint` used to be 2.9:1, which is
what "tertiary" had quietly come to mean. `line` and `edge` are deliberately below that: they
separate, they do not inform, and nothing in the app is legible only because of a border.

**The four kind colours are scanning accents, not four UI colours.** Deep enough to read as ink
with a hue rather than as a highlight, at 15px in a 20px gutter. They mark a row so the expenses
can be found at a glance; they are not allowed to compete with the title they are marking.

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
| `text-[1.375rem]` / `sm:text-2xl` | the day's date, the subject of the screen |
| `text-base` | anything a finger types into; **never** for display text |
| `text-sm` | row titles, button labels, values that matter |
| `text-xs` | secondary lines, captions |
| `text-[0.6875rem]` | eyebrows only — see below |

**One thing per screen is allowed to be big.** The timeline's is the date; an answer's is its
number. Before enlarging anything else, check what it would be competing with.

**`text-base` on inputs is not a style choice.** iOS Safari zooms the page on focus for anything
under 16px.

**There is one eyebrow, and it is written the same way everywhere:**

```
text-[0.6875rem] font-medium tracking-[0.1em] text-faint uppercase
```

`TODAY` over the date, `ON THIS DAY`, `COMING UP`, `TRY ASKING`, an answer's caption, a day
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
| Today | yes, Log | the day header, the week strip, the timeline, the totals, the memories |
| Calendar | yes, Log | a Grid \| Chart toggle: `MonthGrid`, or the `Stats` chart |
| Ask | yes, **Ask** | whatever the control draws — the answer, or `TRY ASKING` |
| You | **no** | the account, theme, prompts, permission, exports, the manual |

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
- The three that are not a day name themselves in an **eyebrow**, not a headline. The nav already
  says which one is live, and each screen has something of its own that deserves the size.
- The live item carries `aria-current="page"`, and an `sr-only` live region announces the
  destination on a change. Colour and weight alone do not say which one you are on.

### The header

One row on a phone, one on a wide screen.

```
TODAY                                    [bell] [<] [>]
15 September
```

The eyebrow says which day relative to now, the date below it is the thing itself — `dayEyebrow`
and `dayTitle` in `format.ts`. `dayLabel` still packs both into one string for the tab title and
the date's accessible name, and must keep doing so. The chevrons are paired at the right: stepping
a day is a repeated gesture, and two targets side by side are one place to aim rather than two
screen edges to cross.

**The quiet row above it is gone, and that is what paid for the nav.** It held the wordmark and a
20px account glyph: it named the app on a screen nobody reaches without opening the app, and hid
the account in the least looked-at corner there is. Both belong to the nav now.

**On a phone the date opens the Calendar destination; on `lg` it is a label and nothing else.**
The sidebar has held the whole month at no taps since long before the nav existed, and a second
route to something already on screen is a control that has to be explained.

**Every date grid draws the same cell.** `DayCell` owns what selected / today / has-entries look
like. `WEEK_STARTS` is the one place the week begins on Monday. `useMarkedDays` is the one place
dots are loaded. Two grids disagreeing about the first day of the week is visible from across the
room and arrives by copy-paste.

**The cell is a 44px target with a 28px disc inside it.** Filling the whole cell made the selected
day a solid block the width of the column — the loudest thing on a surface whose only job is
navigation, and in dark mode a slab of near-white. Three states, three strengths, and only one is
filled: selected is `bg-ink`, today is a `border-edge` ring, everything else is plain. Two filled
cells read as two selections. The has-entries dot is neutral (`bg-faint`), not a kind colour — a
dot means something happened, not that a *note* happened.

---

## 5. Component anatomy

### A row

Every row draws the same way wherever it appears — timeline, answer, bell, memories.

```
[kind mark 20px] [ title, two lines max              ] [ one number ]
                 [ 9:15 am · in 47m · repeat · category ]
```

- **Title first, `line-clamp-2 leading-snug`.** One line with an ellipsis told you an entry
  existed and not what it was, and the longest titles are notes where the words *are* the content.
- **Never write `block` beside `line-clamp-2`.** The clamp needs `display:-webkit-box` and `block`
  wins the cascade, so the clamp silently does nothing.
- **Secondary line is `text-xs text-faint`, joined with ` · `**, built by filtering nulls out of an
  array. No empty separators.
- **The clock is a step forward of the rest of that line** — `text-muted tabular-nums` against
  `text-faint`. Where a row carries a time, that time is what anchors it in the day; flattened in
  with the categories and repeat rules it read as one more tag.
- **The number is metadata, not the headline**: `text-sm text-muted tabular-nums`, right-aligned,
  regular weight. It comes from `rowValue()` in `format.ts` — do not recompute it.
- **No left-hand time gutter.** `occurred_at` is optional, so a time column is empty on most rows
  and buys a 56px indent for nothing. That is why the clock is emphasised *in place* rather than
  pulled into a column.
- Struck through (`line-through text-muted`) when `behindYou()` — the moment passed, or it was
  ticked off.

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

### An answer

Banded, not boxed: `border-y border-edge`, then conclusion first — an uppercase caption, the
`text-3xl` lead, its extras, and only then the rows, grouped under day headings. **The closing
rule is load-bearing** — without it the last row of the answer and the first row of the day read
as one list.

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
bottom nav       ← lg:hidden, absent while the field has text
```

On `lg` the block collapses to the top of the column via flex `order` and the nav is hidden.

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
- **Send is filled once it is live** (`bg-ink` disc), the mic is not. An outline arrow the same
  weight as the mic beside it said "there is a button here"; it did not say that pressing it is
  the thing you came to do.
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
- **The live item** is `font-medium text-ink` behind a 60×30 `bg-sunken` pill; the rest are
  `text-faint`. The pill is decoration inside the target, never instead of it — the same discipline
  as the day cell's 28px disc inside its 44px cell.
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

**Switching to Ask does the same for questions.** Three tappable questions, deliberately
**subject-free** — a suggestion naming a merchant answers "nothing found" on a log that has never
mentioned them, which is the worst possible introduction to the feature being introduced.

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
`@supabase/supabase-js`, `date-fns` and Capacitor. **Ask before adding anything else.**

No dashboard, no tabs, no search field, no tag UI, no category manager, no multi-day view, no
second editor, no fifth kind, no "are you sure?" dialog, no onboarding carousel, no skeleton
spinner where placeholders will do.

**"No charts" was here and came off for exactly one screen.** What earned the exception: the
stats view needs no query — the whole log is already on the device — no new table, no fifth kind
and no settings, and it lives inside the Calendar destination as a Grid | Chart toggle rather
than as a fifth place to go. All of its arithmetic is in `stats.ts`, pure and tested exactly like
the parser; the component turns numbers into pixel heights and nothing else. What it is **not
allowed to grow into**: a second screen, a filter UI, a goal, a budget, a streak, a comparison to
last month, or an insight. Each of those turns a record into a scoreboard, and any one of them
must be argued for on its own in ARCHITECTURE.md the way the other exceptions were.

**"No bottom nav" was on that list and came off it.** What earned the exception is that three of
the four destinations already existed and were reachable only by knowing something: the month was
a sheet behind the date, the account was a 20px glyph in the quietest row on the screen, and Ask
was a mode you had to be told about. Nothing new was added; three things stopped hiding. What it
cost is 60px of the bottom edge and the header's quiet first row, which is where the wordmark and
the account used to live. What it did **not** cost is a step added to logging — the control is on
three of the four destinations. That last
clause is the whole licence. A nav that stayed up over the box would not have earned it.

The app is still one text box. Most UI work here is deciding what *not* to put on it.
