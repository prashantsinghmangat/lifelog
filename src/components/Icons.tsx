// Every icon in the app. Inline SVG on a 24-box, stroked with currentColor so a
// parent's text colour drives them. No icon package.
import type { ReactNode } from 'react'

// `stroke` is here for the bottom nav, whose four icons sit at 20px under an
// 11px label: at the standard weight they read as four heavy blocks in a row
// rather than as a set of labels with marks above them.
type Props = { size?: number; stroke?: number; className?: string }

function Svg({ size = 20, stroke = 2, className, children }: Props & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

const CHEVRON = {
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
} as const

export function Chevron({ dir, ...rest }: Props & { dir: keyof typeof CHEVRON }) {
  return (
    <Svg {...rest}>
      <path d={CHEVRON[dir]} />
    </Svg>
  )
}

export function BellIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Svg>
  )
}

export function CheckIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  )
}

export function CalendarIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  )
}

export function ClockIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  )
}

export function NoteIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M9 11h6M9 15h4" />
    </Svg>
  )
}

export function MicIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </Svg>
  )
}

export function PersonIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Svg>
  )
}

export function CloseIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function ArrowUpIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M12 20V5M6 11l6-6 6 6" />
    </Svg>
  )
}

/** A day: one spine with entries hanging off it, which is what the timeline is. */
export function TodayIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M6 4v16" />
      <path d="M6 8h12M6 13h8M6 18h10" />
    </Svg>
  )
}

export function AskIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.6c-.6.2-.8.7-.8 1.3v.4" />
      <path d="M12 17.2h.01" />
    </Svg>
  )
}

