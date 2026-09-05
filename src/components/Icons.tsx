// Every icon in the app. Inline SVG on a 24-box, stroked with currentColor so a
// parent's text colour drives them. No icon package.
import type { ReactNode } from 'react'

type Props = { size?: number; className?: string }

function Svg({ size = 20, className, children }: Props & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

export function Chevron({ dir, ...rest }: Props & { dir: 'left' | 'right' }) {
  return (
    <Svg {...rest}>
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
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

export function ArrowUpIcon(props: Props) {
  return (
    <Svg {...props}>
      <path d="M12 20V5M6 11l6-6 6 6" />
    </Svg>
  )
}

