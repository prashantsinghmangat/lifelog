import { Sheet } from './Sheet'

type Props = {
  url: string
  onClose: () => void
}

/**
 * One photo, big enough to read.
 *
 * A bill or a ticket is attached to be looked at later, and until this existed
 * a thumbnail could only be removed — the app held the one copy of the photo
 * and would not show it. Through `Sheet` rather than a surface of its own, so
 * Escape, the backdrop and Android's back button work here for the same reason
 * they work everywhere else, and so a photo opened from inside the editor
 * closes back to the editor rather than closing both.
 *
 * It takes a URL and nothing else: a staged photo that has never been saved and
 * a stored one are the same thing to look at.
 */
export function PhotoViewer({ url, onClose }: Props) {
  return (
    <Sheet label="Photo" onClose={onClose}>
      {/* `max-h` against the viewport rather than the panel: the sheet is
          already capped at 85dvh and scrolls, and an image sized to its own
          pixels would make that scroll rather than fit. */}
      <img
        src={url}
        alt=""
        className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-lg object-contain"
      />
    </Sheet>
  )
}
