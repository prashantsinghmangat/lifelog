-- Spec 025: read a snapshot back, row for row, exactly.
--
-- A restore must land every column as the snapshot holds it, and the
-- `entries_touch` trigger would restamp updated_at on every row it touches —
-- silently erasing the history the snapshot preserved. The trigger is
-- disabled by name for the duration of the function's transaction: DDL is
-- transactional in Postgres, so an upsert that fails rolls the disable back
-- with everything else, and the brief ACCESS EXCLUSIVE lock just makes a
-- concurrent writer wait, which a single-user app can afford.
--
-- security definer, owned by the migration role (the table's owner, which
-- ALTER TABLE requires); callable by service_role alone. An anon or
-- authenticated client gets nothing here it could not already do through
-- RLS — except bypass the trigger, which is exactly why they are refused.
create function restore_entries(payload jsonb) returns integer as $$
declare
  restored integer;
begin
  alter table entries disable trigger entries_touch;

  insert into entries (id, user_id, kind, occurred_on, occurred_at, title, note,
                       amount_paise, duration_minutes, category, data,
                       created_at, updated_at, deleted_at)
  select (row->>'id')::uuid,
         (row->>'user_id')::uuid,
         row->>'kind',
         (row->>'occurred_on')::date,
         (row->>'occurred_at')::timestamptz,
         row->>'title',
         row->>'note',
         (row->>'amount_paise')::integer,
         (row->>'duration_minutes')::integer,
         row->>'category',
         coalesce(row->'data', '{}'::jsonb),
         (row->>'created_at')::timestamptz,
         (row->>'updated_at')::timestamptz,
         (row->>'deleted_at')::timestamptz
  from jsonb_array_elements(payload) as row
  on conflict (id) do update set
    user_id          = excluded.user_id,
    kind             = excluded.kind,
    occurred_on      = excluded.occurred_on,
    occurred_at      = excluded.occurred_at,
    title            = excluded.title,
    note             = excluded.note,
    amount_paise     = excluded.amount_paise,
    duration_minutes = excluded.duration_minutes,
    category         = excluded.category,
    data             = excluded.data,
    created_at       = excluded.created_at,
    updated_at       = excluded.updated_at,
    deleted_at       = excluded.deleted_at;

  get diagnostics restored = row_count;

  alter table entries enable trigger entries_touch;
  return restored;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function restore_entries(jsonb) from public, anon, authenticated;
grant execute on function restore_entries(jsonb) to service_role;
