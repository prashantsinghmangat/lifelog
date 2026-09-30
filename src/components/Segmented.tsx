// The one segmented control: a 40px sunken track holding 34px raised pills.
// You's mode picker and Calendar's Grid | Chart toggle both stood at ~68px
// against 52px list rows, and each drew the shape its own way — which is the
// whole reason controls looked inconsistent between screens.

type Props<T extends string> = {
  /** The group's accessible name — the control never draws a visible label. */
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

/**
 * Track 40px, radius 11, 3px padding; buttons 34px, radius 8. The 44px target
 * rule still holds: each button is `h-11` and overhangs the track by the same
 * negative margin the day cell's disc and `Log · Ask` already use — the pill
 * is decoration inside the target, never the target itself.
 */
export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div role="group" aria-label={label} className="flex rounded-[11px] bg-sunken p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="-my-[5px] flex h-11 min-w-0 flex-1 items-center justify-center"
        >
          <span
            className={`flex h-[34px] w-full items-center justify-center rounded-lg px-2 text-sm transition-colors ${
              value === option.value
                ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted hover:text-ink'
            }`}
          >
            {option.label}
          </span>
        </button>
      ))}
    </div>
  )
}
