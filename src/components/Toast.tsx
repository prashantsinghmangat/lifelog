import { useEffect } from 'react'

export type ToastState = {
  text: string
  action?: { label: string; run: () => void }
}

const LIFETIME = 6000

/**
 * Feedback for actions whose result is off-screen — a backfill that landed on
 * another day, a delete that can be taken back. Undo instead of a confirmation
 * dialog: reversible actions should not cost a tap up front.
 */
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, LIFETIME)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])

  const action = toast.action

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="sheet-in pointer-events-auto flex w-full max-w-sm items-center gap-4 rounded-lg bg-ink px-4 py-3 text-sm text-surface shadow-xl">
        <span className="min-w-0 flex-1">{toast.text}</span>
        {action && (
          <button
            type="button"
            onClick={() => {
              action.run()
              onDismiss()
            }}
            className="shrink-0 font-semibold underline"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
