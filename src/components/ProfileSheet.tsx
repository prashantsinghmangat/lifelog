import { useEffect } from 'react'
import { CloseIcon } from './Icons'
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center sm:pb-0"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-raised p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="text-xs text-faint">Signed in</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-1 p-1 text-faint"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <p className="mt-5 mb-2 text-xs text-muted">Appearance</p>
        <div className="flex gap-1 rounded border border-line p-1">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={theme === option.value}
              onClick={() => onTheme(option.value)}
              className={`flex-1 rounded px-2 py-1.5 text-sm ${
                theme === option.value ? 'bg-ink font-medium text-surface' : 'text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button type="button" onClick={onExport} className="text-sm text-muted underline">
            Export JSON
          </button>
          <button type="button" onClick={onSignOut} className="text-sm text-expense">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
