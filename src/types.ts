export type Kind = 'expense' | 'time' | 'event' | 'note'

/** A row of `entries`, snake_case exactly as Postgres returns it. */
export type Entry = {
  id: string
  kind: Kind
  occurred_on: string
  occurred_at: string | null
  title: string
  note: string | null
  amount_paise: number | null
  duration_minutes: number | null
  category: string | null
  data: Record<string, unknown>
  created_at: string
}
