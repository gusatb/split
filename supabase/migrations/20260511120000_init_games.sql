create extension if not exists "pgcrypto";

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  short_code varchar(4) not null unique,
  state jsonb,
  status varchar not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_games_updated_at on public.games;

create trigger set_games_updated_at
before update on public.games
for each row
execute function public.set_updated_at();

alter table public.games enable row level security;

drop policy if exists "Allow public access to games" on public.games;

create policy "Allow public access to games"
on public.games
for all
using (true)
with check (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.games;
  end if;
exception
  when duplicate_object then null;
end;
$$;
