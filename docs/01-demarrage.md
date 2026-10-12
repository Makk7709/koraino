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
bun run dev
```

L'application est servie sur **http://localhost:8080** (port imposé par la configuration Lovable, voir [`vite.config.ts`](../vite.config.ts)). Le premier chargement d'une page prend quelques secondes, le temps que Vite compile ; les suivants sont instantanés. L'API métier répond sous http://localhost:8080/api (par exemple `curl http://localhost:8080/api/me`).

## Commandes

| Commande | Effet |
|---|---|
| `bun run dev` | Serveur de développement Vite avec rechargement à chaud (front et code serveur). |
| `bun run test` | Lance toute la suite Vitest une fois (76 tests au 12 octobre 2026). |
| `bun run test:watch` | Vitest en mode surveillance. |
| `npx tsc --noEmit -p .` | Vérification TypeScript stricte (aucun script npm dédié). |
| `bun run lint` | ESLint sur tout le dépôt (les 6 avertissements `react-refresh` dans `src/components/ui` viennent de shadcn et sont connus). |
| `bun run format` | Prettier sur tout le dépôt (largeur 100, guillemets doubles, virgules finales). |
| `bun run build` | Build de production (Vite + Nitro, cible Cloudflare Workers) dans `.output/`. |
| `bun run preview` | Sert le build de production localement. |

Avant chaque commit, la routine attendue est : `npx tsc --noEmit -p .`, `bun run test`, `bun run lint`. Les trois doivent passer sans erreur.

## Variables d'environnement

| Variable | Obligatoire | Lue par | Effet |
|---|---|---|---|
| `AI_API_KEY` | Non | [`adapters/index.ts`](../src/server/adapters/index.ts), [`adapters/openai.ts`](../src/server/adapters/openai.ts) | Clé OpenAI. Si elle est définie, les résumés, brouillons d'articles et variantes LinkedIn produits par les gabarits sont réécrits par `gpt-4o-mini`. Sans clé, l'application fonctionne entièrement avec les gabarits déterministes. |
| `VITEST` | Non (positionnée automatiquement par Vitest) | `adapters/index.ts` | Désactive l'appel OpenAI pendant les tests, pour qu'ils restent déterministes et hors réseau. |

La clé n'est lue que côté serveur (`process.env["AI_API_KEY"]`) ; elle n'est jamais envoyée au navigateur. Pour l'activer en local, exportez-la dans le shell qui lance le serveur :

```bash
AI_API_KEY="sk-..." bun run dev
```

Ne placez jamais la clé dans le code ni dans un fichier commité. Attention : `.gitignore` ignore `*.local` mais pas `.env` ; un fichier `.env` créé à la racine serait proposé au commit. Sur l'environnement hébergé par Lovable, elle est enregistrée comme secret du projet. Le détail des données envoyées à OpenAI figure dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

## Comptes de démonstration

Il n'y a pas encore d'authentification : l'utilisateur courant est porté par le cookie `kora_uid`, et Sophie Martin est utilisée par défaut. On change de profil depuis le menu utilisateur en haut à droite de l'écran (appel `POST /api/me`).

| Identifiant | Nom | Rôles | Usage typique en test |
|---|---|---|---|
| `u_sophie` | Sophie Martin, Équipe Communication | administratrice, rédactrice, validatrice | Profil par défaut, peut tout faire. |
| `u_lucas` | Lucas Bernard | rédacteur | Vérifier qu'un rédacteur ne peut pas approuver. |
| `u_claire` | Claire Dubois, Direction | validatrice | Approuver les contenus d'un autre auteur. |
| `u_marc` | Marc Lefèvre | lecteur | Vérifier que toutes les écritures sont refusées. |

La matrice complète des droits est dans [Règles métier](05-regles-metier.md).

## Données de démonstration

Les données vivent **en mémoire** dans le processus serveur. Elles sont générées au démarrage par [`seed.ts`](../src/server/store/seed.ts), avec des dates calculées par rapport à l'instant du démarrage : le dashboard affiche donc toujours une activité « récente ». Le jeu reproduit exactement les chiffres de la maquette (150 entreprises suivies, 24 signaux détectés sur 7 jours, 8 sujets prioritaires, 3 brouillons WordPress, 5 posts LinkedIn à valider, signal Pasqal noté 9.2/10…).

Conséquences pratiques :

- **Redémarrer le serveur remet les données à zéro.** C'est le moyen le plus simple de retrouver l'état de la maquette après des essais.
- Les modifications faites dans l'interface ou par `curl` sont visibles immédiatement, mais ne survivent pas à un redémarrage.
- Le quota d'entreprises du jeu de démonstration est plein (150/150) : la création d'une entreprise est refusée tant que le quota n'est pas relevé ou qu'une entreprise n'est pas supprimée.

Le détail du jeu de données est dans le [Dictionnaire des données](04-dictionnaire-des-donnees.md).

## Vérifier qu'une installation fonctionne

1. `bun run test` affiche « 9 passed » pour les fichiers de test et aucun échec.
2. `curl -s http://localhost:8080/api/me` renvoie l'utilisateur Sophie Martin.
3. Le dashboard (http://localhost:8080/) affiche les cinq cartes KPI, le graphique « Activité éditoriale » et le tableau « Actualités détectées par l'IA » avec Pasqal en tête.
4. Les huit entrées de la barre latérale ouvrent chacune une page sans erreur.

## Travailler avec Lovable

Le dépôt est connecté à [Lovable](https://lovable.dev) : chaque commit poussé sur `main` apparaît dans l'éditeur Lovable, et chaque modification faite dans Lovable arrive sur `main` sous forme de commits (par exemple « Connecté l'IA avec OpenAI »). Les règles suivantes, reprises de [`AGENTS.md`](../AGENTS.md), sont impératives :

- **Ne jamais réécrire un historique déjà poussé** : pas de `git push --force`, pas de rebase, d'amend ou de squash de commits publiés. Lovable perdrait l'historique du projet.
- **Faire `git pull` avant de commencer** : Lovable peut avoir poussé des commits entre-temps.
- **Garder `main` dans un état qui fonctionne** : ce qui est poussé est immédiatement repris par Lovable. Travaillez sur une branche pour les changements longs et fusionnez quand les tests passent.
- Ne pas éditer [`src/routeTree.gen.ts`](../src/routeTree.gen.ts) à la main : il est régénéré automatiquement à partir de `src/routes/`.
- Ne pas ajouter dans `vite.config.ts` les plugins déjà fournis par `@lovable.dev/vite-tanstack-config` (TanStack Start, React, Tailwind, alias `@`, Nitro…) : ils seraient chargés en double et l'application ne démarrerait plus.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Le port 8080 est déjà utilisé | Un ancien serveur tourne encore. | `lsof -ti tcp:8080 \| xargs kill`, puis relancer `bun run dev`. |
| Les chiffres du dashboard ne correspondent plus à la maquette | Des essais ont modifié les données en mémoire. | Redémarrer le serveur. |
| Lignes « Error: aborted » dans la console du serveur | Requêtes annulées par le navigateur lors d'une navigation rapide. | Sans conséquence. |
| Avertissement `vite-tsconfig-paths` au démarrage | Plugin fourni en double par la configuration Lovable. | Sans conséquence. |
| Avertissement React « A tree hydrated but some attributes… » | Une extension de navigateur (ou un outil d'automatisation) a modifié le HTML avant React. | Sans conséquence si l'avertissement disparaît en navigation privée. |
| Le texte généré ne change pas malgré `AI_API_KEY` | La variable n'est pas visible du processus serveur, ou l'appel OpenAI échoue (le gabarit est alors conservé silencieusement). | Vérifier la variable dans le shell de lancement. Les échecs OpenAI ne sont pas journalisés ([`openai.ts`](../src/server/adapters/openai.ts)) : pour diagnostiquer, tester la clé directement avec `curl https://api.openai.com/v1/models -H "Authorization: Bearer $AI_API_KEY"`. |
| Une installation échoue sur un paquet très récent | Garde-fou de 24 heures de `bunfig.toml`. | Attendre, ou choisir la version précédente. |

## Pour aller plus loin

- [Architecture](02-architecture.md) pour comprendre comment le code est organisé.
- [Référence API](03-reference-api.md) pour appeler ou étendre l'API.
- [Exploitation](09-exploitation.md) pour les tests, le déploiement, les incidents et les exports.
