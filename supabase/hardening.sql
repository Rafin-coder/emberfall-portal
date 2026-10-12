-- ===========================================================
--  DURCISSEMENT DE LA BASE (audit d'octobre 2026)
--  À coller dans Supabase > SQL Editor puis "Run", une seule fois,
--  APRÈS schema.sql, daily.sql et analytics.sql.
--  Idempotent (relançable sans risque) et ne supprime AUCUNE donnée :
--  les nouvelles contraintes sont "not valid" = elles s'appliquent aux
--  nouvelles écritures sans re-vérifier l'existant.
-- ===========================================================

-- 1) Vues de classement en "security_invoker" : elles appliquent la RLS de la personne
--    qui lit, et non les droits du propriétaire (alerte du conseiller de sécurité Supabase).
--    Aucun effet visible : la lecture des scores et des pseudos est déjà publique.
alter view if exists public.v_leaderboard set (security_invoker = on);
alter view if exists public.v_daily       set (security_invoker = on);

-- 2) Pseudos : 1 à 24 caractères, sans chevrons. Le site le filtre déjà, la base le garantit
--    même face à un appel direct à l'API.
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (char_length(btrim(username)) between 1 and 24 and username !~ '[<>]') not valid;

-- 3) Taille des champs libres : empêche un client malveillant de remplir la base.
alter table public.scores drop constraint if exists scores_meta_size;
alter table public.scores add constraint scores_meta_size
  check (pg_column_size(meta) <= 2048) not valid;
alter table public.progress drop constraint if exists progress_data_size;
alter table public.progress add constraint progress_data_size
  check (pg_column_size(data) <= 65536) not valid;
alter table public.events drop constraint if exists events_props_size;
alter table public.events add constraint events_props_size
  check (pg_column_size(props) <= 2048 and char_length(name) <= 40) not valid;

-- 4) Anti-triche : en plus du plafond et de la limite de fréquence, un score de défi
--    ne peut porter que la date du jour (UTC, ±1 jour de tolérance pour l'horloge du joueur).
create or replace function public.check_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; recent int; today date := (now() at time zone 'utc')::date;
begin
  select max_value into cap from public.games where id = new.game_id;
  if cap is not null and new.value > cap then
    raise exception 'Score implausible (% > plafond %)', new.value, cap;
  end if;
  if new.day is not null and new.day not in (
       to_char(today - 1, 'YYYY-MM-DD'), to_char(today, 'YYYY-MM-DD'), to_char(today + 1, 'YYYY-MM-DD')) then
    raise exception 'Date de défi invalide';
  end if;
  select count(*) into recent from public.scores
   where user_id = new.user_id and created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'Trop de scores envoyés coup sur coup, réessaie dans un instant';
  end if;
  return new;
end; $$;

-- 5) Journal d'événements : au-delà de 120 événements par minute et par joueur,
--    les suivants sont ignorés en silence (protège la base sans casser le jeu).
create or replace function public.check_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent from public.events
   where user_id = new.user_id and created_at > now() - interval '1 minute';
  if recent >= 120 then return null; end if;
  return new;
end; $$;
drop trigger if exists events_guard on public.events;
create trigger events_guard
  before insert on public.events
  for each row execute function public.check_event();

-- Index pour que ces vérifications restent instantanées quand la base grossit.
create index if not exists scores_user_time_idx on public.scores (user_id, created_at desc);
create index if not exists events_user_time_idx on public.events (user_id, created_at desc);

-- 6) Plafond de Lumen relevé à son maximum théorique (~55 000 points, plateau rempli au combo ×9).
--    L'ancien plafond (20 000) pouvait refuser le score légitime d'un très bon joueur.
update public.games set max_value = 60000 where id = 'lumen' and max_value < 60000;
