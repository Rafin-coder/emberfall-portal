-- ===========================================================
--  EMBER ARCADE — schéma Supabase
--  À coller dans Supabase > SQL Editor, puis "Run".
--  IMPORTANT : active aussi "Anonymous sign-ins" dans
--  Authentication > Providers (sinon les comptes invités échouent).
-- ===========================================================

-- ---------- PROFILS ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- ---------- CATALOGUE DE JEUX ----------
create table if not exists public.games (
  id         text primary key,            -- ex. 'emberfall'
  title      text not null,
  tagline    text,
  sort       int  not null default 0,
  enabled    boolean not null default true,
  max_value  int  not null default 100000, -- garde-fou anti-triche : score max plausible
  created_at timestamptz not null default now()
);

-- ---------- SCORES ----------
create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  game_id    text not null references public.games(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  value      int  not null check (value >= 0),
  meta       jsonb not null default '{}'::jsonb,   -- {lvl, kills, char, diff...}
  created_at timestamptz not null default now()
);
create index if not exists scores_game_value_idx on public.scores (game_id, value desc);
create index if not exists scores_user_idx        on public.scores (user_id);

-- ---------- SAUVEGARDES (synchro multi-appareils) ----------
create table if not exists public.progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  game_id    text not null references public.games(id) on delete cascade,
  key        text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, key)
);

-- ===========================================================
--  Création automatique du profil à l'inscription (même anonyme)
-- ===========================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'Joueur-' || upper(substr(new.id::text, 1, 8)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================
--  Anti-triche : plausibilité + limite de fréquence
-- ===========================================================
create or replace function public.check_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; recent int;
begin
  select max_value into cap from public.games where id = new.game_id;
  if cap is not null and new.value > cap then
    raise exception 'Score implausible (% > plafond %)', new.value, cap;
  end if;
  select count(*) into recent from public.scores
   where user_id = new.user_id and created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'Trop de scores envoyés coup sur coup, réessaie dans un instant';
  end if;
  return new;
end; $$;

drop trigger if exists scores_guard on public.scores;
create trigger scores_guard
  before insert on public.scores
  for each row execute function public.check_score();

-- ===========================================================
--  RLS (Row Level Security)
-- ===========================================================
alter table public.profiles enable row level security;
alter table public.games    enable row level security;
alter table public.scores   enable row level security;
alter table public.progress enable row level security;

-- profils : lecture publique (pour afficher les pseudos), écriture du sien
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select using (true);
create policy "profiles insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update" on public.profiles for update using (auth.uid() = id);

-- jeux : lecture publique uniquement (écriture via le dashboard Supabase)
drop policy if exists "games read" on public.games;
create policy "games read" on public.games for select using (true);

-- scores : lecture publique, insertion de SES scores seulement (clé anti-triche)
drop policy if exists "scores read"   on public.scores;
drop policy if exists "scores insert" on public.scores;
create policy "scores read"   on public.scores for select using (true);
create policy "scores insert" on public.scores for insert with check (auth.uid() = user_id);

-- progression : chacun ne voit et n'écrit que la sienne
drop policy if exists "progress read"   on public.progress;
drop policy if exists "progress insert" on public.progress;
drop policy if exists "progress update" on public.progress;
create policy "progress read"   on public.progress for select using (auth.uid() = user_id);
create policy "progress insert" on public.progress for insert with check (auth.uid() = user_id);
create policy "progress update" on public.progress for update using (auth.uid() = user_id);

-- ===========================================================
--  Vue classement : meilleur score par joueur, déjà classé
-- ===========================================================
create or replace view public.v_leaderboard as
select
  s.game_id,
  s.user_id,
  p.username,
  s.value,
  s.meta,
  s.created_at,
  rank() over (partition by s.game_id order by s.value desc) as rank
from (
  select distinct on (game_id, user_id)
         game_id, user_id, value, meta, created_at
  from public.scores
  order by game_id, user_id, value desc, created_at asc
) s
join public.profiles p on p.id = s.user_id;

grant select on public.v_leaderboard to anon, authenticated;

-- ===========================================================
--  Catalogue initial
-- ===========================================================
insert into public.games (id, title, tagline, sort, max_value) values
  ('emberfall', 'Emberfall', 'Tiens face à la nuit. Survivor roguelite.', 0, 7200)
on conflict (id) do nothing;
