# KORA Newsroom IA — Inovallée

Espace éditorial d'Inovallée. KORA suit les entreprises de l'écosystème grenoblois, collecte leurs actualités, les regroupe en signaux notés et sourcés, aide à rédiger des articles, fait approuver chaque version et prépare la diffusion sur WordPress, LinkedIn et la newsletter.

![Dashboard éditorial](docs/images/dashboard.webp)

## Ce que fait l'application

La chaîne de travail va du registre à la diffusion : **registre → collecte → signaux notés → dossier factuel et brouillon → approbation par version et par canal → diffusion**. Toute diffusion repose sur une version approuvée ; une modification invalide l'approbation.

| Écran | Rôle |
|---|---|
| Dashboard | Indicateurs, activité éditoriale, actualités détectées, calendrier. |
| Veille | Sources de chaque entreprise ; lancement de la collecte (flux RSS/Atom, Google News, Perplexity) et historique des collectes. |
| Signaux | Articles regroupés par événement, score éditorial sur 10, indicateur documentaire. |
| Articles | Dossier factuel, brouillons sourcés, import, versions et approbations. |
| LinkedIn | Variantes de posts ; publication sur le compte LinkedIn de la personne qui publie si elle l'a relié, sinon export. |
| Newsletter | Composition et export HTML / texte (l'envoi reste manuel). |
| Entreprises | Registre des entreprises suivies (150 au maximum). |
| Paramètres | Grille de score, référentiel éditorial, utilisateurs et rôles, quotas et budget, exports, journal d'audit. |

Les brouillons sont envoyés à WordPress par l'API REST du site ; cet envoi reste simulé en mode démonstration et sous Vitest. Les textes sont produits par des gabarits, puis réécrits par OpenAI si une clé est configurée.

## Collecte

La collecte est réelle et se lance à la main (« Lancer la collecte » sur la page Veille, ou la relance d'une source) : aucune collecte n'est planifiée.

- Chaque entreprise reçoit à sa création une source presse « Google News — nom ». On peut lui ajouter des flux RSS/Atom et des pages d'actualités.
- Les recherches presse sont enrichies par Perplexity, appelé par la passerelle de connexion de la plateforme d'hébergement. Seuls sont gardés les résultats datés, hors du site de l'entreprise, qui la citent. Si Google News échoue, les résultats Perplexity sont quand même enregistrés et la collecte signale l'échec.
- Seules les publications datées de moins de 30 jours sont gardées. Chaque source apporte au plus 3 nouvelles publications par collecte.
- Une seule collecte à la fois : une seconde demande reçoit « Une collecte est déjà en cours ».
- La provenance de chaque publication (flux, Google News, Perplexity) est visible dans la fiche du signal et dans l'export des observations.

## Stack

- **TanStack Start** (React 19) : pages et API métier `/api` dans le même projet, rendu serveur.
- **TanStack Query**, **Tailwind CSS v4**, composants **shadcn/ui**.
- **Vite** et **Nitro**, build pour **Cloudflare Workers**.
- **Supabase** : base PostgreSQL et authentification.
- **Vitest**, **TypeScript** strict, **bun** comme gestionnaire de paquets.

## Démarrer en local

Prérequis : Node.js 24 et bun 1.2.

```bash
nvm use 24
bun install
SUPABASE_URL= bun run dev   # http://localhost:8080
```

**Le `SUPABASE_URL=` vide est indispensable.** Le fichier `.env` versionné contient l'adresse de la base de production. Une fois la variable vidée, l'application tourne en **mode démonstration** :

- les données sont en mémoire, réinitialisées à chaque redémarrage ;
- il n'y a pas de connexion à saisir ; on change de profil depuis le menu utilisateur, en haut à droite.

| Profil | Rôles |
|---|---|
| Sophie Martin (par défaut) | administratrice, rédactrice, validatrice |
| Lucas Bernard | rédacteur |
| Claire Dubois | validatrice |
| Marc Lefèvre | lecteur |

## Commandes

| Commande | Effet |
|---|---|
| `bun run dev` | Serveur de développement avec rechargement à chaud. |
| `bun run test` | Suite Vitest (base en mémoire, collecte simulée, sans réseau). |
| `npx tsc --noEmit -p .` | Vérification TypeScript. |
| `bun run lint` | ESLint et Prettier. |
| `bun run build` | Build de production dans `.output/`. |

## Authentification et rôles

- **Production.** Connexion par e-mail et mot de passe (Supabase Auth). Les comptes se créent **sur invitation uniquement**, depuis Paramètres > Utilisateurs & rôles. Le premier administrateur est l'adresse inscrite dans `KORA_ADMIN_EMAILS`, et seulement tant qu'aucun administrateur actif n'existe.
- **Mode démonstration et tests.** Pas de connexion : les profils ci-dessus.
- **Quatre rôles** : administrateur, rédacteur, validateur, lecteur. Les droits sont vérifiés côté serveur à chaque requête.

## Configuration

Les variables publiques sont dans `.env` (versionné). Les secrets sont lus côté serveur uniquement et enregistrés dans la console d'hébergement. Ils ne doivent jamais figurer dans le dépôt.

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Adresse et clé publique de la base (publiques, dans `.env`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Accès serveur à la base. **Secret.** |
| `KORA_PUBLIC_URL` | Adresse publique de l'application, utilisée dans les liens d'invitation et le retour OAuth LinkedIn. |
| `KORA_ADMIN_EMAILS` | Adresse(s) autorisée(s) à devenir le premier administrateur, séparées par des virgules. |
| `LOVABLE_API_KEY` | Accès à la passerelle de connexion de la plateforme d'hébergement, utilisée pour LinkedIn et Perplexity. **Secret.** |
| `LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY` | Connecteur LinkedIn de la passerelle (OAuth et publication au nom de l'utilisateur). **Secret.** |
| `PERPLEXITY_API_KEY` | Facultative. Clé de la connexion Perplexity de la passerelle, pour enrichir les recherches presse. Sans elle, la collecte se fait avec Google News seul et l'historique des collectes indique « Non configuré ». **Secret.** |
| `APP_USER_CONNECTION_KEY_SECRET` | Chiffrement des connexions LinkedIn stockées en base. **Secret, à ne jamais changer** : les connexions existantes deviendraient illisibles. |
| `AI_API_KEY` | Facultative. Clé OpenAI pour réécrire les textes générés. **Secret.** |
| `WORDPRESS_URL` | Adresse du site WordPress (`https://`, avec le sous-dossier d'installation éventuel). Les brouillons y sont envoyés par l'API REST. |
| `WORDPRESS_USERNAME` | Identifiant du compte WordPress dédié à KORA, de rôle **Contributeur** : il crée des brouillons et ne peut rien publier. |
| `WORDPRESS_APP_PASSWORD` | Mot de passe d'application de ce compte (Profil > Mots de passe d'application), pas son mot de passe de connexion. **Secret.** |
| `LOVABLE_DB_MIGRATION_URL` | Connexion utilisée pour appliquer les migrations de `drizzle/migrations/`. |

Sans les trois variables `WORDPRESS_*`, l'envoi vers WordPress répond « WordPress n'est pas configuré » en production. En mode démonstration et sous Vitest, il reste simulé : aucun site n'est contacté. L'état de la configuration et la correspondance des catégories se règlent dans Paramètres > WordPress.

## Organisation du code

```text
src/
├── routes/          Pages (routage par fichiers) et routes serveur
├── components/      Composants par écran, plus ui/ (shadcn)
├── lib/api/         Contrat front/back : types, client HTTP, hooks
├── server/          API métier : routeur, handlers, services, domaine, dépôt de données, adaptateurs
│   ├── auth/        Sessions, comptes et invitations
│   ├── linkedin/    Connexion et publication LinkedIn
│   ├── wordpress/   Client REST WordPress, configuration et envoi des brouillons
│   └── store/       Dépôt en base (production) et en mémoire (tests, démonstration)
├── integrations/    Clients Supabase et passerelle de connexion
└── test/            Tests Vitest
drizzle/migrations/  Schéma de la base
db/data/             Scripts de données ponctuels, exécutés à la main
docs/                Documentation complète
```

## Hébergement et base

Hébergement et base : **Lovable Cloud** (base PostgreSQL et authentification Supabase, exécution sur Cloudflare Workers) ; synchronisation avec l'éditeur sur `main`. Chaque commit poussé sur `main` arrive dans l'éditeur, et les modifications faites dans l'éditeur arrivent sur `main`. La mise en production se lance depuis l'éditeur. Un déploiement hors de cette plateforme est décrit dans [Exploitation](docs/09-exploitation.md#déploiement).

## Contribuer

Lire [`CONTRIBUTING.md`](CONTRIBUTING.md) avant le premier commit. La règle principale : **ne jamais réécrire l'historique de `main`** (pas de `push --force`, de rebase ni d'amend de commits déjà poussés).

## Documentation

La documentation détaillée est dans [`docs/`](docs/README.md) : démarrage, architecture, référence API, dictionnaire des données, règles métier, sécurité et flux tiers, frontend, guide utilisateur, exploitation, couverture du cahier des charges et anomalies connues.
