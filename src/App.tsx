import { useEffect, useState } from 'react'
import { DayHeader } from './components/DayHeader'
import { EntryEditor } from './components/EntryEditor'
import { EntryRow } from './components/EntryRow'
import { Login } from './components/Login'
import { MonthSheet } from './components/MonthSheet'
import { QuickAdd } from './components/QuickAdd'
import { useEntries } from './hooks/useEntries'
import { useSession } from './hooks/useSession'
import { dayKey, minutes, rupees } from './lib/format'
import { supabase } from './lib/supabase'

export default function App() {
  const { session, loading } = useSession()

  if (loading) return <div className="p-4 text-sm text-gray-400">…</div>
  if (!session) return <Login />

  return <Day email={session.user.email ?? ''} />
}

function Day({ email }: { email: string }) {
  const [now, setNow] = useState(() => new Date())
  const [day, setDay] = useState(() => dayKey(new Date()))
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const {
    entries,
    failedElsewhere,
    loading,
    error,
    add,
    update,
    remove,
    retry,
    fetchAll,
    fetchDays,
  } = useEntries(day)

  // A tab left open overnight would keep parsing `today` as yesterday.
  useEffect(() => {
    const refresh = () => setNow(new Date())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const spent = entries.reduce((total, row) => total + (row.amount_paise ?? 0), 0)
  const logged = entries.reduce((total, row) => total + (row.duration_minutes ?? 0), 0)

  async function exportJson() {
    try {
      const all = await fetchAll()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `lifelog-${dayKey(new Date())}.json`
      link.click()
      URL.revokeObjectURL(url)
      setNotice(null)
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Export failed')
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-3 pb-6">
      <DayHeader
        day={day}
        now={now}
        onChange={setDay}
        onOpenCalendar={() => setCalendarOpen(true)}
      />

      {calendarOpen && (
        <MonthSheet
          day={day}
          now={now}
          loadDays={fetchDays}
          onPick={(picked) => {
            setDay(picked)
            setCalendarOpen(false)
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {entries.length > 0 && (
        <div className="mt-2 flex gap-4 text-xs text-gray-500">
          {spent > 0 && <span>{rupees(spent)} spent</span>}
          {logged > 0 && <span>{minutes(logged)} logged</span>}
          <span>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      )}

      <div className="mt-3">
        <QuickAdd
          day={day}
          now={now}
          showExamples={!loading && entries.length === 0}
          onSubmit={add}
        />
      </div>

      {error !== null && <p className="mt-3 text-xs text-expense">{error}</p>}

      <div className="mt-4 flex-1">
        {entries.map((row) =>
          editing === row.id ? (
            <EntryEditor
              key={row.id}
              row={row}
              onSave={(patch) => {
                update(row, patch)
                setEditing(null)
              }}
              onDelete={() => {
                remove(row)
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <EntryRow
              key={row.id}
              row={row}
              now={now}
              onOpen={() => setEditing(row.id)}
              onDelete={() => remove(row)}
              onRetry={() => retry(row)}
            />
          ),
        )}

        {failedElsewhere.length > 0 && (
          <div className="mt-5">
            <p className="mb-1 text-xs font-medium text-expense">Did not save</p>
            {failedElsewhere.map((row) => (
              <EntryRow
                key={row.id}
                row={row}
                now={now}
                offDay
                onOpen={() => setDay(row.occurred_on)}
                onDelete={() => remove(row)}
                onRetry={() => retry(row)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-2 text-xs text-gray-400">
        <button type="button" onClick={() => void exportJson()} className="underline">
          Export JSON
        </button>
        <span className="min-w-0 truncate">{email}</span>
        <button type="button" onClick={() => void supabase.auth.signOut()} className="underline">
          Sign out
        </button>
      </div>

      {notice !== null && <p className="mt-2 text-xs text-expense">{notice}</p>}
    </div>
  )
}
