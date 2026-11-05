# Contribuer à KORA

À lire avant le premier commit. Le détail technique (architecture, API, données, exploitation) est dans [`docs/`](docs/README.md).

## La branche `main` est synchronisée avec l'éditeur Lovable

Chaque commit poussé sur `main` apparaît dans l'éditeur, et chaque modification faite dans l'éditeur arrive sur `main` sous forme de commit. D'où trois règles impératives.

1. **Ne jamais réécrire un historique déjà poussé.** Pas de `git push --force`, pas de rebase, d'amend ni de squash de commits publiés : l'historique du projet serait perdu côté éditeur. Pour annuler un commit publié, utiliser `git revert`.
2. **Récupérer `main` avant de commencer et avant de pousser** (`git pull`). Des commits peuvent être arrivés entre-temps depuis l'éditeur. Rebaser ses propres commits *non poussés* reste permis.
3. **Garder `main` dans un état qui fonctionne.** Ce qui est poussé est repris immédiatement. Les changements longs se font sur une branche, fusionnée quand les vérifications passent.

## Vérifications avant chaque commit

```bash
npx tsc --noEmit -p .   # TypeScript strict
bun run test            # Vitest
bun run lint            # ESLint et Prettier
```

Les trois doivent passer. Ajouter `bun run build` dès qu'on touche à la configuration (Vite, dépendances, routes serveur).

## Développer en local

```bash
SUPABASE_URL= bun run dev
```

Le `SUPABASE_URL=` vide est volontaire : `.env` contient l'adresse de la base de **production**. Vidée, l'application tourne sur un dépôt en mémoire avec les données de démonstration, réinitialisées à chaque redémarrage. Ne jamais fournir `SUPABASE_SERVICE_ROLE_KEY` sur un poste local : toute écriture modifierait les données réelles.

## Secrets

- Aucun secret dans le code ni dans un fichier commité.
- `.env` **est versionné** et ne contient que des valeurs publiques (adresse et clé publique Supabase). Les fichiers `*.local` sont ignorés par git.
- Les secrets serveur (`SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, `LOVABLE_API_KEY`, `LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY`, `PERPLEXITY_API_KEY`, `APP_USER_CONNECTION_KEY_SECRET`, `WORDPRESS_APP_PASSWORD`, etc.) sont enregistrés dans la console Lovable Cloud. La liste complète est dans le [README](README.md#configuration).
- `APP_USER_CONNECTION_KEY_SECRET` chiffre les connexions LinkedIn en base : la changer rend illisibles toutes les connexions existantes.
- `WORDPRESS_APP_PASSWORD` ne doit apparaître dans aucun message, journal, réponse ni audit. Les tests n'utilisent que `https://wp.example.test` avec un `fetch` simulé, jamais un vrai site.

## Conventions du code

- **Persistance.** En production, les données sont dans la base du projet : tables `kora_records` et `kora_settings`, un enregistrement JSON par ligne, accessibles uniquement côté serveur. `MemoryRepository` et le jeu de démonstration (`src/server/store/seed.ts`) ne servent qu'aux tests et au mode démonstration local. On garde ainsi la même interface `Repository` partout.
- **Collecte.** `RealCollector` lit réellement les flux RSS/Atom et Google News de chaque entreprise, et enrichit les recherches presse par Perplexity. Il ne garde que les publications datées de moins de 30 jours. `SimulatedCollector` sert aux tests des autres fonctions, pour des résultats déterministes ; les tests de `RealCollector` (`collecte-reelle.test.ts`) remplacent `fetch` : aucun test n'appelle le réseau.
- **Écritures concurrentes.** Les opérations sensibles utilisent les RPC transactionnelles du dépôt (A3/A4, mutations de signaux et newsletters). Un `withLock` ([`src/server/services/locks.ts`](src/server/services/locks.ts)) peut coordonner les appels, mais son expiration n'arrête pas l'ancien détenteur : il ne remplace pas un CAS ou une propriété durable vérifiée en base. Tester les conflits et l'atomicité sur PostgreSQL, au-delà des doubles clics en mémoire.
- **Newsletters (P0-01).** Les mutations passent par `commitEdition` / `newsletterMutations.commit` : CAS de l’état complet et audit transactionnel. Un `withLock` expirant ne garantit pas la sécurité multi-instance. Voir [`docs/2026-11-05-p0-01-newsletter-concurrency.md`](docs/2026-11-05-p0-01-newsletter-concurrency.md).
- **Contrat front/back** dans `src/lib/api/` (types, client, hooks) : le modifier des deux côtés en même temps.
- **Droits** toujours vérifiés côté serveur (`src/server/domain/permissions.ts`), jamais seulement dans l'interface.
- Une modification de la forme des enregistrements (`src/server/store/records.ts`) ne demande pas de migration SQL, mais les enregistrements déjà en base gardent l'ancienne forme : le code doit accepter les deux, ou une reprise des données doit être écrite dans `db/data/`.

## Fichiers à ne pas modifier à la main

- `src/routeTree.gen.ts` : régénéré à partir de `src/routes/`.
- `src/integrations/supabase/*` : fichiers générés par la plateforme d'hébergement.
- `vite.config.ts` : ne pas y ajouter les plugins déjà fournis par `@lovable.dev/vite-tanstack-config` (TanStack Start, React, Tailwind, alias `@`, Nitro…), sous peine de chargement en double.

## Base de données

- Les migrations de schéma (`drizzle/migrations/`) sont appliquées par la plateforme d'hébergement.
- Les scripts de données ponctuels (`db/data/`) s'exécutent à la main dans l'éditeur SQL de la console, une seule fois, après relecture. Chacun indique en tête ce qu'il fait et comment le vérifier, et peut être rejoué sans effet. Avant de le committer, le tester sur une base PostgreSQL locale jetable créée avec la migration de `drizzle/migrations/`.

## Documentation

Un changement de comportement visible (API, règle métier, écran, variable d'environnement) s'accompagne de la mise à jour du document concerné dans `docs/`.
