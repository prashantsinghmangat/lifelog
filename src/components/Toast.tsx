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
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const [shift, setShift] = useState(0)
  const [dragging, setDragging] = useState(false)
  const from = useRef<number | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, toast.action ? WITH_ACTION : PLAIN)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])

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

  const action = toast.action

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
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
        className={`sheet-in pointer-events-auto flex w-full max-w-sm touch-pan-y items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-surface shadow-xl ${
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
            className="-my-2 flex h-11 shrink-0 items-center px-1 font-semibold underline"
          >
            {action.label}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center opacity-70"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  )
}
