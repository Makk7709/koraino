# Démarrage rapide

**Objet.** Installer le projet, le lancer en local, connaître les commandes utiles et les comptes de démonstration, et travailler sans casser la synchronisation avec Lovable. Public : tout ingénieur qui ouvre le dépôt pour la première fois.

## Prérequis

| Outil | Version vérifiée | Remarque |
|---|---|---|
| Node.js | 24.x (24.21.0) | Installation conseillée via [nvm](https://github.com/nvm-sh/nvm). |
| bun | 1.2.x (1.2.19) | Gestionnaire de paquets du projet (`bun.lock`). npm fonctionne aussi, mais ne mettez pas à jour `bun.lock` avec un autre outil. |
| git | toute version récente | Dépôt GitHub `Makk7709/koraino`, branche `main`. |

Le fichier [`bunfig.toml`](../bunfig.toml) active une protection « supply chain » : bun refuse les versions de paquets publiées depuis moins de 24 heures. Une installation qui échoue sur un paquet tout juste publié n'est donc pas un bug.

## Installation et lancement

```bash
git clone https://github.com/Makk7709/koraino.git
cd koraino
nvm use 24
bun install
SUPABASE_URL= bun run dev   # mode démonstration en mémoire, voir ci-dessous
```

L'application est servie sur **http://localhost:8080** (port imposé par la configuration Lovable, voir [`vite.config.ts`](../vite.config.ts)). Le premier chargement d'une page prend quelques secondes, le temps que Vite compile ; les suivants sont instantanés. L'API métier répond sous http://localhost:8080/api (par exemple `curl http://localhost:8080/api/me`, qui renvoie le profil courant en mode démonstration).

**Pourquoi `SUPABASE_URL=` ?** Le fichier [`.env`](../.env), versionné par Lovable, fournit l'adresse de la base Supabase du projet. Dès que `SUPABASE_URL` est définie, le serveur utilise cette base, ce qui exige aussi la clé secrète `SUPABASE_SERVICE_ROLE_KEY`, fournie uniquement par Lovable Cloud à l'application hébergée. Avec un simple `bun run dev`, toutes les routes `/api` répondent donc `500` en local. Vider la variable au lancement bascule sur le dépôt en mémoire avec les données de démonstration (voir [Données de démonstration](#données-de-démonstration)) et sur le mode démonstration, sans connexion (voir [Comptes de démonstration](#comptes-de-démonstration)).

## Commandes

| Commande | Effet |
|---|---|
| `bun run dev` | Serveur de développement Vite avec rechargement à chaud (front et code serveur). |
| `bun run test` | Lance toute la suite Vitest une fois (557 tests répartis dans 37 fichiers au 15 octobre 2026). |
| `bun run test:watch` | Vitest en mode surveillance. |
| `npx tsc --noEmit -p .` | Vérification TypeScript stricte (aucun script npm dédié). |
| `bun run lint` | ESLint sur tout le dépôt. Les 6 avertissements `react-refresh` dans `src/components/ui` viennent de shadcn et sont connus. Depuis l'intégration Supabase, ESLint signale aussi des erreurs de formatage Prettier dans les fichiers générés par Lovable (`src/integrations/supabase/`, marqués « ne pas modifier », à exclure de la configuration ESLint) et dans quelques fichiers serveur ajoutés par Lovable (`store/db.ts`, `store/memory.ts`, `adapters/collector.ts`, `adapters/openai.ts`). |
| `bun run format` | Prettier sur tout le dépôt (largeur 100, guillemets doubles, virgules finales). |
| `bun run build` | Build de production (Vite + Nitro, cible Cloudflare Workers) dans `.output/`. |
| `bun run preview` | Sert le build de production localement. |

Avant chaque commit, la routine attendue est : `npx tsc --noEmit -p .`, `bun run test`, `bun run lint`. Les trois doivent passer sans erreur.

## Variables d'environnement

| Variable | Obligatoire | Lue par | Effet |
|---|---|---|---|
| `AI_API_KEY` | Non | [`adapters/index.ts`](../src/server/adapters/index.ts), [`adapters/openai.ts`](../src/server/adapters/openai.ts) | Clé OpenAI. Si elle est définie, les résumés, brouillons d'articles et variantes LinkedIn produits par les gabarits sont réécrits par `gpt-4o-mini`. Sans clé, l'application fonctionne entièrement avec les gabarits déterministes. |
| `SUPABASE_URL` | Oui en production | [`database.ts`](../src/server/database.ts) (`usesDatabase`), [`client.server.ts`](../src/integrations/supabase/client.server.ts) | Adresse de la base Supabase (PostgreSQL) de Lovable Cloud. Définie : les données sont lues et écrites en base et le serveur exige une connexion (mode supabase). Vide ou absente : dépôt en mémoire avec les données de démonstration, sans connexion (mode démonstration). Valeur publique, versionnée dans `.env`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Oui si `SUPABASE_URL` est définie | `client.server.ts` | Clé de service Supabase, qui contourne la sécurité par ligne et administre les comptes (invitations) : **secret**, fourni par Lovable Cloud à l'application hébergée, absent du dépôt. |
| `SUPABASE_PUBLISHABLE_KEY` | Oui si `SUPABASE_URL` est définie | [`auth/token.ts`](../src/server/auth/token.ts), client Supabase navigateur ([`client.ts`](../src/integrations/supabase/client.ts)) | Clé publique : vérification des jetons côté serveur, connexion côté navigateur. Versionnée dans `.env`. |
| `SUPABASE_PROJECT_ID`, `VITE_SUPABASE_*` | Non | Client Supabase navigateur généré par Lovable | Valeurs publiques versionnées dans `.env`. Le client navigateur ne sert qu'à la connexion. |
| `KORA_ADMIN_EMAILS` | Pour installer le premier administrateur | [`auth/users.ts`](../src/server/auth/users.ts) | Adresses, séparées par des virgules, autorisées à devenir administratrices à leur première connexion tant qu'aucun administrateur actif n'existe. |
| `KORA_PUBLIC_URL` | Recommandée en production | [`publicUrl.ts`](../src/server/publicUrl.ts) | Origine publique (par exemple `https://kora.example.org`) des liens d'invitation et du retour de connexion LinkedIn. À défaut, l'origine de la requête est utilisée. |
| `LOVABLE_API_KEY`, `PERPLEXITY_API_KEY` | Non | [`adapters/collector.ts`](../src/server/adapters/collector.ts) | **Secrets.** Activent la recherche Perplexity de la collecte, par la passerelle de connexion de la plateforme. `LOVABLE_API_KEY` sert aussi à la publication LinkedIn. |
| `WORDPRESS_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD` | Pour l'envoi réel vers WordPress | [`wordpress/config.ts`](../src/server/wordpress/config.ts) | Site, compte Contributeur et mot de passe d'application (**secret**). Aucune des trois en local sans base : envoi simulé. |
| `LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY`, `APP_USER_CONNECTION_KEY_SECRET` | Pour la connexion LinkedIn | [`handlers/connectors.ts`](../src/server/handlers/connectors.ts), [`connectionKeyCrypto.ts`](../src/server/connectionKeyCrypto.ts) | **Secrets.** Connexion du compte LinkedIn de chaque utilisateur et chiffrement de sa clé en base. |
| `LOVABLE_DB_MIGRATION_URL` | Non | [`drizzle.config.ts`](../drizzle.config.ts) | Chaîne de connexion utilisée par Lovable pour appliquer les migrations de [`drizzle/migrations/`](../drizzle/migrations). |
| `VITEST` | Non (positionnée automatiquement par Vitest) | `adapters/index.ts`, `database.ts` | Pendant les tests : dépôt en mémoire avec le seed, mode démonstration, collecteur simulé, WordPress simulé et pas d'appel OpenAI, pour que les tests restent déterministes et hors réseau. |

La clé OpenAI n'est lue que côté serveur (`process.env["AI_API_KEY"]`) ; elle n'est jamais envoyée au navigateur. Pour l'activer en local, exportez-la dans le shell qui lance le serveur :

```bash
AI_API_KEY="sk-..." SUPABASE_URL= bun run dev
```

Ne placez jamais un secret dans le code ni dans un fichier commité. En particulier, **`.env` est versionné** (Lovable y écrit les valeurs publiques de Supabase) : n'y ajoutez ni `AI_API_KEY`, ni `SUPABASE_SERVICE_ROLE_KEY`, ni aucun des autres secrets ci-dessus. `.gitignore` ignore en revanche `*.local`. Sur l'environnement hébergé par Lovable, les secrets sont enregistrés dans le projet (Lovable Cloud). Le détail des données envoyées à OpenAI figure dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

## Comptes de démonstration

Les quatre profils ci-dessous et le changement de profil n'existent qu'en **mode démonstration**, c'est-à-dire en local avec `SUPABASE_URL=` vide (et pendant les tests). Aucune connexion n'est alors demandée : l'utilisateur courant est porté par le cookie `kora_uid`, et Sophie Martin est utilisée par défaut. On change de profil depuis le menu utilisateur en haut à droite de l'écran (appel `POST /api/me`) ; la page `/connexion` renvoie elle aussi vers ce menu.

| Identifiant | Nom | Rôles | Usage typique en test |
|---|---|---|---|
| `u_sophie` | Sophie Martin, Équipe Communication | administratrice, rédactrice, validatrice | Profil par défaut, peut tout faire. |
| `u_lucas` | Lucas Bernard | rédacteur | Vérifier qu'un rédacteur ne peut pas approuver. |
| `u_claire` | Claire Dubois, Direction | validatrice | Approuver les contenus d'un autre auteur. |
| `u_marc` | Marc Lefèvre | lecteur | Vérifier que toutes les écritures sont refusées. |

**En production** (application hébergée, `SUPABASE_URL` définie), ces profils ne sont pas installés et il n'y a pas de changement de profil (`POST /api/me` répond 403 `demo_only`). Chaque personne se connecte sur `/connexion` avec son adresse e-mail et son mot de passe. Les comptes sont créés sur invitation par un administrateur (Paramètres, onglet « Utilisateurs & rôles ») : la personne invitée reçoit un e-mail et choisit son mot de passe sur `/connexion/nouveau-mot-de-passe`. Il n'existe pas d'inscription libre. Le premier administrateur s'installe grâce à `KORA_ADMIN_EMAILS` (voir [Exploitation](09-exploitation.md#comptes-et-authentification) et [Sécurité](06-securite-et-flux-tiers.md#session-et-identité)).

La matrice complète des droits est dans [Règles métier](05-regles-metier.md).

## Données de démonstration

Le serveur choisit son dépôt de données au démarrage ([`getRepository`](../src/server/store/memory.ts)) :

| Mode | Quand | Données |
|---|---|---|
| Base Supabase | `SUPABASE_URL` définie, hors tests (application hébergée par Lovable) | Persistantes. Au premier démarrage, seuls la grille de score, les règles éditoriales et les réglages sont installés, sans aucun utilisateur : **la production démarre vide** et se remplit avec les comptes invités, le registre réel et les collectes. |
| Mémoire avec démonstration | Tests Vitest, ou `SUPABASE_URL=` vide au lancement en local | Générées au démarrage par [`seed.ts`](../src/server/store/seed.ts) et perdues à l'arrêt. |

Le jeu de démonstration calcule ses dates par rapport à l'instant du démarrage : le dashboard affiche donc toujours une activité « récente ». Il reproduit exactement les chiffres de la maquette (150 entreprises suivies, 24 signaux détectés sur 7 jours, 8 sujets prioritaires, 3 brouillons WordPress, 5 posts LinkedIn à valider, signal Pasqal noté 9.2/10…). En mode démonstration :

- **Redémarrer le serveur remet les données à zéro.** C'est le moyen le plus simple de retrouver l'état de la maquette après des essais.
- Le quota d'entreprises est plein (150/150) : la création d'une entreprise est refusée tant qu'une entreprise n'est pas supprimée.
- La collecte n'est **pas** simulée : hors tests, le serveur utilise le collecteur réel (flux RSS, Google News, et Perplexity si `LOVABLE_API_KEY` et `PERPLEXITY_API_KEY` sont exportées), et les sources fictives de la démonstration échouent. OpenAI est actif si `AI_API_KEY` est définie. L'envoi vers WordPress est simulé tant qu'aucune variable `WORDPRESS_*` n'est définie.

Fournir `SUPABASE_SERVICE_ROLE_KEY` sur un poste local le connecterait à la **même base que la production** : toute écriture faite en local modifierait les données réelles.

Le détail du jeu de données est dans le [Dictionnaire des données](04-dictionnaire-des-donnees.md).

## Vérifier qu'une installation fonctionne

1. `bun run test` affiche « 37 passed » pour les fichiers de test et aucun échec.
2. Serveur lancé avec `SUPABASE_URL= bun run dev` : `curl -s http://localhost:8080/api/me` renvoie l'utilisateur Sophie Martin, et `curl -s http://localhost:8080/api/auth/config` renvoie `{"mode":"demo"}`. Sur l'application hébergée, `/api/me` répond 401 sans jeton de connexion.
3. Le dashboard (http://localhost:8080/) affiche les cinq cartes KPI, le graphique « Activité éditoriale » et le tableau « Actualités détectées par l'IA » avec Pasqal en tête.
4. Les huit entrées de la barre latérale ouvrent chacune une page sans erreur.

## Travailler avec Lovable

Le dépôt est connecté à [Lovable](https://lovable.dev) : chaque commit poussé sur `main` apparaît dans l'éditeur Lovable, et chaque modification faite dans Lovable arrive sur `main` sous forme de commits (par exemple « Connecté l'IA avec OpenAI »). Les règles suivantes, détaillées dans [`CONTRIBUTING.md`](../CONTRIBUTING.md), sont impératives :

- **Ne jamais réécrire un historique déjà poussé** : pas de `git push --force`, pas de rebase, d'amend ou de squash de commits publiés. Lovable perdrait l'historique du projet.
- **Faire `git pull` avant de commencer** : Lovable peut avoir poussé des commits entre-temps.
- **Garder `main` dans un état qui fonctionne** : ce qui est poussé est immédiatement repris par Lovable. Travaillez sur une branche pour les changements longs et fusionnez quand les tests passent.
- Ne pas éditer [`src/routeTree.gen.ts`](../src/routeTree.gen.ts) à la main : il est régénéré automatiquement à partir de `src/routes/`.
- Ne pas ajouter dans `vite.config.ts` les plugins déjà fournis par `@lovable.dev/vite-tanstack-config` (TanStack Start, React, Tailwind, alias `@`, Nitro…) : ils seraient chargés en double et l'application ne démarrerait plus.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Le port 8080 est déjà utilisé | Un ancien serveur tourne encore. | `lsof -ti tcp:8080 \| xargs kill`, puis relancer `bun run dev`. |
| Toutes les routes `/api` répondent `500` ; la console affiche « Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY » | `SUPABASE_URL` vient de `.env`, mais la clé de service n'existe que chez Lovable Cloud. | Lancer `SUPABASE_URL= bun run dev` (mode démonstration en mémoire). |
| Les chiffres du dashboard ne correspondent plus à la maquette | Mode démonstration : des essais ont modifié les données en mémoire. | Redémarrer le serveur. |
| L'application hébergée est vide | Normal : la production ne contient pas de données de démonstration. | Créer les entreprises du registre, puis lancer la collecte. |
| Lignes « Error: aborted » dans la console du serveur | Requêtes annulées par le navigateur lors d'une navigation rapide. | Sans conséquence. |
| Avertissement `vite-tsconfig-paths` au démarrage | Plugin fourni en double par la configuration Lovable. | Sans conséquence. |
| Avertissement React « A tree hydrated but some attributes… » | Une extension de navigateur (ou un outil d'automatisation) a modifié le HTML avant React. | Sans conséquence si l'avertissement disparaît en navigation privée. |
| Le texte généré ne change pas malgré `AI_API_KEY` | La variable n'est pas visible du processus serveur, ou l'appel OpenAI échoue (le gabarit est alors conservé silencieusement). | Vérifier la variable dans le shell de lancement. Les échecs OpenAI ne sont pas journalisés ([`openai.ts`](../src/server/adapters/openai.ts)) : pour diagnostiquer, tester la clé directement avec `curl https://api.openai.com/v1/models -H "Authorization: Bearer $AI_API_KEY"`. |
| Une installation échoue sur un paquet très récent | Garde-fou de 24 heures de `bunfig.toml`. | Attendre, ou choisir la version précédente. |

## Pour aller plus loin

- [Architecture](02-architecture.md) pour comprendre comment le code est organisé.
- [Référence API](03-reference-api.md) pour appeler ou étendre l'API.
- [Exploitation](09-exploitation.md) pour les tests, le déploiement, les incidents et les exports.
