-- Ajoute le jeu "Ember Hill" au catalogue en ligne.
-- À coller dans Supabase > SQL Editor puis "Run" (une fois).
insert into public.games (id, title, tagline, sort, max_value) values
  ('emberhill', 'Ember Hill', 'Grimpe sans fin, garde l''équilibre, ne tombe pas en panne.', 3, 100000000)
on conflict (id) do nothing;
