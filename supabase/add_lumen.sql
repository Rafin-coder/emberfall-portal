-- Ajoute le jeu "Lumen" au catalogue en ligne.
-- À coller dans Supabase > SQL Editor puis "Run".
-- (Sans ça, Lumen marche déjà en local, mais n'apparaît pas dans les
--  classements/ catalogue EN LIGNE.)

insert into public.games (id, title, tagline, sort, max_value) values
  ('lumen', 'Lumen', 'Guide la lumière, enchaîne les braises. Arcade nerveux.', 1, 100000)
on conflict (id) do nothing;
