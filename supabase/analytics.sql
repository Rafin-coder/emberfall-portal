-- ===========================================================
--  ANALYTICS — journal d'événements (privé)
--  À coller dans Supabase > SQL Editor puis "Run" (une seule fois).
--  Les clients ne peuvent QU'ÉCRIRE leurs événements ; la lecture se
--  fait depuis le dashboard Supabase (voir analytics_queries.sql).
-- ===========================================================

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  game_id    text,
  name       text not null,                 -- 'open', 'score', 'daily', ...
  props      jsonb not null default '{}'::jsonb,
  session_id text,
  created_at timestamptz not null default now()
);
create index if not exists events_name_time_idx on public.events (name, created_at desc);
create index if not exists events_game_time_idx on public.events (game_id, created_at desc);
create index if not exists events_user_idx       on public.events (user_id);

alter table public.events enable row level security;

-- Insertion : chacun n'écrit que ses propres événements.
drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events for insert with check (auth.uid() = user_id);

-- Pas de policy SELECT : aucun client ne peut relire le journal.
-- Toi, tu le lis depuis le dashboard Supabase (rôle service, qui ignore la RLS).
