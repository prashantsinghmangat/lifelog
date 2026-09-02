import { Sheet } from './Sheet'
import type { Theme } from '../hooks/useTheme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

type Props = {
  email: string
  theme: Theme
  onTheme: (theme: Theme) => void
  onExport: () => void
  onSignOut: () => void
  onClose: () => void
}

export function ProfileSheet({ email, theme, onTheme, onExport, onSignOut, onClose }: Props) {
  return (
    <Sheet label="Profile and settings" onClose={onClose}>
      <p className="truncate text-sm font-medium">{email}</p>
      <p className="text-xs text-faint">Signed in</p>

      <p className="mt-5 mb-2 text-xs text-muted" id="appearance">
        Appearance
      </p>
      <div role="group" aria-labelledby="appearance" className="flex gap-1 rounded-lg border border-line p-1">
        {THEMES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={theme === option.value}
            onClick={() => onTheme(option.value)}
            className={`h-11 flex-1 rounded px-2 text-sm ${
              theme === option.value ? 'bg-ink font-medium text-surface' : 'text-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={onExport} className="h-11 text-sm text-muted underline">
          Export JSON
        </button>
        <button type="button" onClick={onSignOut} className="h-11 px-1 text-sm text-expense">
          Sign out
        </button>
      </div>
    </Sheet>
  )
}
