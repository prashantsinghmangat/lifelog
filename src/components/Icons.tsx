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

export function SearchIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Svg>
  )
}

export function GridIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  )
}

export function ChartIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M5 20V12" />
      <path d="M12 20V5" />
      <path d="M19 20v-5" />
    </Svg>
  )
}

export function MusicIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Svg>
  )
}

export function DownloadIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
      <path d="M5 19h14" />
    </Svg>
  )
}

export function BookIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M20 18v3H6.5a2.5 2.5 0 0 1 0-5" />
    </Svg>
  )
}

export function SunIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.5 1.5m9.8 9.8 1.5 1.5m0-12.8-1.5 1.5M7.1 16.9l-1.5 1.5" />
    </Svg>
  )
}

export function MoonIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M20 13.5A7.5 7.5 0 1 1 10.5 4 6 6 0 0 0 20 13.5Z" />
    </Svg>
  )
}

export function AutoIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 7a5 5 0 0 1 0 10" />
    </Svg>
  )
}

export function WalletIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
      <path d="M20.5 11h-3.5a2 2 0 0 0 0 4h3.5" />
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

export function CameraIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M4 8h3l2-2h6l2 2h3v12H4z" />
      <circle cx="12" cy="14" r="3.5" />
    </Svg>
  )
}

/** The gallery half of attaching: a picture already taken, as opposed to the camera. */
export function ImageIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5-5-6 6" />
    </Svg>
  )
}

/** Beside a footnote: information, not a warning. */
export function InfoIcon(props: Props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
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

export function LockIcon(props: Props) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  )
}

