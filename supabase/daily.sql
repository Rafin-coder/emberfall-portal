-- ===========================================================
--  DÉFI DU JOUR — classements quotidiens
--  À coller dans Supabase > SQL Editor puis "Run" (une seule fois).
-- ===========================================================

-- 1) Une colonne "day" sur les scores : 'YYYY-MM-DD' pour les runs de défi,
--    NULL pour les parties normales.
alter table public.scores add column if not exists day text;
create index if not exists scores_daily_idx on public.scores (game_id, day, value desc);

-- 2) Vue classement du jour : meilleur score par joueur, par jeu et par jour, déjà classé.
create or replace view public.v_daily as
select
  s.game_id, s.day, s.user_id, p.username, s.value, s.meta,
  rank() over (partition by s.game_id, s.day order by s.value desc) as rank
from (
  select distinct on (game_id, day, user_id)
         game_id, day, user_id, value, meta, created_at
  from public.scores
  where day is not null
  order by game_id, day, user_id, value desc, created_at asc
) s
join public.profiles p on p.id = s.user_id;

grant select on public.v_daily to anon, authenticated;

-- 3) Jeu interne caché ('_portal') pour rattacher la série quotidienne (streak).
--    enabled=false => il n'apparaît jamais dans la salle.
insert into public.games (id, title, tagline, sort, enabled, max_value)
values ('_portal', 'Portail', 'interne', 999, false, 1000000)
on conflict (id) do nothing;
