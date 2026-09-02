import { useCallback, useRef, type PointerEvent } from 'react'

/** Past this many pixels sideways it counts as a swipe. */
const DISTANCE = 60
/** Sideways travel must beat vertical travel by this much, so scrolling still wins. */
const AXIS_BIAS = 1.5
/** Android's back gesture owns the screen edges. Do not fight it. */
const EDGE = 24

/**
 * Horizontal swipe over the timeline. Pointer events only — no library, and no
 * per-move state, since the whole gesture can be judged from where it ended.
 */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const from = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    // Dragging inside a field is text selection, not navigation. An open sheet
    // sits inside this container, so swiping it must not shuffle days behind it.
    if (target.closest('input, textarea, form, [role="dialog"], [role="presentation"]')) {
      from.current = null
      return
    }
    if (event.clientX < EDGE || event.clientX > window.innerWidth - EDGE) {
      from.current = null
      return
    }
    from.current = { x: event.clientX, y: event.clientY }
  }, [])

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const start = from.current
      from.current = null
      if (!start) return

      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * AXIS_BIAS) return

      // Dragging the page leftwards pulls the next day into view.
      if (dx < 0) onLeft()
      else onRight()
    },
    [onLeft, onRight],
  )

  const onPointerCancel = useCallback(() => {
    from.current = null
  }, [])

  return { onPointerDown, onPointerUp, onPointerCancel }
}
