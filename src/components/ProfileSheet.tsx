import { Sheet } from './Sheet'
import { You } from './You'
import type { Theme } from '../hooks/useTheme'

type Props = {
  email: string
  /** No account behind the log. See `guest` in `identity.ts`. */
  local: boolean
  theme: Theme
  onTheme: (theme: Theme) => void
  nudges: boolean
  onNudges: (on: boolean) => void
  onHelp: () => void
  onExport: () => void
  onExportCalendar: () => void
  onSignIn: () => void
  onSignOut: () => void
  onClose: () => void
}

/** `You` as a modal, for the wide layout, where there is no bottom nav to hold
 *  a destination and the sidebar is what carries the account. */
export function ProfileSheet({ onClose, ...rest }: Props) {
  return (
    <Sheet label="Profile and settings" onClose={onClose}>
      <You {...rest} />
    </Sheet>
  )
}
