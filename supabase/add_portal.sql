-- ===========================================================
--  Migration : jeu interne « _portal »
--  Nécessaire pour que le portefeuille global (Ember Coins, XP/niveau,
--  succès) se synchronise entre appareils. Le SDK enregistre ces données
--  dans la table `progress` avec game_id = '_portal' ; sans cette ligne,
--  la clé étrangère vers `games` rejette l'écriture (la sync échoue en
--  silence et tout reste seulement local).
--
--  enabled = false -> ce "jeu" n'apparaît jamais comme une carte
--  (getGames() ne renvoie que enabled = true).
--
--  À exécuter UNE FOIS dans Supabase > SQL Editor.
-- ===========================================================
insert into public.games (id, title, tagline, sort, enabled, max_value) values
  ('_portal', 'Portail (interne)', 'Portefeuille global : Ember Coins, niveau, succès.', 999, false, 0)
on conflict (id) do update set enabled = excluded.enabled;
