create table entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) default auth.uid(),
  kind text not null check (kind in ('expense', 'time', 'event', 'note')),
  occurred_on date not null,
  occurred_at timestamptz,
  title text not null,
  note text,
  amount_paise integer,
  duration_minutes integer,
  category text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index entries_user_date_idx
  on entries (user_id, occurred_on desc)
  where deleted_at is null;

alter table entries enable row level security;

create policy "own rows" on entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger entries_touch
  before update on entries
  for each row execute function touch_updated_at();
