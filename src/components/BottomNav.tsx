import { AskIcon, CalendarIcon, PersonIcon, TodayIcon } from './Icons'

export type View = 'today' | 'calendar' | 'ask' | 'you'

/**
 * Four destinations along the bottom edge.
 *
 * This reverses a rule the app held for a long time — one screen, no bottom nav
 * — and what earned the reversal is that three of the four already existed and
 * were reachable only by knowing something. The month calendar was a sheet
 * behind the date, the account was a 20px glyph in the quietest row on the
 * screen, and Ask was a mode you had to be told about: it lived behind a leading
 * `?` first and then behind a pill inside the capture control, which is the one
 * place a second job is easy to miss. None of them were new; all three were
 * hiding.
 *
 * The cost is the bottom 60px of a phone, and it is paid back in the same place:
 * the header gives up its own quiet first row, which held only the wordmark and
 * the account, and the account now has a destination instead.
 *
 * **What is not paid is a step added to logging.** The capture control is
 * present on three of the four, so a line can be typed from anywhere but You —
 * and the bar stands down entirely the moment the field has text, which is what
 * lets a five-second capture and a nav share one edge. See `App`.
 */

const ITEMS: { view: View; label: string; Icon: typeof TodayIcon }[] = [
  { view: 'today', label: 'Today', Icon: TodayIcon },
  { view: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { view: 'ask', label: 'Ask', Icon: AskIcon },
  { view: 'you', label: 'You', Icon: PersonIcon },
]

type Props = {
  view: View
  onGo: (view: View) => void
  /** The floor under the bar, owned by whatever is last in the bottom block. */
  className?: string
}

export function BottomNav({ view, onGo, className }: Props) {
  return (
    // `bg-raised` and a hairline, with no shadow: the capture control is the one
    // raised object on this page, and a second one competing with it is what a
    // floating bar would be. Hidden on `lg`, where the sidebar already shows the
    // month and the account and there is nothing left for a bar to reach.
    <nav
      aria-label="Destinations"
      className={`flex border-t border-line bg-raised lg:hidden ${className ?? ''}`}
    >
      {ITEMS.map(({ view: destination, label, Icon }) => {
        const live = view === destination
        return (
          <button
            key={destination}
            type="button"
            // The label is visible, so there is nothing to add for a screen
            // reader — but weight and colour alone must not be what says which
            // destination you are on.
            aria-current={live ? 'page' : undefined}
            onClick={() => onGo(destination)}
            className={`flex h-[60px] flex-1 flex-col items-center justify-center gap-[3px] transition-colors ${
              live ? 'font-medium text-ink' : 'text-faint hover:text-muted'
            }`}
          >
            {/* Decoration inside the target, never instead of it: the pill is
                60×30 and the button is the full quarter of the bar by 60 tall,
                the same trick the day cell's 28px disc uses inside its 44px
                cell. */}
            <span
              className={`flex h-[30px] w-[60px] items-center justify-center rounded-full transition-colors ${
                live ? 'bg-sunken' : ''
              }`}
            >
              <Icon size={20} stroke={1.8} />
            </span>
            <span className="text-[0.6875rem] leading-none">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
