# Architecture

**Objet.** Décrire comment l'application est construite : les grands blocs, l'organisation du code, le trajet d'une requête, la persistance, les adaptateurs vers les services tiers, et l'écart entre l'architecture actuelle et l'architecture cible du cahier des charges (§5). Public : ingénieurs back-end, front-end et devops.

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Arborescence du dépôt](#arborescence-du-dépôt)
3. [Trajet d'une requête API](#trajet-dune-requête-api)
4. [Couches du serveur](#couches-du-serveur)
5. [Persistance](#persistance)
6. [Adaptateurs et services tiers](#adaptateurs-et-services-tiers)
7. [Budget et appels payants](#budget-et-appels-payants)
8. [Frontend](#frontend)
9. [Horloge et déterminisme](#horloge-et-déterminisme)
10. [Build et cible d'exécution](#build-et-cible-dexécution)
11. [Architecture actuelle et architecture cible](#architecture-actuelle-et-architecture-cible)

## Vue d'ensemble

L'application est un **monolithe TanStack Start** : un seul projet sert à la fois les pages React (rendu serveur puis hydratation) et l'API métier REST sous `/api`. Le code serveur ([`src/server/`](../src/server)) n'est jamais importé par le front ; le front ne parle au serveur que par HTTP, via le client typé [`src/lib/api/client.ts`](../src/lib/api/client.ts).

```mermaid
flowchart LR
  subgraph Navigateur
    UI["Pages React<br/>src/routes, src/components"]
    Q["TanStack Query<br/>src/lib/api/hooks.ts"]
    C["Client API<br/>src/lib/api/client.ts"]
    UI --> Q --> C
  end
  subgraph "Serveur TanStack Start"
    R["Route catch-all<br/>src/routes/api/$.ts"]
    RT["Routeur métier<br/>src/server/router.ts"]
    H["Handlers<br/>src/server/handlers"]
    S["Services<br/>src/server/services"]
    D["Domaine (règles pures)<br/>src/server/domain"]
    ST["Repository<br/>src/server/store"]
    A["Adaptateurs<br/>src/server/adapters"]
    R --> RT --> H
    H --> S
    H --> D
    S --> D
    H --> ST
    S --> ST
    H --> A
    S --> A
  end
  C -- "fetch /api/*<br/>JSON + x-kora-request" --> R
  A -- "HTTPS (si AI_API_KEY)" --> OAI[(OpenAI)]
  A -. "simulé" .-> EXT[(Web, WordPress, LinkedIn)]
  ST --> MEM[("Store en mémoire<br/>seed au démarrage")]
```

Le contrat entre le front et le back est figé dans trois fichiers partagés :

| Fichier | Contenu |
|---|---|
| [`src/lib/api/types.ts`](../src/lib/api/types.ts) | Tous les DTO échangés (entités, requêtes, réponses, énumérations). Importé par le front **et** par le serveur. |
| [`src/lib/api/client.ts`](../src/lib/api/client.ts) | `apiFetch`, `ApiError`, l'objet `api.*` (une méthode par endpoint) et `downloadUrl` pour les fichiers. |
| [`src/lib/api/hooks.ts`](../src/lib/api/hooks.ts) | Clés de cache `qk`, hooks de lecture `useXxx`, et `useKoraMutation` (toasts + invalidation du cache). |

## Arborescence du dépôt

```text
.
├── AGENTS.md                 Règles de synchronisation Lovable (à lire avant tout commit)
├── db/postgres/schema.sql    Schéma PostgreSQL cible (non branché)
├── docs/                     Cette documentation
├── public/                   Fichiers statiques (favicon, robots.txt)
├── src/
│   ├── routes/               Pages (routage par fichiers) + route API catch-all
│   │   ├── __root.tsx        Document HTML, layout global, 404, erreurs, toasts
│   │   ├── index.tsx         Dashboard
│   │   ├── veille.tsx, signaux.tsx, articles.tsx, linkedin.tsx,
│   │   │   newsletter.tsx, entreprises.tsx, parametres.tsx
│   │   └── api/$.ts          Toutes les requêtes /api/* vers handleApiRequest
│   ├── routeTree.gen.ts      Généré automatiquement, ne pas éditer
│   ├── components/
│   │   ├── layout/           Sidebar, en-tête, illustrations
│   │   ├── kora/             Primitives visuelles, logos, libellés français
│   │   ├── dashboard/, signals/, veille/, entreprises/, parametres/,
│   │   │   articles/, linkedin/, newsletter/   Composants par domaine
│   │   └── ui/               Composants shadcn/ui (Radix), base générique
│   ├── lib/api/              Contrat front/back (types, client, hooks)
│   ├── server/               API métier (jamais importée par le front)
│   │   ├── router.ts         Table des routes et contrôles transverses
│   │   ├── http.ts           Réponses JSON, HttpError, cookies
│   │   ├── context.ts        Type Ctx (contexte de requête) et Handler
│   │   ├── validation.ts     Validation des corps de requête
│   │   ├── clock.ts          Horloge surchargeable (tests)
│   │   ├── handlers/         Un fichier par domaine d'API
│   │   ├── services/         Orchestrations réutilisables (collecte, audit, quotas…)
│   │   ├── domain/           Règles métier pures (scoring, preuves, droits, budget…)
│   │   ├── store/            Repository, store mémoire, seed, catalogue
│   │   └── adapters/         Modèle de texte, OpenAI, collecteur, canaux
│   ├── server.ts             Entrée serveur : filet de sécurité des erreurs SSR
│   ├── start.ts              Middlewares TanStack Start (erreurs, CSRF des server functions)
│   ├── router.tsx            Création du routeur et du QueryClient
│   ├── styles.css            Tokens du design system (Tailwind v4)
│   └── test/                 Tests Vitest (server/ pour l'API)
├── vite.config.ts            Configuration Lovable (ne pas y dupliquer les plugins)
└── vitest.config.ts          Configuration des tests (jsdom, alias @)
```

## Trajet d'une requête API

Toutes les requêtes `/api/*` passent par la route fichier [`src/routes/api/$.ts`](../src/routes/api/$.ts), qui délègue à `handleApiRequest` dans [`src/server/router.ts`](../src/server/router.ts). Ce point d'entrée applique, dans l'ordre :

1. **Normalisation du chemin** : le préfixe `/api` et la barre oblique finale sont retirés ; `HEAD` est traité comme `GET`.
2. **Contrôle anti-CSRF** : toute méthode autre que `GET` et `OPTIONS` doit porter l'en-tête `x-kora-request: 1`, sinon la réponse est 403 `csrf_header_missing`. Un formulaire tiers ne peut pas poser cet en-tête sans requête CORS préalable.
3. **Résolution de la route** dans la table `ROUTES` (méthode + motif à paramètres `:id`). Si le chemin existe pour d'autres méthodes : 204 avec en-tête `allow` pour `OPTIONS`, 405 `method_not_allowed` sinon. Si le chemin est inconnu : 404 `not_found`.
4. **Identification** : l'utilisateur est lu dans le cookie `kora_uid` ; à défaut, l'utilisateur par défaut `u_sophie` est utilisé. Il n'y a pas encore d'authentification (voir [Sécurité](06-securite-et-flux-tiers.md)).
5. **Lecture du corps** : JSON limité à 1 Mo (413 `payload_too_large`, 400 `invalid_json`), ou multipart pour les routes marquées `multipart: true` (imports de fichiers).
6. **Construction du contexte** `Ctx` ([`context.ts`](../src/server/context.ts)) : requête, URL, paramètres, query string, repository, utilisateur, instant courant (`now()`), corps.
7. **Appel du handler**, qui valide l'entrée, vérifie les droits (`assertCan`), applique les règles du domaine, écrit dans le repository, journalise, et renvoie une `Response` JSON.
8. **Gestion des erreurs** : une `HttpError` devient une réponse `{ "error": { "code", "message", … } }` avec son statut ; toute autre exception est journalisée (`[api] erreur interne`) et renvoyée en 500 `internal_error`, sans détail technique côté client.

La liste exhaustive des endpoints, avec rôles, corps et erreurs, est dans la [Référence API](03-reference-api.md).

## Couches du serveur

| Couche | Dossier | Responsabilité | Règle de dépendance |
|---|---|---|---|
| Routeur | [`router.ts`](../src/server/router.ts) | Table des routes, contrôles transverses, construction du `Ctx`. | Ne contient aucune règle métier. |
| Handlers | [`handlers/`](../src/server/handlers) | Un handler par endpoint : lecture et validation de l'entrée, droits, appel des services et du domaine, mise en forme de la réponse. | Peut tout appeler sauf un autre handler. |
| Services | [`services/`](../src/server/services) | Orchestrations partagées entre handlers : collecte (`collection.ts`), audit et notifications (`journal.ts`), quotas et budget (`usage.ts`), signaux, newsletters, Editorial DNA, vues DTO (`view.ts`). | Utilisent le repository, le domaine et les adaptateurs. |
| Domaine | [`domain/`](../src/server/domain) | Règles métier **pures** : scoring, indicateur documentaire, regroupement, workflow, droits, budget, dates, CSV, sécurité des URL, extraction DOCX, calculs du dashboard. | N'accède ni au repository ni au réseau ; n'importe que des types (`lib/api/types.ts`, `store/records.ts`) et d'autres modules du domaine (seule dépendance externe : `fflate` pour lire les DOCX). Testable sans serveur. |
| Store | [`store/`](../src/server/store) | Interface `Repository`, implémentation mémoire, seed de démonstration, générateur pseudo-aléatoire déterministe. | Ne connaît pas HTTP. |
| Adaptateurs | [`adapters/`](../src/server/adapters) | Accès aux services tiers derrière des interfaces remplaçables. | Ne connaissent ni le repository ni HTTP. |

Conventions communes : messages d'erreur et libellés en français, dates au format ISO 8601 en UTC dans l'API, identifiants préfixés générés par `repo.nextId(prefix)` (par exemple `sig_n1042`), chaque action significative tracée par `audit()` dans le journal.

## Persistance

### Interface `Repository`

Tout accès aux données passe par l'interface asynchrone `Repository` de [`store/repository.ts`](../src/server/store/repository.ts) : une `Collection<T>` par entité (`get`, `list`, `insert`, `update`, `remove`), plus `getSettings` / `saveSettings` (quotas, budget, état de suspension) et `nextId`. Les handlers et services n'utilisent que cette interface : brancher PostgreSQL consiste à fournir une autre implémentation, sans toucher au reste du code.

### Implémentation actuelle : store en mémoire

[`store/memory.ts`](../src/server/store/memory.ts) fournit `MemoryRepository`, conservé comme singleton sur `globalThis` (clé `__koraNewsroomStore__`) pour survivre au rechargement à chaud du code serveur. Le store est construit par `resetStore()` à partir de `buildSeed(now)` ([`seed.ts`](../src/server/store/seed.ts)). La constante `STORE_VERSION` doit être incrémentée quand la forme des enregistrements change : le store est alors reconstruit au prochain appel.

Limites à connaître :

- **Aucune durabilité** : un redémarrage efface toutes les modifications.
- **Un store par processus** : sur Cloudflare Workers, chaque isolat a son propre `globalThis`. Deux requêtes servies par deux isolats différents peuvent voir des données différentes, et un isolat recyclé repart du seed. Le store mémoire convient au développement et à la démonstration, **pas à la production**.
- **Pas de transactions** : les opérations composées (réservation de budget, idempotence des publications) sont correctes dans un seul processus mono-thread JavaScript, mais devront être transactionnelles avec une base partagée.
- **`list()` charge toute la collection** : acceptable pour le volume de démonstration, insuffisant pour l'épreuve de charge R13 du cahier des charges (100 000 signaux). Une implémentation SQL devra filtrer, trier et paginer en base.

### Cible : PostgreSQL

Le schéma cible est dans [`db/postgres/schema.sql`](../db/postgres/schema.sql). Il n'est pas encore utilisé par le code. La correspondance entités/tables et les points d'attention pour écrire un `PostgresRepository` sont détaillés dans le [Dictionnaire des données](04-dictionnaire-des-donnees.md).

## Adaptateurs et services tiers

Les adaptateurs sont regroupés dans [`adapters/index.ts`](../src/server/adapters/index.ts) : `adapters()` renvoie l'ensemble courant, `setAdapters()` permet d'en remplacer une partie (tests ou branchement d'un vrai fournisseur), `resetAdapters()` revient aux valeurs par défaut.

| Rôle | Interface | Implémentation par défaut | Statut |
|---|---|---|---|
| Génération de textes (dossier factuel, brouillon, variantes LinkedIn, résumés, notes éditoriales) | `TextModel` ([`text-model.ts`](../src/server/adapters/text-model.ts)) | `TemplateTextModel` : gabarits déterministes à partir des données du signal. | Réel, sans IA. |
| Amélioration IA des textes | `AiTextEnhancer` ([`openai.ts`](../src/server/adapters/openai.ts)) | `OpenAiEnhancer` (OpenAI `gpt-4o-mini`), actif seulement si `AI_API_KEY` est défini et hors Vitest ; sinon `null`. | Réel si clé configurée. |
| Collecte des sources | `Collector` ([`collector.ts`](../src/server/adapters/collector.ts)) | `SimulatedCollector` : génère des observations plausibles et des échecs d'accès reproductibles. | Simulé. |
| WordPress | `WordPressClient` ([`channels.ts`](../src/server/adapters/channels.ts)) | `SimulatedWordPress` : crée des brouillons distants fictifs et sait les retrouver par clé d'idempotence. | Simulé. |
| LinkedIn | `LinkedInClient` ([`channels.ts`](../src/server/adapters/channels.ts)) | `ExportOnlyLinkedIn` : API indisponible, export manuel uniquement. | Export seul (conforme au pilote). |

### Chaîne de génération avec OpenAI

Le modèle à gabarits produit toujours un premier texte. Si un `AiTextEnhancer` est configuré, ce texte et les données sources lui sont transmis pour réécriture ; en cas d'erreur réseau, de délai dépassé (30 s), de réponse non JSON ou incomplète, le texte gabarit est conservé. L'application ne dépend donc jamais de la disponibilité d'OpenAI.

```mermaid
sequenceDiagram
  participant H as Handler / service
  participant T as TemplateTextModel
  participant AI as OpenAiEnhancer
  participant O as API OpenAI
  H->>T: generateDossier / linkedinVariants / summarize
  T-->>H: texte gabarit
  alt AI_API_KEY défini
    H->>AI: enhanceXxx(entrée, texte gabarit)
    AI->>O: chat/completions (gpt-4o-mini)
    alt réponse valide
      O-->>AI: texte réécrit
      AI-->>H: texte réécrit
    else erreur, délai, réponse invalide
      AI-->>H: texte gabarit inchangé
    end
  end
```

Points d'insertion actuels : résumé des signaux à la collecte ([`services/collection.ts`](../src/server/services/collection.ts)) et à la défusion ([`handlers/signals.ts`](../src/server/handlers/signals.ts)), dossier et brouillon d'article ([`handlers/articles.ts`](../src/server/handlers/articles.ts)), variantes LinkedIn ([`handlers/distribution.ts`](../src/server/handlers/distribution.ts)), résumés de newsletter ([`services/newsletters.ts`](../src/server/services/newsletters.ts)). Les garde-fous du prompt et les données transmises sont décrits dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

### Brancher un vrai fournisseur

Les interfaces `TextModel`, `Collector` et `WordPressClient` sont aujourd'hui **synchrones** (par exemple `collect(input): CollectResult`). Un collecteur web ou un client WordPress réel fera des appels réseau : il faudra rendre ces méthodes asynchrones (`Promise<…>`) et ajouter `await` aux points d'appel (`services/collection.ts`, `handlers/articles.ts`). `AiTextEnhancer` est déjà asynchrone et peut servir de modèle. Le nouvel adaptateur s'enregistre dans `defaults()` de `adapters/index.ts`, avec ses secrets lus dans `process.env`.

## Budget et appels payants

Toute opération susceptible de coûter (collecte, génération de dossier, variantes LinkedIn, résumés de newsletter) est enveloppée par `paidCall()` de [`services/usage.ts`](../src/server/services/usage.ts). Avant l'appel, le coût estimé (constantes `COSTS` de [`domain/budget.ts`](../src/server/domain/budget.ts)) est **réservé** ; si le plafond mensuel serait dépassé, rien n'est appelé, les appels payants sont suspendus pour le mois, un événement d'audit et une notification sont créés, et l'API répond 402 `budget_exhausted`. Après l'appel, la consommation est enregistrée et les alertes à 80 % et 100 % sont vérifiées. La lecture et les exports ne passent jamais par `paidCall` et restent disponibles.

Exception à corriger : les résumés réécrits par OpenAI via `enhanceSummary()` lors de l'ingestion des observations ([`services/collection.ts`](../src/server/services/collection.ts), après le `paidCall` de la collecte) et lors d'une défusion ([`handlers/signals.ts`](../src/server/handlers/signals.ts)) ne sont pas enveloppés par `paidCall` : ils ne sont ni réservés ni bloqués quand les appels payants sont suspendus. Les autres points d'insertion d'OpenAI (dossier d'article, variantes LinkedIn, résumés de newsletter) sont bien à l'intérieur d'un `paidCall`.

Le coût enregistré est l'**estimation** de `COSTS`, pas le coût réellement facturé par OpenAI. Pour un suivi exact, `OpenAiEnhancer` devra remonter l'usage en jetons de la réponse et le convertir en euros via le paramètre `actual` de `paidCall`. Les règles détaillées sont dans [Règles métier](05-regles-metier.md).

## Frontend

Le front est une application React rendue par TanStack Start. Le rendu serveur produit la structure de la page ; les données sont chargées côté navigateur par TanStack Query (les pages affichent des squelettes pendant le chargement). Chaque page de `src/routes/` ne rend que son contenu : la barre latérale, l'en-tête et le fond sont fournis par `AppLayout` depuis [`__root.tsx`](../src/routes/__root.tsx). Le design system (tokens, primitives, règles de conformité à la maquette) est documenté dans [Frontend](07-frontend.md).

## Horloge et déterminisme

- [`clock.ts`](../src/server/clock.ts) expose `now()` ; les tests figent l'instant avec `setClock()`. Le code serveur ne doit jamais appeler `new Date()` directement pour une règle métier.
- Le seed utilise un générateur pseudo-aléatoire déterministe ([`prng.ts`](../src/server/store/prng.ts)) : à instant égal, il produit exactement les mêmes données. Les tests s'appuient sur cette propriété pour vérifier les chiffres de la maquette.
- Les tests réinitialisent store, horloge et adaptateurs avec `setup()` de [`src/test/server/helpers.ts`](../src/test/server/helpers.ts).

## Build et cible d'exécution

`bun run build` produit un bundle Nitro avec le preset `cloudflare-module` dans `.output/` : `server/index.mjs` (Worker), `public/` (fichiers statiques), et un `wrangler.json` généré (drapeau `nodejs_compat`). [`src/server.ts`](../src/server.ts) enveloppe l'entrée serveur pour transformer les erreurs SSR non rattrapées en page d'erreur HTML propre, et [`src/start.ts`](../src/start.ts) installe un middleware d'erreurs et la protection CSRF des server functions de TanStack Start. Le déploiement et l'exploitation sont décrits dans [Exploitation](09-exploitation.md).

## Architecture actuelle et architecture cible

Le cahier des charges (§5) décrit une cible composée d'une API métier, de PostgreSQL, d'un stockage de fichiers, de traitements asynchrones et d'adaptateurs séparant recherche, modèles de texte et canaux de publication.

| Brique cible | État actuel | Travail restant |
|---|---|---|
| API métier KORA | En place : `/api`, contrôles transverses, droits, audit. | Authentification réelle (voir [Sécurité](06-securite-et-flux-tiers.md)). |
| PostgreSQL | Schéma écrit, non branché ; données en mémoire. | Implémenter `Repository` sur PostgreSQL, migrations, sauvegardes. |
| Stockage de fichiers | Les fichiers importés sont conservés en mémoire (champ `bytes` de l'import). | Stockage objet (par exemple R2 ou S3), avec la même règle : original conservé tel quel. |
| Traitements asynchrones | La collecte s'exécute pendant la requête HTTP, avec un nombre d'essais borné. | File de travaux et planification quotidienne par source (le cahier des charges prévoit une collecte quotidienne). |
| Adaptateurs | En place ; OpenAI réel si clé ; collecte, WordPress et LinkedIn simulés. | Collecteur web réel, client WordPress REST, éventuellement API LinkedIn. |
| Secrets hors navigateur | Respecté : clés lues côté serveur uniquement. | Rotation et révocation documentées. |

La liste complète des écarts avec le cahier des charges, exigence par exigence, est dans la [Couverture du cahier des charges](10-couverture-cahier-des-charges.md).
