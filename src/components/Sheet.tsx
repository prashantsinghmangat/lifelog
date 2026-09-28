import { useEffect, useRef, useState, type ReactNode } from 'react'
import { onBack, topmost } from '../lib/back'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The controls in a sheet that can actually hold focus, in document order.
 *
 * Disabled ones are filtered here rather than with `:not(:disabled)` in the
 * selector, and that is not a style choice: a selector *list* carrying `:not()`
 * compounds comes back grouped by selector rather than in document order in at
 * least one engine, so the trap's `last` stopped being the last thing in the
 * sheet and Tab walked straight out of the dialog. The boundaries have to be
 * the ends of the document order or they are not boundaries.
 *
 * Excluding them matters because a disabled control cannot take focus, so one
 * sitting at either end made `.focus()` a silent no-op and dropped focus to
 * `<body>`. `You` renders exactly that — its Save is disabled until a password
 * is typed — and is shown inside a Sheet on `lg`.
 */
function focusable(within: HTMLElement): HTMLElement[] {
  return [...within.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => (node as Partial<HTMLButtonElement>).disabled !== true,
  )
}

type Props = {
  /** Accessible name for the dialog. */
  label: string
  onClose: () => void
  /**
   * Plain content, or a function handed this sheet's own `requestClose` — for
   * a Cancel, Done, or post-Save/Delete control that must play the same exit
   * spring as the backdrop and Escape, rather than calling `onClose` directly
   * and skipping it.
   */
  children: ReactNode | ((requestClose: () => void) => ReactNode)
}

/**
 * One modal surface for the whole app: a bottom sheet where the thumb is, a
 * centred dialog once there is room. Same semantics either way — there is no
 * separate mobile component.
 */
export function Sheet({ label, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const [closing, setClosing] = useState(false)

  // Held in a ref, for the same reason the toast holds its dismiss in one:
  // every caller passes an inline `() => setEditing(null)`, which is a new
  // function on each render of the page — and the page re-renders on a write
  // settling and on the 30-second clock tick. Keyed on the prop, the back
  // registration below would unregister and re-register on every one of those,
  // moving this sheet to the top of a stack it may not be at the top of.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])

  /**
   * Every dismissal — backdrop, Escape, the back button, and whatever a
   * child calls through the render-prop — funnels through here, so the exit
   * animation is one thing to get right instead of four. Plays `.sheet-out`
   * and defers the real `onClose` (which is what actually unmounts this)
   * until the animation is done. Stable ref, like `close` above, since the
   * back-button registration below must keep pointing at the same function
   * for as long as this sheet exists.
   */
  const requestClose = useRef(() => setClosing(true))

  useEffect(() => {
    if (!closing) return
    const node = panel.current
    const done = () => close.current()
    if (node === null) {
      done()
      return
    }
    node.addEventListener('animationend', done)
    // A backstop, not a guess at the animation's real duration: `animationend`
    // never fires at all under `prefers-reduced-motion` in some engines, and
    // never fires in a test environment that does not run real CSS animations
    // in the first place. Longer than `.sheet-out`'s own 160ms so the real
    // event wins whenever one is actually dispatched.
    const timer = window.setTimeout(done, 250)
    return () => {
      node.removeEventListener('animationend', done)
      window.clearTimeout(timer)
    }
  }, [closing])

  useEffect(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // The dialog itself, not its first control. Focusing the first button drew
    // the focus ring on `Expense` every time the editor opened, which reads as
    // "this entry is an expense" when it is usually not — and focusing the
    // first *field* would throw the keyboard up before anyone asked for it.
    panel.current?.focus()

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
      // Send the caret back where it came from, or the page jumps to the top.
      returnTo.current?.focus()
    }
  }, [])

  // Android's back button closes the sheet, through the same `onClose` the
  // scrim, the close button and Escape already use. `Sheet` is where this
  // belongs because `Sheet` is what owns being open — see `lib/back.ts`.
  // Registered once, for as long as this sheet exists.
  /**
   * This sheet's own dismiss, stable for its whole life, so the back stack and
   * the Escape handler below are talking about the same sheet.
   */
  const dismiss = useRef(() => requestClose.current())
  useEffect(() => onBack(dismiss.current), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only the sheet on top answers a dismiss. This listens on `window`, so
      // without the check a sheet opened from another sheet closed both of them
      // on one press — and returned focus to a control that unmounted with it.
      if (event.key === 'Escape') {
        if (topmost(dismiss.current)) requestClose.current()
        return
      }
      if (event.key !== 'Tab') return
      if (!topmost(dismiss.current)) return

      if (panel.current === null) return
      const nodes = focusable(panel.current)
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (!first || !last) return

      // The panel itself is where focus lands on open, and it is deliberately
      // not in `FOCUSABLE` — so it was neither `first` nor `last`, and
      // Shift+Tab as the very first key fell straight through to whatever sits
      // before the sheet in document order: a control behind the scrim, focused
      // and invisible. It is the leading edge of the trap as much as `first` is.
      const at = document.activeElement
      if (event.shiftKey && (at === first || at === panel.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && at === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    // Above the toast, not below it. A toast is `fixed bottom-0` at z-30, and a
    // sheet's actions are sticky along its own bottom edge — so at z-20 a
    // message still on screen sat squarely over Save, Cancel and Delete. The
    // tap did not miss: it landed on the toast, and on a toast carrying Undo
    // that meant pressing Save restored the row you had just deleted. Logging
    // something and editing an entry within the next few seconds is all it
    // takes. Nothing needs to be visible over a modal; the toast outlives it
    // and is announced either way.
    <div
      role="presentation"
      onClick={() => requestClose.current()}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 sm:items-center sm:p-4"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`${closing ? 'sheet-out' : 'sheet-in'} max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-raised p-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.25)] outline-none sm:max-w-sm sm:rounded-2xl sm:pb-5 sm:shadow-[0_24px_60px_-20px_rgb(0_0_0/0.35)]`}
      >
        {typeof children === 'function' ? children(() => requestClose.current()) : children}
      </div>
    </div>
  )
}
