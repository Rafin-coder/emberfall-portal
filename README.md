# Ember Arcade — portail de petits jeux

Un site statique qui héberge plusieurs jeux navigateur, avec comptes, classements
partagés et sauvegarde cloud. Tout repose sur un **SDK commun** : chaque nouveau jeu
qui l'appelle hérite automatiquement des comptes et des classements.

```
emberfall-portal/
├── public/                  ← dossier publié par Netlify
│   ├── index.html           Accueil (grille de jeux)
│   ├── leaderboard.html     Classements
│   ├── daily.html           Défi du jour (classements quotidiens + série)
│   ├── roadmap.html         Feuille de route publique
│   ├── config.js            ⚠️ À REMPLIR (clés Supabase)
│   ├── sdk.js               Le SDK commun à tous les jeux
│   ├── styles.css           Identité visuelle partagée
│   └── games/
│       ├── emberfall/index.html   Survivor roguelite, branché au SDK
│       ├── lumen/index.html       Arcade de lumière, branché au SDK
│       └── ageofwar/index.html    Stratégie de couloir (campagne + endless), branché au SDK
├── supabase/
│   ├── schema.sql           Base de données + sécurité (RLS) + anti-triche
│   ├── add_lumen.sql        Ajoute Lumen au catalogue en ligne (à exécuter une fois)
│   ├── daily.sql            Active le Défi du jour (colonne + vue + série) — à exécuter une fois
│   ├── analytics.sql        Journal d'événements privé (mesure d'audience) — à exécuter une fois
│   └── analytics_queries.sql  Requêtes prêtes à l'emploi (DAU, entonnoir, rétention…)
├── build-config.js          Génère config.js depuis les variables d'env (déploiement Git)
└── netlify.toml             Config de déploiement

## Mesurer l'audience (analytics)

Exécute `supabase/analytics.sql` une fois. À partir de là, le SDK enregistre
automatiquement, pour chaque jeu, les ouvertures (`open`), les parties terminées
(`score`) et les défis (`daily`) — sans aucune modification des jeux. Aucune donnée
n'est lisible côté client : toi seul lis le journal depuis le dashboard Supabase.
Ouvre `supabase/analytics_queries.sql` et lance les requêtes (joueurs actifs,
taux d'engagement par jeu, rétention J1, etc.).

## Déploiement propre via Git (recommandé — fini les config.js écrasés)

1. Pousse le dossier `emberfall-portal/` sur un dépôt GitHub. Le `.gitignore`
   empêche d'y committer ton `config.js` (tes clés restent privées).
2. Sur Netlify : « New site from Git », choisis le dépôt. Le `netlify.toml`
   règle tout (publish `public`, commande `node build-config.js`).
3. Dans Netlify → Site settings → **Environment variables**, ajoute :
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, et au besoin `PORTAL_NAME`.
4. Chaque `git push` redéploie tout le monde, et `config.js` est régénéré
   depuis ces variables — tes clés ne sont jamais dans le code.
```

## Ça marche tout de suite, même sans serveur

Sans clés Supabase, le portail tourne en **mode hors-ligne** : on joue, les scores
sont gardés en local (par navigateur), les classements en ligne sont simplement masqués.
Tu peux donc déployer d'abord, configurer Supabase ensuite.

## 1. Mettre en ligne sur Netlify

Deux options :

- **Glisser-déposer** : zippe le contenu du dossier `public/` et dépose-le sur
  https://app.netlify.com/drop. C'est en ligne en 30 secondes.
- **Via Git** (recommandé pour les mises à jour) : pousse ce dossier sur un dépôt
  GitHub, puis « New site from Git » sur Netlify. Il lira `netlify.toml`
  (publish = `public`, aucune commande de build). Chaque `git push` redéploie tout
  le monde — c'est ça, ton « système de mise à jour ».

## 2. Brancher les comptes et classements (Supabase)

1. Crée un projet gratuit sur https://supabase.com
2. Ouvre **SQL Editor**, colle tout `supabase/schema.sql`, clique **Run**.
3. Va dans **Authentication > Providers** et **active "Anonymous sign-ins"**
   (indispensable : c'est ce qui crée un compte invité sans friction).
4. Dans **Settings > API**, copie *Project URL* et la clé *anon public*.
5. Ouvre `public/config.js` et colle-les :

   ```js
   window.GAMEPORTAL_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",
     PORTAL_NAME: "EMBER ARCADE"
   };
   ```
6. Redéploie. Les classements passent « en ligne » automatiquement.

> La clé *anon* est **faite pour être publique** : la sécurité est assurée par les
> règles RLS du schéma, pas par le secret de la clé. Ne mets **jamais** la clé
> *service_role* ici.

## 3. Ajouter un nouveau jeu (le point important)

1. Crée `public/games/<id>/index.html` (un HTML autonome, comme Emberfall).
2. Avant `</body>`, ajoute :
   ```html
   <script src="/config.js"></script>
   <script src="/sdk.js"></script>
   <script>GamePortal.init({ gameId: '<id>' });</script>
   ```
3. Au game over, envoie le score :
   ```js
   GamePortal.submitScore(score, { lvl, kills }); // meta libre
   ```
4. Ajoute la ligne du jeu dans Supabase (table `games`) avec un `max_value`
   réaliste (plafond anti-triche).

Le jeu apparaît dans la salle, dans les classements, avec comptes et sauvegarde —
sans réécrire quoi que ce soit.

> Exemple concret : **Lumen** (2ᵉ jeu) a été ajouté exactement comme ça — trois
> lignes de script + une ligne dans la table `games` (voir `supabase/add_lumen.sql`).

## L'API du SDK (`window.GamePortal`)

| Méthode | Rôle |
|---|---|
| `init({ gameId })` | Démarre la session (compte invité auto). À `await`. |
| `getUsername()` / `setUsername(nom)` | Lire / changer le pseudo. |
| `submitScore(valeur, meta)` | Envoyer un score (+ miroir local). |
| `getLeaderboard({ gameId, limit })` | Meilleur score par joueur, classé. |
| `saveProgress(clé, data)` / `loadProgress(clé)` | Sauvegarde cloud + local. |
| `online` | `true` si Supabase est connecté. |

## Anti-triche : ce qui est en place

Les scores partent du navigateur, donc ils sont vérifiés **côté serveur** :

- **RLS** : on ne peut écrire qu'avec son propre identifiant — impossible de poster
  au nom d'un autre.
- **Plausibilité** : tout score au-dessus du plafond `max_value` du jeu est rejeté.
- **Anti-spam** : maximum 5 scores / 10 s par joueur.

Ce n'est pas inviolable (un joueur peut toujours soumettre un score atteignable mais
faux). L'étape suivante, si un classement le mérite, sera la validation par rejeu
côté serveur — l'architecture est prête pour ça.

## Pubs

Un emplacement est réservé sur l'accueil (`.adslot`) mais **rien n'est branché** :
la pub ne vaut le coup qu'avec du trafic, et elle ne doit jamais conditionner le reste.
