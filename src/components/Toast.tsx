import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { CloseIcon } from './Icons'

export type ToastState = {
  text: string
  action?: { label: string; run: () => void }
}

/** Long enough to notice, read and decide to undo. */
const WITH_ACTION = 6000
/** Nothing to do but read it, so it should not sit there being read again. */
const PLAIN = 3000
/** Past this much sideways travel, letting go throws it away. */
const DISMISS = 80

/**
 * Feedback for actions whose result is off-screen — a backfill that landed on
 * another day, a delete that can be taken back. Undo instead of a confirmation
 * dialog: reversible actions should not cost a tap up front.
 *
 * Three ways out, because waiting was the only one and it felt like being stuck
 * with it: the close button, a sideways swipe, or the timer. A message you can
 * act on outlives one you can only read — six seconds is not long when Undo is
 * the point, and is far too long for "Reminder set for 5:00 pm".
 */
export function Toast({
  toast,
  onDismiss,
}: {
  /**
   * Null when there is nothing to say — and this component stays mounted for
   * it. A live region has to be in the document *before* its text changes to
   * be announced dependably; mounted in the same commit as its message, the
   * announcement is routinely dropped. What that cost here is the whole point
   * of the toast: a screen-reader user deleting an entry heard nothing, Undo
   * included, and Undo is the only way back.
   */
  toast: ToastState | null
  onDismiss: () => void
}) {
  const [shift, setShift] = useState(0)
  const [dragging, setDragging] = useState(false)
  const from = useRef<number | null>(null)

  // Held in a ref so the timer below depends on the message alone. The caller
  // passes an inline `() => setToast(null)`, which is a new function on every
  // render of the page — and the page re-renders on a write settling and on the
  // 30-second clock tick, each of which restarted the countdown. A toast that
  // outstays its welcome is the thing the three ways out exist to prevent.
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    // A half-finished swipe belongs to the message it was aimed at. The
    // component no longer unmounts between messages, so without this the next
    // one would arrive already pushed aside and half faded out.
    setShift(0)
    setDragging(false)
    from.current = null

    if (toast === null) return
    const timer = window.setTimeout(() => dismiss.current(), toast.action ? WITH_ACTION : PLAIN)
    return () => window.clearTimeout(timer)
  }, [toast])

  function down(event: PointerEvent<HTMLDivElement>) {
    // Starting on Undo or the close button is aiming at that button, not a swipe.
    if ((event.target as HTMLElement).closest('button') !== null) return
    from.current = event.clientX
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (from.current === null) return
    setShift(event.clientX - from.current)
  }

  function up() {
    if (from.current === null) return
    const travelled = Math.abs(shift)
    from.current = null
    setDragging(false)
    // Below the threshold it springs back, which is the gesture saying no.
    if (travelled >= DISMISS) onDismiss()
    else setShift(0)
  }

  const action = toast?.action

  return (
    <div
      role="status"
      aria-live="polite"
      /* In flow, at the top of the bottom block — not fixed, and no offset to
         keep in step with anything.

         A toast over the capture control is not a cosmetic overlap: `Undo` and
         `Save` sat on top of each other once and pressing one hit the other.
         That was answered for a while by `--dock`, a constant the toast read to
         clear the control's height. The constant was the bug: it had to be
         re-derived every time the bottom edge changed, it was wrong by two
         paddings the first time, and once the nav could come and go mid-entry
         it would have needed a rule for which of two values applied. The toast
         is a sibling above the control instead, so clearing it is arithmetic
         nothing has to do. */
      /* The margin belongs to the message, not to the region holding it: empty
         and still carrying `mb-2`, this would sit 8px tall above the capture
         control for the entire life of the app. */
      className={`pointer-events-none flex justify-center ${toast === null ? '' : 'mb-2'}`}
    >
      {toast !== null && (
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          transform: shift === 0 ? undefined : `translateX(${shift}px)`,
          // Fades as it goes, so a half-swipe shows what letting go would do.
          opacity: shift === 0 ? undefined : Math.max(0.2, 1 - Math.abs(shift) / 220),
        }}
        // Vertical stays with the page: a toast across the bottom must not
        // swallow a scroll that merely started on top of it.
        // A system message, not a notification card: one line of text, a
        // rounded bar, and enough shadow to lift it off the timeline and no
        // more.
        className={`sheet-in pointer-events-auto flex w-full max-w-sm touch-pan-y items-center gap-2 rounded-xl bg-ink py-2.5 pr-1 pl-4 text-[0.8125rem] text-surface shadow-[0_10px_30px_-10px_rgb(0_0_0/0.45)] ${
          dragging ? '' : 'transition-transform duration-150'
        }`}
      >
        <span className="min-w-0 flex-1">{toast.text}</span>

        {action && (
          <button
            type="button"
            onClick={() => {
              action.run()
              onDismiss()
            }}
            // Negative margin, not less padding: the target stays 44px while the
            // toast keeps the height of a line of text.
            className="-my-2 flex h-11 shrink-0 items-center px-2 font-semibold underline underline-offset-2"
          >
            {action.label}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center opacity-60 transition-opacity hover:opacity-100"
        >
          <CloseIcon size={15} />
        </button>
      </div>
      )}
    </div>
  )
}
