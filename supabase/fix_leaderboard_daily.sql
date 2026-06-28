-- ===========================================================
--  CORRECTIF — le classement all-time ne doit PAS inclure les runs du Défi du jour.
--  Avant ce correctif, v_leaderboard agrégeait TOUS les scores (y compris les
--  scores quotidiens, marqués par la colonne `day`). Résultat : un gros score de
--  défi remontait dans le classement permanent. On filtre désormais `day is null`.
--
--  Prérequis : daily.sql doit avoir été exécuté (il ajoute la colonne `day`).
--  À coller dans Supabase > SQL Editor puis "Run" (une fois).
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
  where day is null                       -- <- ne garder que les parties normales
  order by game_id, user_id, value desc, created_at asc
) s
join public.profiles p on p.id = s.user_id;

grant select on public.v_leaderboard to anon, authenticated;
