import { useEffect, useRef, type ReactNode } from 'react'
import { onBack } from '../lib/back'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

type Props = {
  /** Accessible name for the dialog. */
  label: string
  onClose: () => void
  children: ReactNode
}

/**
 * One modal surface for the whole app: a bottom sheet where the thumb is, a
 * centred dialog once there is room. Same semantics either way — there is no
 * separate mobile component.
 */
export function Sheet({ label, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

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
  useEffect(() => onBack(() => close.current()), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const nodes = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes || nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 sm:items-center sm:p-4"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="sheet-in max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-raised p-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.25)] outline-none sm:max-w-sm sm:rounded-2xl sm:pb-5 sm:shadow-[0_24px_60px_-20px_rgb(0_0_0/0.35)]"
      >
        {children}
      </div>
    </div>
  )
}
