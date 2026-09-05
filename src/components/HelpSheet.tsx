import { Sheet } from './Sheet'

/**
 * The manual, in the app, because the syntax is the product and it is otherwise
 * only learnable by being told. Every example is a button that fills the box, so
 * reading about something and trying it are the same action.
 */

type Example = { text: string; does: string }
type Section = { title: string; note?: string; examples: Example[] }

const SECTIONS: Section[] = [
  {
    title: 'Expenses',
    note: 'A number on its own is money.',
    examples: [
      { text: '350 lunch swiggy', does: '₹350, filed under food' },
      { text: '₹2,499 shoes', does: 'symbols and commas are fine' },
      { text: 'rs 20 chai', does: 'rs before or after the number' },
      { text: '500rs groceries', does: 'no space needed' },
      { text: 'paid rent 18000', does: '“paid” is ignored, rent is a bill' },
    ],
  },
  {
    title: 'Time',
    note: 'A duration makes it a time log, so 2h is never ₹2.',
    examples: [
      { text: '2h client work', does: '120 minutes' },
      { text: '45 min gym', does: 'minutes spelled out' },
      { text: '1h30m acme redesign', does: 'hours and minutes' },
      { text: '2h30 writing', does: 'the m can be dropped' },
    ],
  },
  {
    title: 'Reminders',
    note: 'Anything still ahead becomes an event, and the app notifies you.',
    examples: [
      { text: 'ping me in 5 minutes', does: 'notifies in five minutes' },
      { text: 'call mum in 2 hours', does: 'relative to right now' },
      { text: 'ping 8:15pm', does: 'later today, so it is a reminder' },
      { text: 'dentist tomorrow 5pm', does: 'notifies tomorrow at 5pm' },
      { text: '+ standup', does: '+ forces an event whose time has passed' },
      { text: '+ Mom birthday 14 nov', does: 'repeats yearly, alarms at 9am' },
    ],
  },
  {
    title: 'Dates',
    note: 'With no date, an entry lands on the day being viewed.',
    examples: [
      { text: '320 lunch yesterday', does: 'backfills a day' },
      { text: '180 auto 2 days ago', does: 'counts backwards' },
      { text: '400 dinner sat', does: 'the most recent Saturday' },
      { text: 'team lunch next friday', does: 'forwards instead' },
      { text: '250 books 14/11', does: 'a date, not ₹14' },
    ],
  },
  {
    title: 'Asking',
    note: 'A leading ? asks instead of logging. The answer appears as you type.',
    examples: [
      { text: '? gym', does: 'everything about the gym' },
      { text: '? how many days gym', does: 'days rather than entries' },
      { text: '? how much on swiggy last month', does: 'a total for a period' },
      { text: '? hours worked this week', does: 'time logged' },
    ],
  },
  {
    title: 'Notes',
    note: 'Anything the app cannot read is kept verbatim as a note.',
    examples: [{ text: 'met rahul about the dtx', does: 'saved exactly as typed' }],
  },
]

type Props = {
  onPick: (text: string) => void
  onClose: () => void
}

export function HelpSheet({ onPick, onClose }: Props) {
  return (
    <Sheet label="How to use lifelog" onClose={onClose}>
      <h2 className="text-sm font-semibold">How to use lifelog</h2>
      <p className="mt-1 text-xs text-muted">
        One box. Type what happened and press send. Tap any example to try it.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.title} className="mt-5">
          <h3 className="text-xs font-medium text-ink">{section.title}</h3>
          {section.note !== undefined && (
            <p className="mt-0.5 text-xs text-faint">{section.note}</p>
          )}

          <ul className="mt-2 space-y-1">
            {section.examples.map((example) => (
              <li key={example.text}>
                <button
                  type="button"
                  onClick={() => onPick(example.text)}
                  className="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left active:bg-sunken"
                >
                  <code className="shrink-0 text-sm text-ink">{example.text}</code>
                  <span className="min-w-0 flex-1 text-right text-xs text-faint">
                    {example.does}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-6 text-xs text-faint">
        Deleting is undoable, editing an entry moves its reminder with it, and swiping sideways
        changes the day.
      </p>
    </Sheet>
  )
}
