import { useEffect, useRef, useState } from 'react'
import { Chevron, CloseIcon } from './Icons'
import { onBack, topmost } from '../lib/back'

type Props = {
  photos: { id: string; url: string }[]
  /** Which one to open on — the thumbnail that was tapped. */
  index: number
  onClose: () => void
}

/** Past this, letting go moves to the next photo rather than springing back. */
const SWIPE = 60
/** How far in a double-tap zooms, and the ceiling a pinch can reach. */
const DOUBLE_TAP = 2.5
const MAX_SCALE = 5

/**
 * A photo, big enough to read.
 *
 * **Not a `Sheet`.** It was one, and a receipt then sat in a rounded panel
 * under a band of dead space, capped at 85dvh — which is the opposite of what
 * looking at a photo wants. A photo wants the whole screen and nothing else on
 * it. The cost is that everything `Sheet` was quietly doing has to be done
 * here: back registration, an Escape that only answers when this is the
 * topmost surface, scroll lock, and returning focus on the way out. Dropping
 * any of those silently is exactly how the viewer spent two specs invisible.
 */
export function PhotoViewer({ photos, index, onClose }: Props) {
  const [at, setAt] = useState(index)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  const photo = photos[at]
  const many = photos.length > 1
  const zoomed = scale > 1

  /** Stable for this viewer's whole life, so the back stack keeps pointing at it. */
  const dismiss = useRef(onClose)
  useEffect(() => {
    dismiss.current = onClose
  }, [onClose])
  const back = useRef(() => dismiss.current())
  useEffect(() => onBack(back.current), [])

  useEffect(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
      returnTo.current?.focus()
    }
  }, [])

  /** A new photo starts fitted, or the next one opens already halfway across. */
  function show(next: number) {
    setAt(next)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only the surface on top answers a dismiss — the same stack `Sheet`
      // reads, asked the same question, so a photo opened from the editor
      // closes back to the editor rather than closing both.
      if (!topmost(back.current)) return
      if (event.key === 'Escape') dismiss.current()
      if (event.key === 'ArrowRight' && at < photos.length - 1) show(at + 1)
      if (event.key === 'ArrowLeft' && at > 0) show(at - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, photos.length])

  // Live pointers, for pinch. A Map rather than two refs because a third
  // finger landing mid-pinch must not be mistaken for the second one moving.
  const points = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ distance: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null)
  const lastTap = useRef(0)

  function spread(): number {
    const [a, b] = [...points.current.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(event: React.PointerEvent) {
    // Capture keeps a pan tracking when the finger leaves the image, but it
    // throws for a pointer that is no longer active and does not exist at all
    // outside a real browser. Neither is a reason to drop the gesture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Panning still works; it just stops at the element's edge.
    }
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (points.current.size === 2) {
      gesture.current = { distance: spread(), scale }
      drag.current = null
      return
    }

    // A pan while zoomed, a swipe between photos while not.
    drag.current = { x: event.clientX, y: event.clientY, offX: offset.x, offY: offset.y }

    const now = event.timeStamp
    if (now - lastTap.current < 300) {
      // Double tap: in if fitted, back to fitted if not. The one gesture that
      // needs no instructions.
      setScale(zoomed ? 1 : DOUBLE_TAP)
      setOffset({ x: 0, y: 0 })
      drag.current = null
      lastTap.current = 0
      return
    }
    lastTap.current = now
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!points.current.has(event.pointerId)) return
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (points.current.size === 2 && gesture.current !== null) {
      const started = gesture.current
      if (started.distance > 0) {
        const factor = spread() / started.distance
        setScale(Math.min(MAX_SCALE, Math.max(1, started.scale * factor)))
      }
      return
    }

    const from = drag.current
    if (from === null) return
    if (!zoomed) return
    setOffset({ x: from.offX + (event.clientX - from.x), y: from.offY + (event.clientY - from.y) })
  }

  function onPointerUp(event: React.PointerEvent) {
    const from = drag.current
    points.current.delete(event.pointerId)
    if (points.current.size < 2) gesture.current = null

    // A swipe only means the next photo while fitted — zoomed in, the same
    // movement is how you look around the one you are already reading.
    if (from !== null && !zoomed && many) {
      const travelled = event.clientX - from.x
      if (travelled < -SWIPE && at < photos.length - 1) show(at + 1)
      else if (travelled > SWIPE && at > 0) show(at - 1)
    }
    drag.current = null
    // A pinch that ended near 1 should settle exactly there, or panning stays
    // armed on a photo that looks fitted.
    if (scale < 1.02) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
    }
  }

  if (photo === undefined) return null

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      tabIndex={-1}
      // Black, not the app's surface: everything else on screen is gone and
      // the only thing that matters is the picture's own colour.
      className="fixed inset-0 z-40 flex touch-none flex-col bg-black outline-none select-none"
    >
      <div className="flex shrink-0 items-center justify-between p-2 text-white">
        <button
          type="button"
          onClick={() => dismiss.current()}
          aria-label="Close photo"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"
        >
          <CloseIcon size={20} />
        </button>
        {/* Where you are in the set. Absent for one photo, where it would be
            answering a question nobody asked. */}
        {many && (
          <span className="text-sm tabular-nums" aria-live="polite">
            {at + 1} / {photos.length}
          </span>
        )}
        {/* Keeps the counter centred against the close button. */}
        <span className="h-11 w-11" aria-hidden="true" />
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          key={photo.id}
          src={photo.url}
          alt=""
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            // Only while a finger is down does this need to track exactly; the
            // double-tap wants the ease.
            transition: drag.current === null ? 'transform 150ms ease-out' : 'none',
          }}
          className="max-h-full max-w-full object-contain"
        />

        {/* Swiping works, and a swipe nothing announces is not a feature
            anyone finds. These say the set exists. */}
        {many && at > 0 && (
          <button
            type="button"
            onClick={() => show(at - 1)}
            aria-label="Previous photo"
            className="absolute left-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            <Chevron dir="left" size={20} />
          </button>
        )}
        {many && at < photos.length - 1 && (
          <button
            type="button"
            onClick={() => show(at + 1)}
            aria-label="Next photo"
            className="absolute right-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            <Chevron dir="right" size={20} />
          </button>
        )}
      </div>
    </div>
  )
}
