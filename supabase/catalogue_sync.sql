-- ===========================================================
--  SYNCHRO DU CATALOGUE EN LIGNE (à exécuter pour mettre la base à jour).
--
--  Pourquoi : getGames() en ligne ÉCRASE le catalogue de repli local. Si un jeu
--  manque dans la table `games`, il disparaît de la grille d'accueil ET du
--  sélecteur de classement. Ce script garantit que les 4 jeux + le portail
--  interne existent, avec les bons titres et des PLAFONDS ANTI-TRICHE réalistes.
--
--  Remplace à lui seul : add_lumen.sql, add_ageofwar.sql, rename_ageofwar.sql,
--  add_emberhill.sql, add_portal.sql. Idempotent : on peut le relancer sans risque.
--
--  ⚠️ Les plafonds (max_value) sont des choix d'équilibrage. Un score AU-DESSUS
--     du plafond est rejeté côté serveur. Valeurs volontairement généreuses mais
--     bien plus basses que les précédentes (qui laissaient passer n'importe quoi) :
--       emberfall  7200   = 2 h de survie (le score est un temps, en secondes)
--       lumen      20000  points
--       ageofwar   50000  unités détruites
--       emberhill  1000000 m (1000 km)  — au lieu de 100 000 000
--  Ajuste si un jour un vrai score légitime se fait refuser.
-- ===========================================================
insert into public.games (id, title, tagline, sort, enabled, max_value) values
  ('emberfall', 'Emberfall',          'Tiens face à la nuit. Survivor roguelite.',                 0, true,  7200),
  ('lumen',     'Lumen',              'Guide la lumière, enchaîne les braises. Arcade nerveux.',   1, true,  20000),
  ('ageofwar',  'Conquête des Âges',  'De la préhistoire au futur. Stratégie de couloir.',         2, true,  50000),
  ('emberhill', 'Ember Hill',         'Grimpe sans fin, garde l''équilibre, ne tombe pas en panne.',3, true,  1000000),
  ('_portal',   'Portail (interne)',  'Portefeuille global : Ember Coins, niveau, succès.',        999, false, 0)
on conflict (id) do update
  set title     = excluded.title,
      tagline   = excluded.tagline,
      sort      = excluded.sort,
      enabled   = excluded.enabled,
      max_value = excluded.max_value;
