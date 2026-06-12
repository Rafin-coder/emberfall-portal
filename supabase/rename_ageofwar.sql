-- Renomme le 3e jeu (l'identifiant 'ageofwar' ne change pas, donc les
-- classements et scores existants sont conservés).
-- À coller dans Supabase > SQL Editor puis "Run".
update public.games set title = 'Conquête des Âges' where id = 'ageofwar';
