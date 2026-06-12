-- Ajoute le jeu "Âges de Guerre" au catalogue en ligne.
-- À coller dans Supabase > SQL Editor puis "Run" (une fois).

insert into public.games (id, title, tagline, sort, max_value) values
  ('ageofwar', 'Âges de Guerre', 'De la préhistoire au futur. Stratégie de couloir.', 2, 1000000)
on conflict (id) do nothing;
