-- ===========================================================
--  REQUÊTES D'ANALYSE — à exécuter dans Supabase > SQL Editor
--  quand tu veux voir où en est ton portail. Copie-colle une requête
--  à la fois. (Le rôle du dashboard ignore la RLS, donc tu vois tout.)
-- ===========================================================

-- 1) Joueurs actifs par jour (DAU), 14 derniers jours
select date_trunc('day', created_at)::date as jour,
       count(distinct user_id) as joueurs,
       count(*) as evenements
from public.events
where created_at > now() - interval '14 days'
group by 1 order by 1 desc;

-- 2) Ouvertures par jeu/page, 7 derniers jours (qu'est-ce qui attire ?)
select game_id, count(*) as ouvertures, count(distinct user_id) as joueurs
from public.events
where name = 'open' and created_at > now() - interval '7 days'
group by 1 order by ouvertures desc;

-- 3) Entonnoir par jeu : ouvertures -> parties terminées (taux d'engagement)
select e.game_id,
       count(*) filter (where e.name='open')  as ouvertures,
       count(*) filter (where e.name='score') as parties,
       round(100.0 * count(*) filter (where e.name='score')
             / nullif(count(*) filter (where e.name='open'),0), 1) as taux_pct
from public.events e
where e.created_at > now() - interval '7 days'
group by 1 order by ouvertures desc;

-- 4) Rétention J1 : parmi les joueurs apparus hier, combien sont revenus aujourd'hui
with j0 as (
  select distinct user_id from public.events
  where created_at::date = (now() - interval '1 day')::date),
j1 as (
  select distinct user_id from public.events
  where created_at::date = now()::date)
select (select count(*) from j0) as joueurs_hier,
       (select count(*) from j0 join j1 using(user_id)) as revenus_aujourdhui;

-- 5) Participation au défi du jour (aujourd'hui)
select game_id, count(distinct user_id) as participants, count(*) as tentatives
from public.events
where name = 'daily' and created_at::date = now()::date
group by 1 order by participants desc;

-- 6) Nouveaux joueurs par jour (première apparition)
select first_day, count(*) as nouveaux from (
  select user_id, min(created_at)::date as first_day
  from public.events group by user_id
) t
where first_day > now() - interval '30 days'
group by 1 order by 1 desc;

-- 7) Score médian et max par jeu, 7 derniers jours
select game_id,
       percentile_cont(0.5) within group (order by (props->>'value')::numeric) as median,
       max((props->>'value')::numeric) as record
from public.events
where name = 'score' and props ? 'value' and created_at > now() - interval '7 days'
group by 1;
