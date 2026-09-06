import { useEffect, useState } from 'react'

/**
 * Which days in a range have something on them, for the dots under a date.
 *
 * `from` and `to` are strings rather than dates so the effect has stable
 * dependencies: moving between days inside the same week or month must not
 * refetch, or every arrow tap becomes a query.
 */
export function useMarkedDays(
  from: string,
  to: string,
  loadDays: (from: string, to: string) => Promise<string[]>,
): ReadonlySet<string> {
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let live = true
    void loadDays(from, to)
      .then((days) => {
        if (live) setMarked(new Set(days))
      })
      .catch(() => {
        // Dots are decoration; a failed lookup must not break navigation.
        if (live) setMarked(new Set())
      })
    return () => {
      live = false
    }
  }, [from, to, loadDays])

  return marked
}
