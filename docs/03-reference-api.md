# Référence de l'API REST `/api`

**Objet.** Ce document décrit, endpoint par endpoint, l'API métier servie sous `/api` par KORA Newsroom IA : conventions d'échange, session, droits, validation, codes d'erreur, effets de bord (audit, notifications, budget, approbations) et correspondance avec le client front `api.*`. Il s'adresse aux ingénieurs qui consomment, modifient ou étendent l'API. Les règles métier détaillées (scoring, indicateur documentaire, regroupement) sont dans [Règles métier](05-regles-metier.md), le détail des champs stockés dans le [Dictionnaire des données](04-dictionnaire-des-donnees.md), et les mécanismes de sécurité (CSRF, SSRF, nettoyage HTML) dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

Source de vérité : la table `ROUTES` de [`router.ts`](../src/server/router.ts) (65 routes), les handlers de [`src/server/handlers/`](../src/server/handlers/), les schémas de [`validation.ts`](../src/server/validation.ts) et le contrat [`types.ts`](../src/lib/api/types.ts). Les comportements cités sont couverts par les tests [`src/test/server/`](../src/test/server/).

> L'API fonctionne sur un **store en mémoire** réinitialisé à chaque redémarrage du serveur à partir du seed déterministe ([`seed.ts`](../src/server/store/seed.ts)) : les identifiants de démonstration cités (`sig_pasqal`, `art_pasqal`, `li_pasqal`, `nl_current`…) existent au démarrage, et toute écriture est perdue au redémarrage. La collecte, WordPress et LinkedIn sont **simulés** par des adaptateurs (voir [Sécurité et flux tiers](06-securite-et-flux-tiers.md)).

## Sommaire

- [Récapitulatif des endpoints](#recapitulatif)
- [1. Conventions générales](#conventions)
  - [Traitement d'une requête](#traitement) · [Routage, 404, 405, OPTIONS](#routage) · [Format des échanges et limites de taille](#format) · [En-tête anti-CSRF](#csrf) · [Session et utilisateur courant](#session-cookie) · [Droits](#droits) · [Validation des corps](#validation) · [Format des erreurs](#format-erreurs) · [Table des codes d'erreur](#erreurs) · [Listes, filtres et pagination](#listes) · [Dates et fuseau horaire](#dates) · [Budget API et quotas](#budget) · [Audit et notifications](#audit-notifications)
- [2. Session et utilisateurs](#session)
- [3. Dashboard, recherche, consommation, journal](#exploitation)
- [4. Exports et téléchargements](#exports)
- [5. Entreprises](#entreprises)
- [6. Sources et collecte](#sources)
- [7. Signaux et grilles de score](#signaux)
- [8. Articles, dossier factuel et publication](#articles)
- [9. Imports humains](#imports)
- [10. LinkedIn](#linkedin)
- [11. Newsletters](#newsletters)
- [12. Editorial DNA](#editorial-dna)
- [13. Ajouter un endpoint](#ajouter-un-endpoint)
- [14. Limites connues de l'API](#limites)

<a id="recapitulatif"></a>

## Récapitulatif des endpoints

Tous les chemins sont préfixés par `/api`. La colonne « Rôles » indique les rôles autorisés ; « tous » inclut le lecteur. Le détail des droits est donné dans [Droits](#droits).

| Méthode | Chemin | Rôles | Résumé |
|---|---|---|---|
| GET | [`/api/me`](#get-me) | tous | Utilisateur courant |
| POST | [`/api/me`](#post-me) | tous | Changer d'utilisateur de démonstration (cookie) |
| GET | [`/api/users`](#get-users) | tous | Liste des utilisateurs |
| GET | [`/api/notifications`](#get-notifications) | tous | 50 dernières notifications |
| POST | [`/api/notifications/read`](#post-notifications-read) | tous | Marquer toutes les notifications comme lues |
| GET | [`/api/dashboard`](#get-dashboard) | tous | Tableau de bord calculé sur une période |
| GET | [`/api/search`](#get-search) | tous | Recherche globale |
| GET | [`/api/usage`](#get-usage) | tous | Consommation et quotas du mois |
| GET | [`/api/audit`](#get-audit) | tous | Journal d'audit |
| GET | [`/api/export/manifest`](#get-export-manifest) | tous | Manifeste de réversibilité (fichier JSON) |
| GET | [`/api/export/:entity`](#get-export-entity) | tous | Export CSV ou JSON d'une entité |
| GET | [`/api/companies`](#get-companies) | tous | Liste des entreprises du registre |
| POST | [`/api/companies`](#post-companies) | admin, rédacteur | Ajouter une entreprise |
| GET | [`/api/companies/:id`](#get-company) | tous | Fiche entreprise et ses sources |
| PATCH | [`/api/companies/:id`](#patch-company) | admin, rédacteur | Modifier une entreprise |
| DELETE | [`/api/companies/:id`](#delete-company) | admin | Retirer une entreprise du registre |
| GET | [`/api/sources`](#get-sources) | tous | Liste des sources |
| POST | [`/api/sources`](#post-sources) | admin, rédacteur | Ajouter une source |
| PATCH | [`/api/sources/:id`](#patch-source) | admin, rédacteur | Modifier une source |
| DELETE | [`/api/sources/:id`](#delete-source) | admin, rédacteur | Supprimer une source |
| POST | [`/api/sources/:id/collect`](#post-source-collect) | admin, rédacteur | Collecter une source (simulé, payant) |
| POST | [`/api/collect`](#post-collect) | admin, rédacteur | Collecter toutes les sources actives |
| GET | [`/api/collection-runs`](#get-collection-runs) | tous | Historique des exécutions de collecte |
| GET | [`/api/signals`](#get-signals) | tous | Liste filtrée et paginée des signaux |
| POST | [`/api/signals/rescore`](#post-signals-rescore) | admin | Recalculer les scores avec la grille active |
| GET | [`/api/signals/:id`](#get-signal) | tous | Détail d'un signal et de ses observations |
| PATCH | [`/api/signals/:id`](#patch-signal) | admin, rédacteur | Statut, rattachement, inclusion newsletter |
| POST | [`/api/signals/:id/merge`](#post-signal-merge) | admin, rédacteur | Fusionner des signaux |
| POST | [`/api/signals/:id/split`](#post-signal-split) | admin, rédacteur | Défusionner des observations |
| GET | [`/api/scoring-grids`](#get-scoring-grids) | tous | Historique des grilles de score |
| POST | [`/api/scoring-grids`](#post-scoring-grids) | admin | Créer et activer une grille |
| GET | [`/api/articles`](#get-articles) | tous | Liste des articles |
| POST | [`/api/articles`](#post-articles) | admin, rédacteur | Générer dossier et brouillon depuis un signal (payant) |
| GET | [`/api/articles/:id`](#get-article) | tous | Détail d'un article |
| POST | [`/api/articles/:id/versions`](#post-article-versions) | admin, rédacteur | Enregistrer une nouvelle version |
| POST | [`/api/articles/:id/restore`](#post-article-restore) | admin, rédacteur | Restaurer une version (nouvelle version) |
| POST | [`/api/articles/:id/submit`](#post-article-submit) | admin, rédacteur | Soumettre à validation |
| POST | [`/api/articles/:id/approve`](#post-article-approve) | admin, validateur | Approuver une version pour un canal |
| POST | [`/api/articles/:id/reject`](#post-article-reject) | admin, validateur | Rejeter avec motif |
| POST | [`/api/articles/:id/publish`](#post-article-publish) | admin, validateur | Envoyer vers un canal (idempotent) |
| PATCH | [`/api/articles/:id/fact-checks/:fid`](#patch-article-fact-check) | admin, rédacteur, validateur | Arbitrer un fait du dossier |
| GET | [`/api/publications`](#get-publications) | tous | Tentatives de publication |
| GET | [`/api/imports`](#get-imports) | tous | Liste des imports humains |
| POST | [`/api/imports`](#post-imports) | admin, rédacteur | Importer un fichier TXT ou DOCX (multipart) |
| PATCH | [`/api/imports/:id/proposals/:pid`](#patch-import-proposal) | admin, rédacteur | Décider d'une proposition de correction |
| POST | [`/api/imports/:id/convert`](#post-import-convert) | admin, rédacteur | Convertir l'import en article |
| GET | [`/api/linkedin`](#get-linkedin) | tous | Liste des posts LinkedIn |
| POST | [`/api/linkedin`](#post-linkedin) | admin, rédacteur | Générer un post (variantes, payant) |
| PATCH | [`/api/linkedin/:id`](#patch-linkedin) | admin, rédacteur | Modifier variantes ou sélection |
| POST | [`/api/linkedin/:id/submit`](#post-linkedin-submit) | admin, rédacteur | Soumettre à validation |
| POST | [`/api/linkedin/:id/approve`](#post-linkedin-approve) | admin, validateur | Approuver la version relue |
| POST | [`/api/linkedin/:id/publish`](#post-linkedin-publish) | admin, validateur | Exporter (API LinkedIn non disponible) |
| GET | [`/api/linkedin/:id/export`](#get-linkedin-export) | tous | Télécharger le texte du post |
| GET | [`/api/newsletters`](#get-newsletters) | tous | Liste des éditions |
| POST | [`/api/newsletters`](#post-newsletters) | admin, rédacteur | Créer une édition |
| GET | [`/api/newsletters/:id`](#get-newsletter) | tous | Détail d'une édition |
| PATCH | [`/api/newsletters/:id`](#patch-newsletter) | admin, rédacteur | Titre, introduction, ordre et résumés |
| POST | [`/api/newsletters/:id/items`](#post-newsletter-items) | admin, rédacteur | Ajouter un sujet (résumé payant) |
| DELETE | [`/api/newsletters/:id/items/:itemId`](#delete-newsletter-item) | admin, rédacteur | Retirer un sujet |
| POST | [`/api/newsletters/:id/approve`](#post-newsletter-approve) | admin, validateur | Approuver la version relue |
| GET | [`/api/newsletters/:id/export`](#get-newsletter-export) | tous | Télécharger HTML ou texte (export consigné si droit de diffusion) |
| GET | [`/api/editorial-dna`](#get-editorial-dna) | tous | Règles, exemples et propositions |
| POST | [`/api/editorial-dna/rules`](#post-editorial-dna-rules) | admin | Créer une règle éditoriale |
| PATCH | [`/api/editorial-dna/rules/:id`](#patch-editorial-dna-rule) | admin | Modifier ou désactiver une règle |
| PATCH | [`/api/editorial-dna/proposals/:id`](#patch-editorial-dna-proposal) | admin | Accepter ou refuser une proposition |

<a id="conventions"></a>

## 1. Conventions générales

<a id="traitement"></a>

### Traitement d'une requête

Toutes les requêtes `/api/*` arrivent dans la route fichier [`src/routes/api/$.ts`](../src/routes/api/$.ts) (handler `ANY`), qui délègue à [`handleApiRequest`](../src/server/router.ts). Les contrôles transverses sont appliqués dans cet ordre :

```mermaid
flowchart TD
  A[Requête /api/...] --> B[Chemin normalisé : préfixe /api et / finaux retirés ; HEAD traité comme GET]
  B --> C{Méthode autre que GET / OPTIONS<br/>sans x-kora-request: 1 ?}
  C -- oui --> E403[403 csrf_header_missing]
  C -- non --> D{Route trouvée dans ROUTES ?}
  D -- "chemin connu, autre méthode" --> F{OPTIONS ?}
  F -- oui --> O204[204 + en-tête allow]
  F -- non --> E405[405 method_not_allowed + allow]
  D -- "chemin inconnu" --> E404[404 not_found]
  D -- oui --> G[Utilisateur : cookie kora_uid, sinon u_sophie]
  G --> H[Corps : JSON 1 Mo pour POST / PATCH / DELETE, multipart pour POST /imports]
  H --> I[Handler : droits, validation, règles, persistance, audit]
  I --> J[Réponse JSON ou fichier]
  I -. HttpError .-> K[ApiErrorBody avec le statut de l'erreur]
  I -. autre exception .-> L[500 internal_error]
```

Le handler reçoit un contexte [`Ctx`](../src/server/context.ts) : `request`, `url`, `params` (paramètres de chemin décodés), `query` (`URLSearchParams`), `repo` (le [`Repository`](../src/server/store/repository.ts)), `user` (utilisateur courant), `now` (horloge de [`clock.ts`](../src/server/clock.ts), figeable dans les tests), `body` (JSON ou `undefined`) et `form` (`FormData` pour la route multipart, sinon `null`).

<a id="routage"></a>

### Routage, 404, 405, OPTIONS

- Un motif de `ROUTES` correspond si le nombre de segments est identique, si les segments littéraux sont égaux et si chaque segment `:param` peut être décodé par `decodeURIComponent` (un encodage invalide ne correspond à aucune route). Les barres obliques multiples ou finales sont ignorées (`/api/signals/` équivaut à `/api/signals`).
- La première route de même méthode qui correspond l'emporte : `GET /export/manifest` est déclarée avant `GET /export/:entity`. À l'inverse, `GET /api/signals/rescore` est servi par `GET /signals/:id` (identifiant « rescore », donc 404 « Signal introuvable. »), car `rescore` n'existe qu'en `POST`.
- Chemin inconnu : `404 not_found` (« Ressource inconnue : /chemin. »).
- Chemin connu avec une autre méthode : `405 method_not_allowed`, avec un en-tête `allow` listant les méthodes acceptées (ex. `PUT /api/me` avec l'en-tête anti-CSRF renvoie `allow: GET, POST` ; sans l'en-tête, `403`).
- `OPTIONS` sur un chemin connu : `204` sans corps, avec `allow`. Sur un chemin inconnu : `404`. Aucun en-tête CORS (`access-control-*`) n'est émis : l'API est prévue pour la même origine que le front.
- `HEAD` est traité exactement comme `GET`, y compris ses effets de bord (voir [`GET /api/newsletters/:id/export`](#get-newsletter-export)).

Le contrôle anti-CSRF précède la résolution de la route : une écriture sans en-tête sur un chemin inconnu reçoit `403`, pas `404`.

```bash
# Méthodes acceptées sur un chemin (204 + allow: GET, PATCH)
curl -s -i -X OPTIONS http://localhost:8080/api/signals/sig_pasqal
```

<a id="format"></a>

### Format des échanges et limites de taille

- **Requêtes** : corps JSON pour `POST`, `PATCH` et `DELETE` (lu aussi pour `DELETE`, même vide). L'en-tête `content-type` n'est pas vérifié côté serveur (le client [`apiFetch`](../src/lib/api/client.ts) envoie `application/json`). Un corps vide vaut `undefined` et est validé comme `{}`. Un JSON illisible renvoie `400 invalid_json`.
- **Taille JSON** : 1 Mo maximum (`MAX_JSON_BYTES = 1024 * 1024` dans [`router.ts`](../src/server/router.ts)). Au-delà, `413 payload_too_large`, d'abord sur l'en-tête `content-length`, puis sur la longueur du texte lu.
- **Multipart** : seule la route `POST /api/imports` (drapeau `multipart: true` dans `ROUTES`) attend `multipart/form-data` avec les champs `file` et `author`. Une requête non multipart y reçoit `400 multipart_required`, un corps illisible `400 invalid_multipart`. Le fichier est limité à 10 Mio (`MAX_IMPORT_BYTES` de [`imports.ts`](../src/server/domain/imports.ts)) : refus `413 file_too_large` si `content-length` dépasse 10 Mio + 64 Kio, puis si la taille du fichier dépasse 10 Mio.
- **Réponses JSON** : produites par `json()` de [`http.ts`](../src/server/http.ts), avec `content-type: application/json` et `cache-control: no-store`. Statuts de succès : `200` (lecture, modification), `201` (création, nouvelle version, publication effective), `204` sans corps (suppressions, `POST /api/notifications/read`).
- **Fichiers** (exports CSV/JSON, newsletter HTML/texte, post LinkedIn) : produits par `fileResponse()`, statut `200`, en-têtes `content-disposition: attachment; filename="…"; filename*=UTF-8''…`, `cache-control: no-store`, `x-content-type-options: nosniff`. Les CSV commencent par un BOM UTF-8.
- **Identifiants** : les enregistrements créés reçoivent un identifiant `<préfixe>_n<compteur>` (`Repository.nextId`), par exemple `sig_n1042`, `art_n…`, `pub_n…`. Exceptions : entreprises (`co_<nom-normalisé>`), grilles (`grid_v<version>`), faits du dossier (`fc_<articleId>_<i>`), propositions d'import (`<importId>_p<i>`), variantes LinkedIn (`<postId>_v<i>`).

<a id="csrf"></a>

### En-tête anti-CSRF

Toute requête dont la méthode n'est ni `GET` (ni `HEAD`) ni `OPTIONS` doit porter l'en-tête `x-kora-request: 1`. Sinon : `403 csrf_header_missing` (« En-tête x-kora-request manquant : requête d'écriture refusée. »), avant tout traitement. Le client `apiFetch` l'ajoute à toutes les requêtes. Le test « protection CSRF » de [`security.test.ts`](../src/test/server/security.test.ts) le vérifie sur `POST /me`, `POST /articles`, `PATCH /signals/:id` et `DELETE /companies/:id`. Le raisonnement de sécurité est détaillé dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

```json
{ "error": { "code": "csrf_header_missing", "message": "En-tête x-kora-request manquant : requête d'écriture refusée." } }
```

<a id="session-cookie"></a>

### Session et utilisateur courant

- L'utilisateur courant est lu dans le cookie `kora_uid` (`SESSION_COOKIE` de [`http.ts`](../src/server/http.ts)). Cookie absent ou identifiant inconnu : l'utilisateur par défaut `DEFAULT_USER_ID` (`u_sophie`, [`seed.ts`](../src/server/store/seed.ts)) est utilisé, sans erreur.
- Le cookie est posé par [`POST /api/me`](#post-me) : `kora_uid=<id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` (30 jours).
- **Il n'existe aucune authentification** (ni mot de passe, ni jeton, ni SSO) : c'est un mécanisme de démonstration. Toute requête sans cookie agit en tant qu'administratrice.

| Identifiant | Nom | Équipe | Rôles |
|---|---|---|---|
| `u_sophie` | Sophie Martin | Équipe Communication | `admin`, `redacteur`, `validateur` (défaut) |
| `u_lucas` | Lucas Bernard | Équipe Communication | `redacteur` |
| `u_claire` | Claire Dubois | Direction | `validateur` |
| `u_marc` | Marc Lefèvre | Développement économique | `lecteur` |

Dans les exemples `curl`, l'utilisateur est choisi avec `-b 'kora_uid=u_lucas'`.

<a id="droits"></a>

### Droits

Les droits sont vérifiés côté serveur par `assertCan(ctx.user, action)` de [`permissions.ts`](../src/server/domain/permissions.ts), au début de chaque handler d'écriture. Un utilisateur est autorisé si l'un de ses rôles figure dans la matrice `MATRIX`. Les lectures (`GET`) ne vérifient aucun droit : le lecteur voit et exporte tout.

| Action | Rôles | Endpoints |
|---|---|---|
| `registry.write` | admin, rédacteur | `POST`/`PATCH /companies`, `POST`/`PATCH`/`DELETE /sources` |
| `registry.delete` | admin | `DELETE /companies/:id` |
| `collect` | admin, rédacteur | `POST /sources/:id/collect`, `POST /collect` |
| `signal.write` | admin, rédacteur | `PATCH /signals/:id` (statut, motif, rattachement), `merge`, `split` |
| `article.write` | admin, rédacteur | `POST /articles`, `versions`, `restore`, `submit` ; arbitrage `fact-checks` |
| `article.decide` | admin, validateur | `approve`, `reject` ; arbitrage `fact-checks` |
| `publish` | admin, validateur | `POST /articles/:id/publish`, `POST /linkedin/:id/publish` ; consignation de l'export newsletter |
| `import.write` | admin, rédacteur | `POST /imports`, `PATCH …/proposals/:pid`, `POST …/convert` |
| `linkedin.write` | admin, rédacteur | `POST /linkedin`, `PATCH /linkedin/:id`, `submit` |
| `linkedin.decide` | admin, validateur | `POST /linkedin/:id/approve` |
| `newsletter.write` | admin, rédacteur | `POST`/`PATCH /newsletters`, ajout et retrait de sujets ; `PATCH /signals/:id` avec `inNewsletter` |
| `newsletter.decide` | admin, validateur | `POST /newsletters/:id/approve` |
| `grid.write` | admin | `POST /scoring-grids`, `POST /signals/rescore` |
| `rule.write` | admin | `POST`/`PATCH /editorial-dna/rules`, `PATCH /editorial-dna/proposals/:id` |

Un refus renvoie `403 forbidden` avec un message explicite composé du message de la matrice et du profil, par exemple : « La rédaction, la modification et la soumission d'articles sont réservées aux rédacteurs. Votre profil (Validateur) ne le permet pas. » `POST /api/me` et `POST /api/notifications/read` ne vérifient aucun droit.

<a id="validation"></a>

### Validation des corps

Les corps JSON sont validés par les schémas zod `schemas.*` de [`validation.ts`](../src/server/validation.ts), via `parse(schema, ctx.body)`. En cas d'échec : `400 validation_error`, message « Requête invalide : `<champ>` — `<message>` » construit sur le premier problème, et la liste complète dans `details.issues`.

- Les chaînes déclarées avec l'aide `text(max)` sont rognées (`trim`) et doivent contenir au moins un caractère.
- Les champs inconnus sont ignorés (comportement par défaut de `z.object`).
- Les messages de zod sont en anglais, sauf les messages personnalisés (« Le motif de rejet est obligatoire », « articleId ou signalId est requis », « signalId ou articleId est requis », « Date ISO 8601 attendue »).
- Les énumérations partagées sont exportées par `validation.ts` : `THEMES`, `CATEGORIES`, `SIGNAL_STATUSES`, `CHANNELS`, `SOURCE_TYPES`, `RULE_KINDS`.

Exemple (`POST /api/companies` avec `{"name":"X"}`, cas du test « répond au format ApiErrorBody ») :

```json
{
  "error": {
    "code": "validation_error",
    "message": "Requête invalide : name — String must contain at least 2 character(s)",
    "details": {
      "issues": [
        { "path": "name", "message": "String must contain at least 2 character(s)" },
        { "path": "domain", "message": "Required" },
        { "path": "sector", "message": "Required" }
      ]
    }
  }
}
```

<a id="format-erreurs"></a>

### Format des erreurs

Toute erreur suit le type [`ApiErrorBody`](../src/lib/api/types.ts) :

```ts
interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
```

- `code` est stable et destiné au code client ; `message` est en français et destiné à l'affichage ; `details` est présent seulement pour certaines erreurs (champs fautifs, identifiant en conflit, tentative de publication bloquée…).
- Les erreurs métier sont levées sous forme de `HttpError` ([`http.ts`](../src/server/http.ts)) via les aides `badRequest`, `forbidden`, `notFound`, `conflict`, `unprocessable`. Aucune trace de pile n'est renvoyée (vérifié par le test « répond au format ApiErrorBody sans trace de pile »).
- Toute autre exception est journalisée côté serveur (`console.error("[api] erreur interne", …)`) et renvoie `500 internal_error` (« Erreur interne du serveur. »).
- Côté front, `apiFetch` convertit la réponse en `ApiError(status, code, message, details)` ; si le corps n'est pas un `ApiErrorBody`, `code` vaut `http_error`.

Exemples réels (instance de démonstration) :

```bash
curl -s http://localhost:8080/api/inconnu
# {"error":{"code":"not_found","message":"Ressource inconnue : /inconnu."}}
curl -s 'http://localhost:8080/api/signals?status=inconnu'
# {"error":{"code":"invalid_filter","message":"Statut inconnu : inconnu"}}
curl -s 'http://localhost:8080/api/export/signals?format=xml'
# {"error":{"code":"invalid_format","message":"Format attendu : csv ou json."}}
```

<a id="erreurs"></a>

### Table des codes d'erreur

Liste exhaustive des codes émis par le serveur (recherche de tous les `HttpError` et aides associées, plus les codes dynamiques de `checkPublishable` et de `ImportFormatError`). La colonne `details` indique le contenu de `error.details` quand il existe.

| HTTP | `code` | Cause | `details` |
|---|---|---|---|
| 400 | `invalid_json` | Corps JSON illisible | — |
| 400 | `validation_error` | Corps non conforme au schéma zod | `{ issues: [{ path, message }] }` |
| 400 | `multipart_required` | `POST /imports` sans `multipart/form-data` | — |
| 400 | `invalid_multipart` | Corps multipart illisible | — |
| 400 | `file_required` | Champ `file` absent | — |
| 400 | `author_required` | Champ `author` absent ou vide | — |
| 400 | `invalid_period` | `from`/`to` du dashboard invalides ou inversés | — |
| 400 | `invalid_format` | `format` d'export non pris en charge | — |
| 402 | `budget_exhausted` | Plafond budgétaire API atteint ou réservation refusée | — |
| 403 | `csrf_header_missing` | Écriture sans `x-kora-request: 1` | — |
| 403 | `forbidden` | Rôle insuffisant | — |
| 404 | `not_found` | Route, enregistrement ou sous-élément inconnu | — |
| 405 | `method_not_allowed` | Méthode non déclarée pour ce chemin (en-tête `allow`) | — |
| 409 | `duplicate_company` | Nom ou domaine déjà utilisé | `{ companyId }` |
| 409 | `duplicate_source` | URL déjà suivie pour cette entreprise | `{ sourceId }` |
| 409 | `source_disabled` | Collecte d'une source désactivée | — |
| 409 | `article_exists` | Un article existe déjà pour ce signal | `{ articleId }` |
| 409 | `already_current` | Restauration de la version courante | — |
| 409 | `invalid_state` | Transition interdite depuis l'état courant (article, post, édition) | — |
| 409 | `version_mismatch` | Approbation d'une version qui n'est plus la courante | `{ currentVersion }` |
| 409 | `already_converted` | Import déjà converti en article | `{ articleId }` (conversion seulement) |
| 409 | `post_exists` | Post LinkedIn déjà en préparation pour ce contenu | `{ postId }` |
| 409 | `already_in_newsletter` | Sujet déjà présent dans l'édition | `{ itemId }` |
| 409 | `already_decided` | Proposition de règle déjà traitée | — |
| 413 | `payload_too_large` | Corps JSON supérieur à 1 Mo | — |
| 413 | `file_too_large` | Fichier importé supérieur à 10 Mio | `{ maxBytes }` |
| 415 | `unsupported_format` | Fichier autre que `.txt` ou `.docx` (extension et type MIME) | `{ filename, mime }` |
| 415 | `invalid_encoding` | Fichier texte non UTF-8 | — |
| 415 | `invalid_docx` | Archive DOCX invalide ou sans `word/document.xml` | — |
| 422 | `domain_invalid` | Domaine officiel mal formé | — |
| 422 | `url_refused` | URL ou domaine refusé par le filtrage SSRF | `{ url }` (sources seulement) |
| 422 | `invalid_access` | `access: "erreur"` demandé manuellement | — |
| 422 | `quota_exceeded` | Quota atteint (articles, posts, éditions, entreprises, sources, stockage) | `{ limit }` |
| 422 | `invalid_filter` | `status`, `category` ou `theme` inconnu dans `GET /signals` | — |
| 422 | `reason_required` | Rejet d'un signal sans motif | — |
| 422 | `invalid_merge` | Fusion d'un signal avec lui-même | — |
| 422 | `company_mismatch` | Fusion de signaux d'entreprises différentes | — |
| 422 | `invalid_split` | Observations étrangères au signal, ou aucune restante | `{ observationIds }` (observations étrangères) |
| 422 | `weights_sum_invalid` | Poids non entiers, hors 0–100, ou somme différente de 100 | `{ weights }` |
| 422 | `signal_rejected` | Rédaction lancée depuis un signal rejeté | — |
| 422 | `version_not_found` | Version à restaurer inexistante | — |
| 422 | `contradiction_unresolved` | Contradiction non arbitrée dans le dossier factuel | approbation : `{ factCheckIds }` ; publication : `{ attempt }` |
| 422 | `schedule_in_past` | `scheduledAt` dans le passé | — |
| 422 | `approval_missing` | Envoi sans approbation valide | `{ attempt }` |
| 422 | `approval_invalidated` | Approbation invalidée (modification, rejet) | `{ attempt }` |
| 422 | `approval_version_mismatch` | Approbation valide mais sur une autre version | `{ attempt }` |
| 422 | `approval_wrong_channel` | Version approuvée pour un autre canal | `{ attempt }` |
| 422 | `variant_not_found` | Variante LinkedIn sélectionnée inexistante | — |
| 422 | `duplicate_variant` | Identifiants de variantes non uniques | — |
| 422 | `item_not_found` | Sujet inconnu dans l'édition (modification groupée) | `{ itemIds }` |
| 422 | `newsletter_empty` | Approbation d'une édition sans sujet | — |
| 500 | `internal_error` | Exception non prévue | — |

Le code `linkedin_api_unavailable` n'est pas une erreur : il figure dans le champ `code` d'une publication LinkedIn **réussie** en mode export (voir [`POST /api/linkedin/:id/publish`](#post-linkedin-publish)). De même, `budget_exhausted` apparaît comme `errorCode` d'une exécution de collecte `bloque_quota`.

<a id="listes"></a>

### Listes, filtres et pagination

Seul `GET /api/signals` est paginé (`limit`, `offset`, réponse [`Paginated<T>`](../src/lib/api/types.ts) `{ items, total }`). Deux autres listes acceptent une limite ; les autres renvoient tout le contenu filtré. Une valeur numérique invalide de `limit` ou `offset` est remplacée par la valeur par défaut ; les valeurs hors bornes sont ramenées dans les bornes. La valeur `tous` désactive un filtre là où elle est indiquée.

| Endpoint | Filtres | Tri | Limite |
|---|---|---|---|
| `GET /signals` | `status` (ou `tous`), `category`, `theme`, `companyId`, `outlet`, `q` | `sort=recent` (défaut) ou `score` | `limit` 50 (1–200), `offset` 0 (0–100 000) |
| `GET /audit` | `entity` (ou `tous`), `entityId` | date décroissante | `limit` 100 (1–1000) |
| `GET /collection-runs` | `sourceId` | début décroissant | `limit` 50 (1–500) |
| `GET /notifications` | — | date décroissante | 50 fixes |
| `GET /search` | `q` (2 caractères normalisés minimum) | par type | 20 résultats maximum |
| `GET /companies` | `q`, `theme` (ou `tous`) | nom (ordre français) | aucune |
| `GET /sources` | `companyId`, `access` (ou `tous`) | dernière exécution (ou création) décroissante | aucune |
| `GET /articles` | `status` (ou `tous`), `origin` (ou `tous`) | mise à jour décroissante | aucune |
| `GET /publications` | `channel` (ou `tous`), `articleId` | date décroissante | aucune |
| `GET /imports`, `GET /newsletters` | — | création décroissante | aucune |
| `GET /linkedin` | — | mise à jour décroissante | aucune |
| `GET /scoring-grids` | — | version décroissante | aucune |

Seuls les filtres de `GET /signals` sont validés (`422 invalid_filter`) ; ailleurs, une valeur inconnue renvoie simplement une liste vide. La recherche textuelle (`q`) utilise `normalize()` de [`text.ts`](../src/server/domain/text.ts) : minuscules, accents retirés, ponctuation remplacée par des espaces, puis recherche de sous-chaîne.

<a id="dates"></a>

### Dates et fuseau horaire

- Toutes les dates renvoyées sont des chaînes ISO 8601 en UTC produites par `toISOString()` (ex. `2026-10-12T16:27:44.903Z`). Une date inconnue vaut `null`, jamais une date inventée (en-tête de [`types.ts`](../src/lib/api/types.ts)).
- En entrée (`from`, `to`, `weekOf`, `scheduledAt`), toute chaîne acceptée par `Date.parse` est admise (aide `isoDate` de `validation.ts`, `parseDate` de [`dates.ts`](../src/server/domain/dates.ts)). Une chaîne réduite à une date (`2026-10-01`) est interprétée par JavaScript comme minuit UTC.
- Les bornes de jour, de semaine et de mois (période du dashboard, mois des quotas `monthKey`, lundi d'une édition, envoi prévu à 9 h, nom des fichiers exportés `isoDay`) sont calculées dans le **fuseau horaire du processus serveur**.
- Dans les données de démonstration, les dates sont relatives à l'instant de démarrage du serveur.

<a id="budget"></a>

### Budget API et quotas

Les opérations « payantes » passent par `paidCall()` de [`usage.ts`](../src/server/services/usage.ts). Le coût estimé (`COSTS` de [`budget.ts`](../src/server/domain/budget.ts)) est **réservé avant l'appel** (`settings.reservedEur`) ; si consommé du mois + réservé + estimation dépasse le plafond `api_budget_eur`, rien n'est appelé, les appels payants sont suspendus pour le mois (`paidCallsSuspended`, `suspendedMonth`) et la requête échoue en `402 budget_exhausted`. La première suspension du mois produit une entrée d'audit `quota.suspension` (acteur « KORA ») et une notification « Budget API : appels payants suspendus ». Après l'appel, la réservation est libérée et une ou plusieurs entrées de consommation sont enregistrées ; si l'appel lève une exception, rien n'est consigné.

| Opération | Endpoints | `UsageKind` | Réservé | Consigné | Compteur d'unités |
|---|---|---|---|---|---|
| Dossier et brouillon | `POST /articles` | `generation_article` | 0,45 € | 0,45 € | `articles` |
| Variantes LinkedIn | `POST /linkedin` | `generation_linkedin` | 0,08 € | 0,08 € | `linkedin_posts` |
| Résumé de sujet newsletter | `POST /newsletters/:id/items`, `PATCH /signals/:id` (`inNewsletter: true`) | `generation_summary` | 0,02 € | 0,02 € | aucun |
| Collecte d'une source | `POST /sources/:id/collect`, `POST /collect` (par source) | `search_query`, `observation` | 0,075 € | 0,012 € + 0,021 € par publication reçue (3 au plus) | `search_queries`, `observations` |

La suspension se lève seulement au changement de mois : aucun endpoint ne permet de modifier les plafonds (`settings.quotaLimits`, initialisés à `DEFAULT_LIMITS`) ni de lever la suspension. La consultation, les exports et les décisions non payantes (approbation, publication, import, conversion) restent disponibles (test « budget épuisé » de [`budget.test.ts`](../src/test/server/budget.test.ts)).

Les quotas d'unités sont vérifiés par `assertQuota()` avant l'action : refus `422 quota_exceeded` (« Quota mensuel atteint : `<libellé>` (`<limite>` maximum). », `details.limit`) si `utilisé + incrément > limite`.

| Compteur (`QuotaMeter.key`) | Limite par défaut | Vérifié par | Mesure |
|---|---|---|---|
| `api_budget_eur` | 150 € HT | `paidCall` (402) | somme des coûts du mois |
| `search_queries` | 3 000 | non bloquant (alertes seulement) | unités `search_query` du mois |
| `observations` | 6 000 | non bloquant (alertes seulement) | unités `observation` du mois |
| `articles` | 25 | `POST /articles` | unités `generation_article` du mois |
| `linkedin_posts` | 25 | `POST /linkedin` | unités `generation_linkedin` du mois |
| `newsletters` | 5 | `POST /newsletters`, création implicite par `PATCH /signals/:id` | éditions créées dans le mois |
| `companies` | 150 | `POST /companies` | nombre d'entreprises (stock) |
| `sources` | 300 | `POST /sources` | nombre de sources (stock) |
| `storage_gb` | 10 Go | `POST /imports` (incrément : taille du fichier) | `storageBaseGb` + taille des imports |

Après chaque appel payant, `checkAlerts()` émet une notification `quota` par compteur (hors `companies` et `sources`) au passage de 80 % puis de 100 %, une seule fois par seuil et par mois. Le jeu de démonstration remplit le quota d'entreprises (150/150) : `POST /api/companies` est refusé tant qu'aucune entreprise n'a été supprimée.

<a id="audit-notifications"></a>

### Audit et notifications

Chaque décision écrit une entrée [`AuditEvent`](../src/lib/api/types.ts) via `audit()` de [`journal.ts`](../src/server/services/journal.ts) : `id`, `at`, `actor` (nom de l'utilisateur courant), `action`, `entity`, `entityId`, `details` (texte en français). Le journal se consulte avec [`GET /api/audit`](#get-audit) et s'exporte avec [`/api/export/audit`](#get-export-entity).

| `action` | `entity` | Émise par |
|---|---|---|
| `user.switch` | `user` | `POST /me` (acteur : l'utilisateur cible) |
| `company.create`, `company.update`, `company.delete` | `company` | `POST`, `PATCH`, `DELETE /companies` |
| `source.create`, `source.update`, `source.delete` | `source` | `POST`, `PATCH`, `DELETE /sources` |
| `collect.all` | `source` (`entityId` `*`) | `POST /collect` |
| `signal.status`, `signal.attach`, `signal.detach` | `signal` | `PATCH /signals/:id` |
| `signal.merge`, `signal.split` | `signal` | `merge`, `split` |
| `grid.create`, `grid.rescore` | `grid` | `POST /scoring-grids`, `POST /signals/rescore` |
| `article.create`, `article.version`, `article.restore`, `article.submit`, `article.approve`, `article.reject`, `article.fact_check` | `article` | endpoints `/articles` correspondants |
| `publication.success`, `publication.blocked` | `publication` | publication article ou LinkedIn, export newsletter consigné |
| `publication.replay` | `publication` | publication article déjà effectuée (pas pour LinkedIn) |
| `import.create`, `import.proposal`, `import.convert` | `import` | endpoints `/imports` |
| `linkedin.create`, `linkedin.update`, `linkedin.submit`, `linkedin.approve` | `linkedin` | endpoints `/linkedin` |
| `newsletter.create`, `newsletter.update`, `newsletter.item_add`, `newsletter.item_remove`, `newsletter.approve` | `newsletter` | endpoints `/newsletters`, `PATCH /signals/:id` |
| `rule.create`, `rule.update`, `rule.proposal` | `rule` | endpoints `/editorial-dna` |
| `quota.suspension` | `quota` (`entityId` `api_budget_eur`) | `paidCall` refusé (acteur « KORA ») |

Les notifications ([`Notification`](../src/lib/api/types.ts)) sont **globales** à l'espace, sans destinataire :

| `kind` | Titre | Déclencheur |
|---|---|---|
| `approbation` | « Article à valider » | `POST /articles/:id/submit` |
| `approbation` | « Article rejeté » | `POST /articles/:id/reject` |
| `approbation` | « Post LinkedIn à valider » | `POST /linkedin/:id/submit` |
| `publication` | « Brouillon WordPress prêt » ou « Export `<canal>` prêt » | `POST /articles/:id/publish` réussi |
| `erreur_source` | « Source en échec : `<entreprise>` » | première collecte en échec d'une source |
| `signal` | « Nouveau signal prioritaire : `<entreprise>` » | collecte créant un signal de score ≥ 80 |
| `quota` | « `<compteur>` : 80 % consommés » ou « quota atteint » | `checkAlerts` après un appel payant |
| `quota` | « Budget API : appels payants suspendus » | première réservation refusée du mois |

<a id="session"></a>

## 2. Session et utilisateurs

Handlers : [`session.ts`](../src/server/handlers/session.ts).

<a id="get-me"></a>

### `GET /api/me` — utilisateur courant

- **Client** : `api.me()` (hook `useMe`).
- **Droit** : aucun.
- **Réponse** : `200` [`User`](../src/lib/api/types.ts).

```bash
curl -s http://localhost:8080/api/me
```

Réponse réelle de l'instance de démonstration (sans cookie, donc utilisatrice par défaut) :

```json
{"id":"u_sophie","name":"Sophie Martin","email":"sophie.martin@inovallee.com","team":"Équipe Communication","roles":["admin","redacteur","validateur"],"avatarUrl":null}
```

<a id="post-me"></a>

### `POST /api/me` — changer d'utilisateur (démonstration)

- **Client** : `api.switchUser(userId)` (menu utilisateur en haut à droite).
- **Droit** : aucun.
- **Réponse** : `200` `User` (le nouvel utilisateur), avec l'en-tête `set-cookie: kora_uid=<id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `userId` | chaîne | oui | 1 à 64 caractères après rognage ; utilisateur existant |

Effets : si l'utilisateur change, entrée d'audit `user.switch` (« Session de démonstration : Sophie Martin → Marc Lefèvre ») dont l'acteur est l'utilisateur **cible**. Erreurs spécifiques : `404 not_found` (« Utilisateur inconnu. »).

```bash
curl -s -i -X POST http://localhost:8080/api/me \
  -H 'x-kora-request: 1' -H 'content-type: application/json' \
  -d '{"userId":"u_marc"}'
```

<a id="get-users"></a>

### `GET /api/users` — utilisateurs

- **Client** : `api.users()` (hook `useUsers`).
- **Droit** : aucun.
- **Réponse** : `200` `User[]`, dans l'ordre du store (les quatre utilisateurs de [Session et utilisateur courant](#session-cookie)).

<a id="get-notifications"></a>

### `GET /api/notifications` — notifications

- **Client** : `api.notifications()` (hook `useNotifications`).
- **Droit** : aucun.
- **Réponse** : `200` [`Notification[]`](../src/lib/api/types.ts), les 50 plus récentes, par date décroissante. Les notifications sont communes à tous les utilisateurs.

<a id="post-notifications-read"></a>

### `POST /api/notifications/read` — tout marquer comme lu

- **Client** : `api.markNotificationsRead()`.
- **Droit** : aucun (le lecteur peut l'appeler).
- **Corps** : aucun.
- **Réponse** : `204`.

Effets : passe `read: true` sur **toutes** les notifications de l'espace, pour tous les utilisateurs. Aucun audit.

<a id="exploitation"></a>

## 3. Dashboard, recherche, consommation, journal

Handlers : [`ops.ts`](../src/server/handlers/ops.ts). Les exports, servis par le même fichier, sont décrits dans [Exports et téléchargements](#exports).

<a id="get-dashboard"></a>

### `GET /api/dashboard` — tableau de bord

- **Client** : `api.dashboard({ from, to })` (hook `useDashboard`).
- **Droit** : aucun.
- **Réponse** : `200` [`Dashboard`](../src/lib/api/types.ts), calculé par [`computeDashboard`](../src/server/domain/dashboard.ts) à partir des données (aucune valeur codée en dur).

| Paramètre de requête | Type | Défaut | Effet |
|---|---|---|---|
| `from` | date ISO 8601 | minuit (heure du serveur) il y a 29 jours | début de période, ramené à minuit |
| `to` | date ISO 8601 | fin de la journée courante | fin de période, ramenée à 23:59:59,999 du jour indiqué |

Contenu : `period` (bornes effectives), `kpis` (cinq cartes `companies`, `signals`, `priority_topics`, `wordpress_drafts`, `linkedin_to_validate`, avec tendance et mini-histogramme de 8 semaines), `groups` (`prioritaires`, `a_surveiller`, `traites`, quatre rubriques maximum chacun), `activity` (un point par jour de la période), `latestWordpressDraft`, `latestLinkedInPost`, `newsletter` (édition courante non exportée et interrupteur `includeNext` pour le signal prioritaire le plus récent) et `engine` (`active` vaut `false` quand les appels payants sont suspendus). Les règles de calcul sont décrites dans [Règles métier](05-regles-metier.md).

Erreurs spécifiques : `400 invalid_period` (date illisible, ou `from` postérieur à `to`).

```bash
curl -s 'http://localhost:8080/api/dashboard?from=2026-10-01T00:00:00.000Z&to=2026-10-12T21:59:59.999Z'
```

Extrait réel de `GET /api/dashboard` (période par défaut ; les « … » marquent les coupes) :

```json
{
  "period": { "from": "2026-09-12T22:00:00.000Z", "to": "2026-10-12T21:59:59.999Z" },
  "kpis": [
    {
      "key": "companies", "value": 150, "label": "entreprises suivies",
      "trend": "+12%", "trendDirection": "up",
      "spark": [132, 132, 134, 135, 138, 141, 145, 150]
    },
    { "key": "signals", "value": 24, "label": "signaux détectés", "trend": "+33%", "…": "…" },
    "…"
  ],
  "groups": [
    {
      "key": "prioritaires", "label": "Sujets prioritaires", "total": 8,
      "items": [
        { "key": "deeptech_quantique", "label": "Deeptech & quantique", "count": 3, "icon": "atom", "tone": "rose" },
        "…"
      ]
    },
    "…"
  ],
  "activity": {
    "points": [{ "date": "2026-09-12T22:00:00.000Z", "signals": 7, "articles": 4 }, "…"],
    "totalSignals": 128, "totalArticles": 86, "trend": "+42%"
  },
  "latestWordpressDraft": {
    "articleId": "art_pasqal",
    "title": "Pasqal : 100 M€ pour faire rayonner le quantique européen",
    "updatedAt": "2026-10-12T17:52:44.903Z",
    "ready": true
  },
  "latestLinkedInPost": { "postId": "li_pasqal", "status": "a_valider", "…": "…" },
  "newsletter": {
    "editionId": "nl_current",
    "title": "L'actualité innovation en Auvergne-Rhône-Alpes",
    "selectedCount": 12,
    "scheduledFor": "2026-10-15T07:00:00.000Z",
    "includeNext": true,
    "signalId": "sig_pasqal"
  },
  "engine": {
    "active": true,
    "sourcesCount": 259,
    "features": ["Veille multi-sources (250+ sources)", "Analyse sémantique et scoring", "Détection de signaux faibles"]
  }
}
```

<a id="get-search"></a>

### `GET /api/search` — recherche globale

- **Client** : `api.search(q)`.
- **Droit** : aucun.
- **Paramètre** : `q` (texte libre). Moins de 2 caractères après normalisation : réponse `[]`.
- **Réponse** : `200` [`SearchResult[]`](../src/lib/api/types.ts), 20 résultats au maximum.

| `kind` | Champs recherchés | Maximum | Tri | `link` |
|---|---|---|---|---|
| `company` | nom, alias, domaine, secteur | 6 | ordre du store | `/entreprises?id=<id>` |
| `signal` | titre, nom de l'entreprise | 6 | création décroissante | `/signaux?id=<id>` |
| `article` | titre, auteur | 6 | mise à jour décroissante | `/articles?id=<id>` |
| `source` | libellé, URL | 4 | ordre du store | `/veille?source=<id>` |

`subtitle` est un texte d'affichage (ex. « Pasqal · score 9.2/10 » pour un signal, « Article humain · Camille Roux · brouillon » pour un article importé).

```bash
curl -s 'http://localhost:8080/api/search?q=pasqal'
```

<a id="get-usage"></a>

### `GET /api/usage` — consommation et quotas

- **Client** : `api.usage()` (hook `useUsage`).
- **Droit** : aucun.
- **Réponse** : `200` [`UsageSnapshot`](../src/lib/api/types.ts) calculé par `usageSnapshot()` : `month` (`AAAA-MM`, heure du serveur), `meters` (neuf compteurs `QuotaMeter` : `used`, `limit`, `unit`, `ratio` borné à 1 et arrondi au millième, `alert` `ok` / `seuil_80` / `atteint`) et `paidCallsSuspended`. La signification des compteurs est donnée dans [Budget API et quotas](#budget).

```bash
curl -s http://localhost:8080/api/usage
```

Extrait réel :

```json
{
  "month": "2026-10",
  "meters": [
    { "key": "api_budget_eur", "label": "Budget API", "used": 112.4, "limit": 150, "unit": "€ HT", "ratio": 0.749, "alert": "ok" },
    { "key": "search_queries", "label": "Recherches web", "used": 1840, "limit": 3000, "unit": "requêtes", "ratio": 0.613, "alert": "ok" },
    "…",
    { "key": "companies", "label": "Entreprises suivies", "used": 150, "limit": 150, "unit": "entreprises", "ratio": 1, "alert": "atteint" },
    { "key": "sources", "label": "Sources configurées", "used": 260, "limit": 300, "unit": "sources", "ratio": 0.867, "alert": "seuil_80" },
    "…"
  ],
  "paidCallsSuspended": false
}
```

<a id="get-audit"></a>

### `GET /api/audit` — journal d'audit

- **Client** : `api.audit({ entity, entityId, limit })` (hook `useAudit`).
- **Droit** : aucun.
- **Paramètres** : `entity` (une valeur de `AuditEvent["entity"]` ou `tous`), `entityId`, `limit` (défaut 100, borné à 1–1000).
- **Réponse** : `200` [`AuditEvent[]`](../src/lib/api/types.ts), par date décroissante puis identifiant décroissant.

```bash
curl -s 'http://localhost:8080/api/audit?entity=signal&entityId=sig_araymond&limit=20'
```

<a id="exports"></a>

## 4. Exports et téléchargements

Les exports répondent à l'exigence de réversibilité du cahier des charges (§10 et §13 : « export client, schéma des formats, inventaire »). Ils sont accessibles à tous les rôles, y compris quand le budget API est épuisé. Le front ne les appelle pas via `api.*` mais construit des URL de téléchargement avec `downloadUrl` de [`client.ts`](../src/lib/api/client.ts) :

| `downloadUrl` | URL produite | Section |
|---|---|---|
| `downloadUrl.exportManifest()` | `/api/export/manifest` | [Manifeste](#get-export-manifest) |
| `downloadUrl.export(entity, format)` | `/api/export/<entity>?format=csv\|json` | [Export d'entité](#get-export-entity) |
| `downloadUrl.newsletter(id, format)` | `/api/newsletters/<id>/export?format=html\|txt` | [Export newsletter](#get-newsletter-export) |
| `downloadUrl.linkedin(id)` | `/api/linkedin/<id>/export` | [Export LinkedIn](#get-linkedin-export) |

<a id="get-export-manifest"></a>

### `GET /api/export/manifest` — manifeste de réversibilité

- **Client** : `downloadUrl.exportManifest()`.
- **Droit** : aucun.
- **Réponse** : `200`, fichier `kora-manifest-<AAAA-MM-JJ>.json` (`application/json; charset=utf-8`, pièce jointe).

Le manifeste est construit par `exportManifest` en générant chaque table d'export (les compteurs sont donc exacts à l'instant de la demande) :

| Champ | Contenu |
|---|---|
| `workspaceId` | `ws_inovallee` (`WORKSPACE_ID`) |
| `generatedAt` | instant de génération (ISO 8601) |
| `generatedBy` | nom de l'utilisateur courant |
| `encoding` | « UTF-8 (CSV avec BOM, séparateur virgule, fins de ligne CRLF) » |
| `dates` | « ISO 8601 ; une date inconnue est laissée vide (null en JSON) » |
| `entities[]` | pour chaque entité : `entity`, `label`, `count`, `columns`, `csv`, `json` (URL relatives) |

Extrait réel (instance de démonstration) :

```json
{
  "workspaceId": "ws_inovallee",
  "generatedAt": "2026-10-12T20:05:47.097Z",
  "generatedBy": "Sophie Martin",
  "encoding": "UTF-8 (CSV avec BOM, séparateur virgule, fins de ligne CRLF)",
  "dates": "ISO 8601 ; une date inconnue est laissée vide (null en JSON)",
  "entities": [
    {
      "entity": "companies",
      "label": "Entreprises du registre",
      "count": 150,
      "columns": ["id", "name", "aliases", "domain", "sector", "territory", "priority", "themes", "createdAt", "sourceCount", "failingSourceCount", "signalCount"],
      "csv": "/api/export/companies?format=csv",
      "json": "/api/export/companies?format=json"
    },
    "…"
  ]
}
```

<a id="get-export-entity"></a>

### `GET /api/export/:entity` — export CSV ou JSON

- **Client** : `downloadUrl.export(entity, format)`.
- **Droit** : aucun.
- **Paramètres** : `entity` (chemin), parmi les valeurs de [`ExportEntity`](../src/lib/api/types.ts) ; `format` (requête) `csv` (défaut) ou `json`.
- **Réponse** : `200`, fichier `kora-<entity>-<AAAA-MM-JJ>.csv` (`text/csv; charset=utf-8`) ou `.json` (`application/json; charset=utf-8`).

Erreurs spécifiques : `404 not_found` (« Export inconnu : `<entity>`. »), `400 invalid_format`.

| `entity` | Libellé | Une ligne par | Colonnes |
|---|---|---|---|
| `companies` | Entreprises du registre | entreprise | `id`, `name`, `aliases`, `domain`, `sector`, `territory`, `priority`, `themes`, `createdAt`, `sourceCount`, `failingSourceCount`, `signalCount` |
| `sources` | Sources configurées | source | `id`, `companyId`, `type`, `label`, `url`, `frequency`, `access`, `lastRunAt`, `lastSuccessAt`, `failureCode`, `failureReason`, `attempts` |
| `signals` | Signaux | signal | `id`, `companyId`, `title`, `category`, `themes`, `status`, `statusReason`, `score`, `gridVersion`, `evidence`, `matchConfidence`, `observations`, `primaryOutlet`, `primaryUrl`, `publishedAt`, `eventDate`, `collectedAt`, `review`, `inNewsletter`, `articleId`, `createdAt`, `updatedAt` |
| `observations` | Observations collectées | observation | `id`, `signalId`, `sourceId`, `companyId`, `outlet`, `outletDomain`, `url`, `title`, `excerpt`, `collectedAt`, `publishedAt`, `eventDate`, `matchConfidence`, `isSyndicated` |
| `scores` | Scores et motifs | signal | `signalId`, `status`, `gridVersion`, `total`, `importance`, `nouveaute`, `territoire`, `lecteurs`, `diffusion`, `reasonImportance`, `reasonNouveaute`, `reasonTerritoire`, `reasonLecteurs`, `reasonDiffusion` |
| `rules` | Référentiel éditorial | règle (version courante) | `id`, `kind`, `text`, `active`, `version`, `updatedAt`, `updatedBy` |
| `decisions` | Décisions (approbations et envois) | approbation ou tentative de publication | `type`, `id`, `content`, `contentId`, `channel`, `version`, `by`, `at`, `status`, `detail`, `idempotencyKey` |
| `articles` | Articles | article | `id`, `signalId`, `companyId`, `origin`, `author`, `status`, `currentVersion`, `versions`, `title`, `wordpressRemoteId`, `wordpressStatus`, `createdAt`, `updatedAt`, `publishedAt` |
| `audit` | Journal d'audit | événement | `id`, `at`, `actor`, `action`, `entity`, `entityId`, `details` |

Précisions par entité :

- `signals` : `score` est le total 0–100, `evidence` le niveau de l'indicateur documentaire, `observations` le nombre d'observations, `primaryOutlet` le nom du média principal, `review` le type de revue (`homonymie`, `fusion_incertaine`) ou `null`.
- `decisions` : les approbations (articles, posts LinkedIn, éditions) ont `type: "approbation"`, `status` `valide` ou `invalidee`, `detail` = motif d'invalidation ou « Programmée le … », `idempotencyKey` vide ; les tentatives de publication ont `type: "envoi"`, le `status` de la publication (`succes`, `bloque`…), `detail` = message et la clé d'idempotence. Tri chronologique croissant.
- `articles` : métadonnées seulement ; `versions` est le **nombre** de versions. Le titre courant est exporté, pas le chapô ni le corps.
- `audit` : tri chronologique croissant.

Format CSV ([`toCsv`](../src/server/domain/csv.ts), RFC 4180) : BOM UTF-8, séparateur virgule, fins de ligne CRLF, champs contenant `,`, `"` ou un saut de ligne entre guillemets (guillemets doublés), `null` exporté vide, tableaux joints par « ` | ` », objets sérialisés en JSON. Pour neutraliser l'injection de formules dans les tableurs, une chaîne commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est préfixée par `'` (test « échappe les champs CSV » de [`exports.test.ts`](../src/test/server/exports.test.ts)).

Format JSON : tableau des lignes (mêmes clés que les colonnes), indenté sur deux espaces, sans BOM ; les tableaux restent des tableaux et les dates inconnues valent `null`.

```bash
curl -s -OJ 'http://localhost:8080/api/export/signals?format=csv'
curl -s 'http://localhost:8080/api/export/decisions?format=json'
```

Non exportés par l'API (non implémenté) : contenu des versions d'articles, posts LinkedIn (hors téléchargement unitaire), éditions de newsletter (hors téléchargement unitaire), imports humains et fichiers originaux (conservés dans `ImportRecord.bytes` mais non téléchargeables), grilles de score, historique des règles, propositions de règles, exemples éditoriaux, exécutions de collecte, consommation, notifications et utilisateurs.

<a id="entreprises"></a>

## 5. Entreprises

Handlers : [`registry.ts`](../src/server/handlers/registry.ts). DTO : [`Company`](../src/lib/api/types.ts) (les compteurs `sourceCount`, `failingSourceCount` et `signalCount` sont calculés à chaque lecture ; le champ interne `fictional` n'est jamais exposé).

<a id="get-companies"></a>

### `GET /api/companies` — liste

- **Client** : `api.companies({ q, theme })` (hook `useCompanies`).
- **Droit** : aucun.
- **Paramètres** : `q` (recherche normalisée sur nom, alias, domaine, secteur, territoire), `theme` (un [`Theme`](../src/lib/api/types.ts) ou `tous`).
- **Réponse** : `200` `Company[]`, triées par nom (ordre alphabétique français).

<a id="post-companies"></a>

### `POST /api/companies` — ajouter une entreprise

- **Client** : `api.createCompany(input)`.
- **Droit** : `registry.write` (admin, rédacteur).
- **Réponse** : `201` `Company`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `name` | chaîne | oui | 2 à 120 caractères ; unique (comparaison normalisée) |
| `domain` | chaîne | oui | 3 à 253 caractères ; normalisé puis contrôlé (voir ci-dessous) ; unique |
| `sector` | chaîne | oui | 2 à 120 caractères |
| `aliases` | chaîne[] | non | 20 au plus, 1 à 120 caractères chacun ; dédoublonnés |
| `territory` | chaîne | non | 120 au plus ; vide ou absent : « Grenoble » |
| `priority` | `"haute"` \| `"normale"` \| `"basse"` | non | défaut `normale` |
| `themes` | `Theme[]` | non | 7 au plus, valeurs de `THEMES` ; dédoublonnés |

Le domaine est mis en minuscules ; le schéma (`https://`), le chemin, le préfixe `www.` et le point final sont retirés ; le résultat doit correspondre à `^[a-z0-9-]+(\.[a-z0-9-]+)+$` puis passer `checkHost()` de [`security.ts`](../src/server/domain/security.ts) (refus des adresses IP privées, `localhost`, `.local`, `.internal`…).

Ordre des contrôles : droit, schéma, domaine, quota `companies`, unicité. L'identifiant vaut `co_<nom normalisé, espaces remplacés par des tirets, 40 caractères>` (ex. `co_chartreuse-instruments`), ou un identifiant généré si celui-ci existe déjà. Les couleurs du monogramme (`brand`) sont choisies dans `BRAND_COLORS` par hachage du nom. Effets : audit `company.create`.

Erreurs spécifiques : `422 domain_invalid`, `422 url_refused`, `422 quota_exceeded` (systématique sur le jeu de démonstration, déjà à 150/150), `409 duplicate_company` (`details.companyId`).

```bash
curl -s -X POST http://localhost:8080/api/companies \
  -H 'x-kora-request: 1' -H 'content-type: application/json' \
  -d '{"name":"Chartreuse Instruments","domain":"chartreuse-instruments.fr","sector":"Instrumentation","themes":["numerique"]}'
```

<a id="get-company"></a>

### `GET /api/companies/:id` — fiche entreprise

- **Client** : `api.company(id)`.
- **Droit** : aucun.
- **Réponse** : `200` `Company & { sources: Source[] }` (sources de l'entreprise, dans l'ordre du store).

Erreurs spécifiques : `404 not_found` (« Entreprise introuvable. »).

<a id="patch-company"></a>

### `PATCH /api/companies/:id` — modifier une entreprise

- **Client** : `api.updateCompany(id, input)`.
- **Droit** : `registry.write` (admin, rédacteur).
- **Réponse** : `200` `Company`.
- **Corps** : les champs de `POST /api/companies`, tous facultatifs, avec les mêmes contraintes (`schemas.company.partial()`).

Effets : un `territory` vide conserve l'ancienne valeur ; un changement de nom recalcule les initiales du monogramme ; l'unicité nom/domaine est revérifiée en excluant l'entreprise elle-même ; audit `company.update` (« Champs modifiés : … »). Les signaux existants ne sont pas recalculés.

Erreurs spécifiques : `404 not_found`, `422 domain_invalid`, `422 url_refused` (ex. domaine `router.local`, test « refuse un domaine officiel privé »), `409 duplicate_company`.

<a id="delete-company"></a>

### `DELETE /api/companies/:id` — retirer une entreprise

- **Client** : `api.deleteCompany(id)`.
- **Droit** : `registry.delete` (admin).
- **Réponse** : `204`.

Effets : les sources de l'entreprise sont supprimées ; l'historique est conservé mais détaché : les signaux passent à `companyId: null` avec une revue `homonymie` (« Entreprise « … » retirée du registre : à rattacher »), sans recalcul de score ni effacement des thématiques ; les observations, articles et posts LinkedIn passent à `companyId: null`. Contrairement à [`DELETE /api/sources/:id`](#delete-source), les observations conservent leur `sourceId`, qui désigne alors une source supprimée. Audit `company.delete`.

Erreurs spécifiques : `404 not_found`.

<a id="sources"></a>

## 6. Sources et collecte

Handlers : [`registry.ts`](../src/server/handlers/registry.ts) (CRUD) et [`signals.ts`](../src/server/handlers/signals.ts) (collecte), service [`collection.ts`](../src/server/services/collection.ts). DTO : [`Source`](../src/lib/api/types.ts) (sans les champs internes `createdAt`, `runCount`, `simulation`) et [`CollectionRun`](../src/lib/api/types.ts). La collecte est **simulée** par `SimulatedCollector` ([`collector.ts`](../src/server/adapters/collector.ts)) : aucun site n'est réellement interrogé.

<a id="get-sources"></a>

### `GET /api/sources` — liste

- **Client** : `api.sources({ companyId, access })` (hook `useSources`).
- **Droit** : aucun.
- **Paramètres** : `companyId`, `access` (`ok`, `erreur`, `en_attente`, `desactivee` ou `tous`).
- **Réponse** : `200` `Source[]`, par dernière exécution (à défaut, date de création) décroissante.

<a id="post-sources"></a>

### `POST /api/sources` — ajouter une source

- **Client** : `api.createSource(input)`.
- **Droit** : `registry.write` (admin, rédacteur).
- **Réponse** : `201` `Source`, avec `access: "en_attente"`, `attempts: 0`, dates d'exécution `null`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `companyId` | chaîne | oui | 1 à 64 caractères ; entreprise existante |
| `type` | `SourceType` | oui | `site_officiel`, `actualites`, `communiques`, `rss`, `recherche_web`, `newsletter_import` |
| `label` | chaîne | oui | 1 à 120 caractères |
| `url` | chaîne | oui | 1 à 2048 caractères ; `http` ou `https` ; filtrée par `validateSourceUrl()` |
| `frequency` | `"quotidienne"` \| `"hebdomadaire"` | non | défaut `hebdomadaire` pour `recherche_web`, `quotidienne` sinon |

L'URL est stockée sous sa forme normalisée (`URL.toString()`). Le filtrage SSRF refuse notamment `localhost`, les réseaux privés et lien-local IPv4/IPv6, les adresses IP en notation non standard, les suffixes internes, les protocoles autres que `http`/`https` et les identifiants intégrés à l'URL (liste testée dans [`security.test.ts`](../src/test/server/security.test.ts), détail dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md)). Effets : audit `source.create`.

Erreurs spécifiques : `404 not_found` (entreprise), `422 url_refused` (`details.url`), `422 quota_exceeded` (300 sources), `409 duplicate_source` (même URL pour la même entreprise, `details.sourceId`).

```bash
curl -s -X POST http://localhost:8080/api/sources \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas' \
  -d '{"companyId":"co_pasqal","type":"rss","label":"Flux RSS","url":"https://www.pasqal.com/fr/feed.xml"}'
```

<a id="patch-source"></a>

### `PATCH /api/sources/:id` — modifier une source

- **Client** : `api.updateSource(id, input)`.
- **Droit** : `registry.write` (admin, rédacteur).
- **Réponse** : `200` `Source`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `companyId` | chaîne | non | entreprise existante |
| `type` | `SourceType` | non | comme à la création |
| `label` | chaîne | non | 1 à 120 caractères |
| `url` | chaîne | non | comme à la création |
| `frequency` | `"quotidienne"` \| `"hebdomadaire"` | non | — |
| `access` | `"ok"` \| `"en_attente"` \| `"desactivee"` | non | `"erreur"` est refusé (réservé au résultat d'une collecte) |

Effets : `access` à `ok` ou `en_attente` remet à zéro `failureCode`, `failureReason` et `attempts` ; une URL différente remet la source `en_attente` (sauf si elle est désactivée) et efface l'état d'échec ; audit `source.update`. L'unicité de l'URL n'est pas revérifiée en modification.

Erreurs spécifiques : `404 not_found` (source ou entreprise), `422 url_refused`, `422 invalid_access`.

<a id="delete-source"></a>

### `DELETE /api/sources/:id` — supprimer une source

- **Client** : `api.deleteSource(id)`.
- **Droit** : `registry.write` (admin, rédacteur).
- **Réponse** : `204`.

Effets : les observations issues de la source passent à `sourceId: null` (elles sont conservées) ; audit `source.delete`. Erreurs spécifiques : `404 not_found`.

<a id="post-source-collect"></a>

### `POST /api/sources/:id/collect` — collecter une source (WF1)

- **Client** : `api.collectSource(id)`.
- **Droit** : `collect` (admin, rédacteur).
- **Corps** : aucun.
- **Réponse** : `200` `CollectionRun`. Un échec de collecte n'est **pas** une erreur HTTP : il est renvoyé avec `status: "echec"`.

Déroulement (`collectOne` puis `runSource`) :

1. Une source `desactivee` est refusée (`409 source_disabled`).
2. Appel payant `search_query` : 0,075 € réservés, puis 0,012 € consignés pour la requête et 0,021 € par publication reçue (3 au plus). Budget épuisé : exécution consignée `bloque_quota` (`errorCode: "budget_exhausted"`) puis `402 budget_exhausted`.
3. Le collecteur est appelé jusqu'à 3 fois (`MAX_ATTEMPTS`) tant qu'il échoue.
4. Échec : la source passe `access: "erreur"` avec `failureCode`, `failureReason` et `attempts` ; notification `erreur_source` si elle n'était pas déjà en échec ; exécution `echec`.
5. Succès : au plus 3 publications (`MAX_ITEMS`) sont traitées. Chacune est ignorée si son URL est refusée par le filtrage SSRF, si son URL canonique est déjà connue ou si son titre ou son extrait est vide après nettoyage (`sanitizeText`). Les autres deviennent des observations rattachées à une entreprise (seuil `MATCH_THRESHOLD = 60`, sinon « à rattacher ») puis, selon `decideCluster` (fenêtre `CLUSTER_WINDOW_DAYS` de 7 jours), sont ajoutées à un signal récent de la même entreprise, ou créent un nouveau signal scoré avec la grille active (avec une revue `fusion_incertaine` si un signal proche existe). Notification `signal` si un nouveau signal atteint 80. La source repasse `ok` ; exécution `succes` (au moins une nouvelle observation) ou `succes_sans_actualite`.

Aucune entrée d'audit n'est écrite pour une collecte unitaire. Le détail du regroupement et du rattachement est dans [Règles métier](05-regles-metier.md).

Erreurs spécifiques : `404 not_found`, `409 source_disabled`, `402 budget_exhausted`.

```bash
curl -s -X POST http://localhost:8080/api/sources/<sourceId>/collect \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas'
```

<a id="post-collect"></a>

### `POST /api/collect` — collecter toutes les sources actives

- **Client** : `api.collectAll()`.
- **Droit** : `collect` (admin, rédacteur).
- **Corps** : aucun.
- **Réponse** : `200` `CollectionRun[]` (une exécution par source non désactivée, traitées séquentiellement).

Effets : comme la collecte unitaire pour chaque source ; dès qu'une exécution est bloquée par le budget, toutes les suivantes sont consignées `bloque_quota` sans appel. Cet endpoint ne renvoie jamais `402`. Audit `collect.all` (« `n` sources, `m` nouvelles observations, `k` échec(s) »).

<a id="get-collection-runs"></a>

### `GET /api/collection-runs` — historique des exécutions

- **Client** : `api.collectionRuns({ sourceId, limit })` (hook `useCollectionRuns`).
- **Droit** : aucun.
- **Paramètres** : `sourceId`, `limit` (défaut 50, borné à 1–500).
- **Réponse** : `200` `CollectionRun[]`, par début décroissant.

<a id="signaux"></a>

## 7. Signaux et grilles de score

Handlers : [`signals.ts`](../src/server/handlers/signals.ts), services [`signals.ts`](../src/server/services/signals.ts) et [`view.ts`](../src/server/services/view.ts). DTO : [`Signal`](../src/lib/api/types.ts) (`evidence` et `inNewsletter` sont calculés à chaque lecture), [`SignalDetail`](../src/lib/api/types.ts), [`ScoringGrid`](../src/lib/api/types.ts). Le score (`score.total`, 0–100, affiché sur 10 par le front) et l'indicateur documentaire (`evidence`) sont décrits dans [Règles métier](05-regles-metier.md).

<a id="get-signals"></a>

### `GET /api/signals` — liste filtrée et paginée

- **Client** : `api.signals(query)` (hook `useSignals`, type [`SignalListQuery`](../src/lib/api/types.ts)).
- **Droit** : aucun.
- **Réponse** : `200` `Paginated<Signal>` (`items`, `total` = nombre de signaux après filtrage).

| Paramètre | Valeurs | Effet |
|---|---|---|
| `status` | `SignalStatus` ou `tous` | absent ou `tous` : tous les statuts |
| `category` | `Category` | `tous` n'est pas accepté |
| `theme` | `Theme` | `tous` n'est pas accepté |
| `companyId` | identifiant | signaux de l'entreprise |
| `outlet` | nom ou domaine de média | correspond au média principal ou d'une observation (nom normalisé, ou domaine sans `www.`) |
| `q` | texte | recherche normalisée dans titre, résumé, nom de l'entreprise et tags |
| `sort` | `recent` (défaut) ou `score` | `recent` : création décroissante ; `score` : total décroissant puis récence |
| `limit` | entier | défaut 50, borné à 1–200 |
| `offset` | entier | défaut 0, borné à 0–100 000 |

Erreurs spécifiques : `422 invalid_filter` (statut, catégorie ou thématique inconnus).

```bash
curl -s 'http://localhost:8080/api/signals?limit=2'
curl -s 'http://localhost:8080/api/signals?status=tous&sort=score&limit=3'
```

Extrait réel de `GET /api/signals?limit=2` (premier élément, tronqué) :

```json
{
  "items": [
    {
      "id": "sig_pasqal",
      "companyId": "co_pasqal",
      "title": "Pasqal lève 100 M€ pour accélérer l'informatique quantique",
      "category": "financement",
      "themes": ["deeptech_quantique"],
      "status": "nouveau",
      "statusReason": null,
      "observationIds": ["obs_0001", "obs_0002", "obs_0003", "obs_0004"],
      "primaryOutlet": { "name": "Les Echos", "domain": "lesechos.fr", "brand": { "initials": "E", "bg": "#111111", "fg": "#ffffff" } },
      "publishedAt": "2026-10-12T16:27:44.903Z",
      "eventDate": "2026-10-12T16:27:44.903Z",
      "matchConfidence": 92,
      "score": {
        "total": 92,
        "gridVersion": 1,
        "subScores": { "importance": 95, "nouveaute": 90, "territoire": 95, "lecteurs": 90, "diffusion": 85 },
        "reasons": { "importance": "Catégorie « financement », montant élevé (100 M€), entreprise prioritaire du registre", "…": "…" }
      },
      "evidence": {
        "level": "solide",
        "directSource": true,
        "independentCorroborations": 2,
        "freshnessDays": 0,
        "contradictions": [],
        "explanation": ["Source directe disponible (Pasqal)", "…"]
      },
      "review": null,
      "articleId": null,
      "inNewsletter": true,
      "…": "…"
    },
    "…"
  ],
  "total": 248
}
```

<a id="post-signals-rescore"></a>

### `POST /api/signals/rescore` — recalculer avec la grille active

- **Client** : `api.rescoreSignals()`.
- **Droit** : `grid.write` (admin).
- **Corps** : aucun.
- **Réponse** : `200` `{ rescored: number }` (nombre de signaux dont le total ou la version de grille a changé).

Effets : applique la grille active (`applyGrid`) aux sous-notes existantes de chaque signal **non décidé** ; les signaux `traite` et `rejete` conservent le score et la grille de leur décision (`isDecided`). Audit `grid.rescore`. Aucun recalcul n'est fait automatiquement à la création d'une grille.

<a id="get-signal"></a>

### `GET /api/signals/:id` — détail

- **Client** : `api.signal(id)` (hook `useSignal`).
- **Droit** : aucun.
- **Réponse** : `200` `SignalDetail` : le `Signal`, l'entreprise (`company`, `Company` ou `null`) et les `observations` triées par date de publication (à défaut, de collecte) décroissante, avec leur marqueur de reprise `isSyndicated`.

Erreurs spécifiques : `404 not_found` (« Signal introuvable. »).

<a id="patch-signal"></a>

### `PATCH /api/signals/:id` — qualifier, rattacher, inclure en newsletter

- **Client** : `api.updateSignal(id, patch)` et `api.setNewsletterIncludeNext(signalId, include)`.
- **Droit** : `signal.write` (admin, rédacteur) si `status`, `statusReason` ou `companyId` est présent ou si le corps est vide ; `newsletter.write` (admin, rédacteur) si `inNewsletter` est présent.
- **Réponse** : `200` `Signal`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `status` | `SignalStatus` | non | `nouveau`, `a_traiter`, `en_revue`, `surveille`, `traite`, `rejete` |
| `statusReason` | chaîne ou `null` | non | 500 caractères au plus ; non vide obligatoire si `status` vaut `rejete` |
| `companyId` | chaîne ou `null` | non | 64 caractères au plus ; `null` ou chaîne vide : détachement ; sinon entreprise existante |
| `inNewsletter` | booléen | non | — |

Effets, dans l'ordre d'application :

- **Statut** : toute transition est permise, sauf le rejet sans motif. Un changement de statut enregistre le motif et écrit un audit `signal.status` (« À traiter → Rejeté — motif : … »). `statusReason` seul (sans `status`) met à jour le motif sans audit ; s'il accompagne un `status` identique au statut courant, il est ignoré.
- **Rattachement** (`companyId` différent) : les observations du signal sont rattachées avec `matchConfidence: 100`, la revue est levée, les thématiques sont reprises de l'entreprise, le signal est reconstruit et rescoré avec la grille active (sauf signal décidé) ; audit `signal.attach`. Le détachement remet `companyId` et `themes` à vide, pose une revue `homonymie` (« Détaché manuellement : entreprise à rattacher ») et reconstruit le signal ; audit `signal.detach`.
- **Newsletter** : `true` ajoute le signal à l'édition courante (la plus récente non exportée, créée si elle n'existe pas, avec contrôle du quota `newsletters`) via un appel payant de résumé (0,02 €) ; `false` le retire de l'édition courante. Voir [Newsletters](#newsletters) pour les effets sur l'édition (nouvelle version, approbation invalidée).

Erreurs spécifiques : `404 not_found` (signal ou entreprise), `422 reason_required`, `402 budget_exhausted` et `422 quota_exceeded` (inclusion newsletter).

```bash
curl -s -X PATCH http://localhost:8080/api/signals/sig_araymond \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas' \
  -d '{"status":"rejete","statusReason":"Hors ligne éditoriale"}'
```

<a id="post-signal-merge"></a>

### `POST /api/signals/:id/merge` — fusionner

- **Client** : `api.mergeSignals(id, otherIds)`.
- **Droit** : `signal.write` (admin, rédacteur).
- **Réponse** : `200` `Signal` (le signal cible fusionné).

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `otherIds` | chaîne[] | oui | 1 à 50 identifiants de signaux existants ; dédoublonnés ; ne doit pas contenir `:id` |

Effets : les observations des autres signaux rejoignent la cible ; les articles, posts LinkedIn et sujets de newsletter qui pointaient vers les signaux absorbés pointent vers la cible (un seul sujet par édition est conservé) ; les signaux absorbés sont **supprimés** ; la cible est reconstruite (confiance de rattachement maximale, tags fusionnés et limités à 6, revue levée si elle était `fusion_incertaine` ou si une entreprise est rattachée) et rescorée sauf si elle est décidée. Audit `signal.merge`.

Erreurs spécifiques : `404 not_found`, `422 invalid_merge`, `422 company_mismatch` (signaux rattachés à des entreprises différentes ; les signaux sans entreprise sont compatibles).

<a id="post-signal-split"></a>

### `POST /api/signals/:id/split` — défusionner

- **Client** : `api.splitSignal(id, observationIds)`.
- **Droit** : `signal.write` (admin, rédacteur).
- **Réponse** : `201` `{ original: Signal, created: Signal }`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `observationIds` | chaîne[] | oui | 1 à 200 observations appartenant au signal ; au moins une doit rester dans l'original |

Effets : un nouveau signal (`status: "nouveau"`, sans article ni revue) reçoit les observations détachées ; son titre est celui de la plus ancienne d'entre elles et son résumé est généré (gabarit, éventuellement réécrit par OpenAI) ; les deux signaux sont reconstruits avec la grille active. Audit `signal.split`.

Erreurs spécifiques : `404 not_found`, `422 invalid_split` (observations étrangères, `details.observationIds` ; ou aucune observation restante).

<a id="get-scoring-grids"></a>

### `GET /api/scoring-grids` — grilles de score

- **Client** : `api.scoringGrids()` (hook `useScoringGrids`).
- **Droit** : aucun.
- **Réponse** : `200` `ScoringGrid[]` (sans identifiant interne), par version décroissante ; une seule a `active: true`.

<a id="post-scoring-grids"></a>

### `POST /api/scoring-grids` — créer et activer une grille

- **Client** : `api.createScoringGrid(input)`.
- **Droit** : `grid.write` (admin).
- **Réponse** : `201` `ScoringGrid` (`version` = maximum + 1, `active: true`, `createdBy` = nom de l'utilisateur).

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `weights.importance`, `weights.nouveaute`, `weights.territoire`, `weights.lecteurs`, `weights.diffusion` | nombre | oui | entiers de 0 à 100 dont la somme vaut 100 (`validateWeights`) |
| `note` | chaîne ou `null` | non | 500 caractères au plus |

Effets : les autres grilles sont désactivées ; les scores existants ne sont **pas** recalculés (utiliser [`POST /api/signals/rescore`](#post-signals-rescore)) ; audit `grid.create`.

Erreurs spécifiques : `422 weights_sum_invalid` (`details.weights`), y compris pour des poids non entiers.

```bash
curl -s -X POST http://localhost:8080/api/scoring-grids \
  -H 'x-kora-request: 1' -H 'content-type: application/json' \
  -d '{"weights":{"importance":10,"nouveaute":10,"territoire":50,"lecteurs":20,"diffusion":10},"note":"Priorité territoire"}'
```

<a id="articles"></a>

## 8. Articles, dossier factuel et publication

Handlers : [`articles.ts`](../src/server/handlers/articles.ts), règles d'approbation dans [`workflow.ts`](../src/server/domain/workflow.ts). DTO : [`Article`](../src/lib/api/types.ts) (liste, sans versions), [`ArticleDetail`](../src/lib/api/types.ts) (avec `versions` triées, `signal`, `observations` du dossier et du signal, `publications` de l'article), [`PublicationAttempt`](../src/lib/api/types.ts).

Transitions d'état déclenchées par les endpoints (les règles d'approbation sont détaillées dans [Règles métier](05-regles-metier.md)) :

```mermaid
stateDiagram-v2
  [*] --> brouillon: POST /articles ou POST /imports/:id/convert
  brouillon --> en_revue: submit
  rejete --> en_revue: submit
  en_revue --> approuve: approve (sans scheduledAt)
  en_revue --> programme: approve (avec scheduledAt)
  approuve --> approuve: approve (autre canal)
  approuve --> programme: approve (avec scheduledAt)
  programme --> approuve: approve (sans scheduledAt)
  en_revue --> rejete: reject
  approuve --> rejete: reject
  programme --> rejete: reject
  approuve --> en_revue: versions ou restore
  programme --> en_revue: versions ou restore
  rejete --> brouillon: versions ou restore
```

Une nouvelle version laisse inchangé un article `brouillon` ou `en_revue`. La publication ne change pas le statut de l'article : au pilote, l'envoi WordPress crée ou met à jour un brouillon distant. Le statut `publie` n'est atteint par aucun endpoint.

<a id="get-articles"></a>

### `GET /api/articles` — liste

- **Client** : `api.articles({ status, origin })` (hook `useArticles`).
- **Droit** : aucun.
- **Paramètres** : `status` (`ArticleStatus` ou `tous`), `origin` (`kora`, `import_humain` ou `tous`).
- **Réponse** : `200` `Article[]`, par mise à jour décroissante.

<a id="post-articles"></a>

### `POST /api/articles` — dossier factuel et brouillon depuis un signal (WF2)

- **Client** : `api.createArticleFromSignal(signalId, angle)`.
- **Droit** : `article.write` (admin, rédacteur).
- **Réponse** : `201` `ArticleDetail`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `signalId` | chaîne | oui | 1 à 64 caractères ; signal existant, non rejeté, sans article |
| `angle` | chaîne ou `null` | non | 200 caractères au plus ; angle transmis au générateur |

Ordre des contrôles : droit, schéma, signal (404), article existant (409), signal rejeté (422), quota `articles` (422), budget (402).

Effets :

- Appel payant `generation_article` (0,45 €) : le dossier (`angles`, `plan`, `factChecks`) et le brouillon v1 sont produits par `TemplateTextModel.generateDossier` à partir du signal, de l'entreprise, des observations et des règles éditoriales actives, puis éventuellement réécrits par `OpenAiEnhancer` si `AI_API_KEY` est définie.
- Article `origin: "kora"`, `author: null`, `status: "brouillon"`, `currentVersion: 1` ; la version 1 a `createdBy: "KORA"` et la note « Brouillon généré par KORA à partir du dossier » ; chaque fait du dossier reçoit l'identifiant `fc_<articleId>_<i>`.
- Le signal reçoit `articleId` et passe `en_revue` (sauf s'il est déjà `traite`).
- Audit `article.create` (mentionne les contradictions à arbitrer).

Erreurs spécifiques : `404 not_found`, `409 article_exists` (`details.articleId`), `422 signal_rejected`, `422 quota_exceeded`, `402 budget_exhausted`.

```bash
curl -s -X POST http://localhost:8080/api/articles \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas' \
  -d '{"signalId":"sig_verkor"}'
```

<a id="get-article"></a>

### `GET /api/articles/:id` — détail

- **Client** : `api.article(id)` (hook `useArticle`).
- **Droit** : aucun.
- **Réponse** : `200` `ArticleDetail`. `publications` contient toutes les tentatives dont `articleId` est l'article, y compris les exports des posts LinkedIn générés depuis cet article. `signal` vaut `null` pour un article importé.

Erreurs spécifiques : `404 not_found` (« Article introuvable. »).

<a id="post-article-versions"></a>

### `POST /api/articles/:id/versions` — nouvelle version

- **Client** : `api.saveArticleVersion(id, input)` (type [`ArticleVersionInput`](../src/lib/api/types.ts)).
- **Droit** : `article.write` (admin, rédacteur).
- **Réponse** : `201` `ArticleDetail`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `title` | chaîne | oui | 1 à 300 caractères après rognage |
| `chapo` | chaîne | oui | 2 000 caractères au plus (peut être vide) |
| `body` | chaîne | oui | 100 000 caractères au plus |
| `excerpt` | chaîne | non | 1 000 au plus ; défaut : 200 premiers caractères du chapô (ou du corps) |
| `seoTitle` | chaîne | non | 200 au plus ; défaut : titre tronqué à 60 caractères |
| `categories` | chaîne[] | non | 20 au plus, 1 à 80 caractères ; défaut : celles de la version courante |
| `tags` | chaîne[] | non | 30 au plus, 1 à 80 caractères ; défaut : ceux de la version courante |
| `note` | chaîne ou `null` | non | 500 caractères au plus |

Effets (`pushVersion`) : version `n + 1` signée par l'utilisateur courant, devenue courante ; **toutes les approbations valides sont invalidées** (« Contenu modifié après approbation ») ; statut selon le diagramme ci-dessus ; audit `article.version`. Si la version précédente avait été écrite par KORA, l'analyse des corrections (WF6, `refreshProposals`) est relancée et peut créer ou mettre à jour des propositions de règles.

Erreurs spécifiques : `404 not_found`.

```bash
curl -s -X POST http://localhost:8080/api/articles/art_pasqal/versions \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas' \
  -d '{"title":"Verkor accélère sa gigafactory","chapo":"Chapô relu.","body":"Corps relu par la rédaction."}'
```

<a id="post-article-restore"></a>

### `POST /api/articles/:id/restore` — restaurer une version

- **Client** : `api.restoreArticleVersion(id, version)`.
- **Droit** : `article.write` (admin, rédacteur).
- **Réponse** : `201` `ArticleDetail`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `version` | entier | oui | ≥ 1 ; version existante, différente de la version courante |

Effets : le contenu de la version restaurée est recopié dans une **nouvelle** version (l'historique est conservé) signée par l'utilisateur courant, avec la note « Restauration de la version `n` » ; mêmes effets que [`versions`](#post-article-versions) (approbations invalidées) ; audit `article.restore`.

Erreurs spécifiques : `404 not_found`, `422 version_not_found`, `409 already_current`.

<a id="post-article-submit"></a>

### `POST /api/articles/:id/submit` — soumettre à validation

- **Client** : `api.submitArticle(id)`.
- **Droit** : `article.write` (admin, rédacteur).
- **Corps** : aucun.
- **Réponse** : `200` `ArticleDetail`.

Effets : depuis `brouillon` ou `rejete`, passage à `en_revue`, audit `article.submit` et notification « Article à valider ». Un article déjà `en_revue` est renvoyé tel quel, sans effet. Erreurs spécifiques : `404 not_found`, `409 invalid_state` (depuis `approuve`, `programme` ou `publie`).

<a id="post-article-approve"></a>

### `POST /api/articles/:id/approve` — approuver une version

- **Client** : `api.approveArticle(id, input)` (type [`ApproveInput`](../src/lib/api/types.ts)).
- **Droit** : `article.decide` (admin, validateur).
- **Réponse** : `200` `ArticleDetail`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `channel` | `"wordpress"` \| `"linkedin"` \| `"newsletter"` | oui | — |
| `version` | entier | oui | ≥ 1 ; doit être la version courante (version relue) |
| `scheduledAt` | date ISO 8601 ou `null` | non | dans le futur |

Ordre des contrôles : droit, article (404), schéma, version (409), état `en_revue` / `approuve` / `programme` (409), contradictions non résolues (422), date (422).

Effets : nouvelle [`Approval`](../src/lib/api/types.ts) valide (validateur, date, version, canal, programmation) ; l'approbation valide précédente **du même canal** est invalidée (« Remplacée par une nouvelle approbation ») ; statut `programme` si `scheduledAt` est fourni, sinon `approuve` ; audit `article.approve`. La programmation est informative : aucun traitement ne publie à la date prévue et `publish` ne la vérifie pas.

Erreurs spécifiques : `404 not_found`, `409 version_mismatch` (`details.currentVersion`), `409 invalid_state`, `422 contradiction_unresolved` (`details.factCheckIds`), `422 schedule_in_past`.

```bash
curl -s -X POST http://localhost:8080/api/articles/art_pasqal/approve \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_claire' \
  -d '{"channel":"wordpress","version":2}'
```

<a id="post-article-reject"></a>

### `POST /api/articles/:id/reject` — rejeter

- **Client** : `api.rejectArticle(id, reason)`.
- **Droit** : `article.decide` (admin, validateur).
- **Réponse** : `200` `ArticleDetail`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `reason` | chaîne | oui | 3 à 1 000 caractères après rognage (« Le motif de rejet est obligatoire ») |

Effets : statut `rejete`, toutes les approbations valides invalidées avec le motif « Rejet : … », audit `article.reject`, notification « Article rejeté ». Erreurs spécifiques : `404 not_found`, `400 validation_error` (motif absent ou trop court), `409 invalid_state` (hors `en_revue`, `approuve`, `programme`).

<a id="post-article-publish"></a>

### `POST /api/articles/:id/publish` — envoyer vers un canal

- **Client** : `api.publishArticle(id, { channel })`.
- **Droit** : `publish` (admin, validateur).
- **Réponse** : `201` `PublicationAttempt` pour un nouvel envoi ; `200` avec la tentative existante si l'envoi a déjà réussi.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `channel` | `"wordpress"` \| `"linkedin"` \| `"newsletter"` | oui | — |

La version envoyée est toujours la version courante. La clé d'idempotence vaut `sha256("<articleId>:<version>:<canal>")` en hexadécimal (`idempotencyKey` de `workflow.ts`).

```mermaid
flowchart TD
  A[POST /articles/:id/publish] --> B{Tentative succes avec la même clé ?}
  B -- oui --> R[200 : tentative existante + audit publication.replay]
  B -- non --> C{checkPublishable : contradiction ? approbation valide pour ce canal et cette version ?}
  C -- non --> D[Tentative bloque créée, ou attempts + 1 si même code]
  D --> E[audit publication.blocked]
  E --> F[422 code du contrôle + details.attempt]
  C -- oui --> G{Canal}
  G -- wordpress --> H[Brouillon distant créé ou mis à jour : mode brouillon_distant]
  G -- linkedin / newsletter --> I[Export prêt : mode export]
  H --> J[Tentative succes, signal passé à traite, audit publication.success, notification]
  I --> J
  J --> K[201]
```

Codes de blocage, dans l'ordre d'évaluation de `checkPublishable` : `contradiction_unresolved`, `approval_version_mismatch` (approbation valide du canal sur une autre version), `approval_wrong_channel` (version approuvée pour un autre canal), `approval_invalidated` (dernière approbation du canal invalidée), `approval_missing`. Une tentative bloquée est **persistée** même si la réponse est une erreur : `details.attempt` porte la tentative (`status: "bloque"`, `attempts` incrémenté à chaque nouvel essai bloqué pour le même motif).

Canal `wordpress` : l'adaptateur `SimulatedWordPress` ([`channels.ts`](../src/server/adapters/channels.ts), **simulé**) crée ou met à jour un brouillon distant identifié `wp-<4 chiffres>` ; l'article mémorise `wordpress.remoteId`, `wordpress.status: "brouillon"` et `lastSyncAt`. Aucune publication publique n'est possible. Canaux `linkedin` et `newsletter` : la tentative est consignée en `mode: "export"` (« Export `<canal>` prêt (version `n`) : diffusion manuelle. »), sans lien avec les workflows [LinkedIn](#linkedin) et [Newsletters](#newsletters). Dans tous les cas de succès, le signal d'origine passe `traite` (sauf s'il est rejeté), l'audit `publication.success` est écrit et une notification `publication` est émise.

Erreurs spécifiques : `404 not_found`, `422` avec l'un des codes de blocage.

```bash
curl -s -X POST http://localhost:8080/api/articles/art_pasqal/publish \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_claire' \
  -d '{"channel":"wordpress"}'
```

Réponse attendue sur le jeu de démonstration (test « met à jour le brouillon distant existant de Pasqal ») :

```json
{
  "id": "pub_n…",
  "idempotencyKey": "<64 caractères hexadécimaux>",
  "articleId": "art_pasqal",
  "linkedinPostId": null,
  "newsletterId": null,
  "channel": "wordpress",
  "version": 2,
  "status": "succes",
  "code": null,
  "message": "Brouillon WordPress wp-4821 mis à jour (version 2). Aucune publication publique : la mise en ligne reste manuelle.",
  "attempts": 1,
  "remoteId": "wp-4821",
  "mode": "brouillon_distant",
  "at": "…",
  "by": "Claire Dubois"
}
```

Envoi bloqué (article sans approbation) :

```json
{
  "error": {
    "code": "approval_missing",
    "message": "Envoi bloqué : aucune approbation valide pour WordPress sur la version 1.",
    "details": { "attempt": { "status": "bloque", "attempts": 1, "version": 1, "channel": "wordpress", "…": "…" } }
  }
}
```

<a id="patch-article-fact-check"></a>

### `PATCH /api/articles/:id/fact-checks/:fid` — arbitrer un fait du dossier

- **Client** : `api.resolveFactCheck(id, factCheckId, input)`.
- **Droit** : `article.write` **ou** `article.decide` (admin, rédacteur, validateur).
- **Réponse** : `200` `ArticleDetail`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `status` | `"etaye"` \| `"non_corrobore"` | oui | `contradictoire` ne peut pas être reposé |
| `note` | chaîne ou `null` | non | 1 000 caractères au plus |

Effets : le fait reçoit le nouveau statut et `resolution: { by, at, note }` ; une contradiction ainsi arbitrée ne bloque plus l'approbation ni l'envoi ; audit `article.fact_check`. L'arbitrage ne crée pas de version et n'invalide pas les approbations.

Erreurs spécifiques : `403 forbidden` (lecteur), `404 not_found` (article ou fait).

```bash
curl -s -X PATCH http://localhost:8080/api/articles/art_contra/fact-checks/<factCheckId> \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_claire' \
  -d '{"status":"etaye","note":"Montant confirmé par le communiqué officiel"}'
```

<a id="get-publications"></a>

### `GET /api/publications` — tentatives de publication

- **Client** : `api.publications({ channel, articleId })` (hook `usePublications`).
- **Droit** : aucun.
- **Paramètres** : `channel` (`Channel` ou `tous`), `articleId`.
- **Réponse** : `200` `PublicationAttempt[]` (articles, posts LinkedIn et exports de newsletter), par date décroissante. Il n'existe pas de filtre par `linkedinPostId` ou `newsletterId`.

<a id="imports"></a>

## 9. Imports humains

Handlers : [`imports.ts`](../src/server/handlers/imports.ts), domaine [`imports.ts`](../src/server/domain/imports.ts). DTO : [`HumanImport`](../src/lib/api/types.ts) (sans les octets du fichier ni les positions des propositions). L'original, le texte extrait et les propositions restent distincts ; aucune proposition n'est appliquée sans acceptation (WF3, cahier des charges §4.2).

<a id="get-imports"></a>

### `GET /api/imports` — liste

- **Client** : `api.imports()` (hook `useImports`).
- **Droit** : aucun.
- **Réponse** : `200` `HumanImport[]`, par création décroissante.

<a id="post-imports"></a>

### `POST /api/imports` — importer un fichier

- **Client** : `api.importFile(file, author)` (construit un `FormData`).
- **Droit** : `import.write` (admin, rédacteur).
- **Corps** : `multipart/form-data`.
- **Réponse** : `201` `HumanImport`.

| Champ multipart | Type | Requis | Contraintes |
|---|---|---|---|
| `file` | fichier | oui | `.txt` (type vide, `text/plain…` ou `application/octet-stream`) ou `.docx` (type vide, DOCX, `application/octet-stream` ou `application/zip`) ; 10 Mio au plus |
| `author` | texte | oui | non vide ; rogné et tronqué à 120 caractères |

Le nom de fichier est réduit à son dernier segment, débarrassé des caractères de contrôle et tronqué à 200 caractères. Un TXT doit être en UTF-8 strict (BOM retiré) ; l'original est le contenu du fichier, le texte extrait normalise les fins de ligne. Un DOCX est décompressé (`fflate`, `word/document.xml` de 50 Mo au plus) ; l'original est la suite des paragraphes, l'extrait celle des paragraphes non vides séparés par une ligne vide. Les propositions (`enrichissement` : liens vers les fiches entreprises ; `correction` : espaces insécables et doubles espaces ; `mise_en_forme` : guillemets français) portent chacune sur un passage exact, sans chevauchement, 60 au plus ; elles sont créées `en_attente` avec l'identifiant `<importId>_p<i>`.

Ordre des contrôles : en-tête CSRF, type multipart et taille annoncée (routeur), droit, champs, taille du fichier, format, quota `storage_gb`, décodage. Effets : audit `import.create`. Aucun appel payant.

Erreurs spécifiques : `400 multipart_required`, `400 invalid_multipart`, `400 file_required`, `400 author_required`, `413 file_too_large` (`details.maxBytes`), `415 unsupported_format` (`details.filename`, `details.mime`), `415 invalid_encoding`, `415 invalid_docx`, `422 quota_exceeded`.

Pour cet endpoint, l'en-tête `content-type` est posé par `curl` avec la frontière multipart ; il ne faut pas le forcer à `application/json` :

```bash
curl -s -X POST http://localhost:8080/api/imports \
  -H 'x-kora-request: 1' -b 'kora_uid=u_lucas' \
  -F 'file=@article.txt;type=text/plain' -F 'author=Camille Roux'
```

<a id="patch-import-proposal"></a>

### `PATCH /api/imports/:id/proposals/:pid` — décider d'une proposition

- **Client** : `api.decideImportProposal(importId, proposalId, decision)`.
- **Droit** : `import.write` (admin, rédacteur).
- **Réponse** : `200` `HumanImport`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `decision` | `"en_attente"` \| `"acceptee"` \| `"refusee"` | oui | — |

Effets : la décision est enregistrée (réversible tant que l'import n'est pas converti) ; audit `import.proposal`. Erreurs spécifiques : `404 not_found` (import ou proposition), `409 already_converted`.

<a id="post-import-convert"></a>

### `POST /api/imports/:id/convert` — convertir en article

- **Client** : `api.convertImport(importId)`.
- **Droit** : `import.write` (admin, rédacteur).
- **Corps** : aucun.
- **Réponse** : `201` `ArticleDetail`.

Effets : le texte extrait reçoit les seules propositions **acceptées** (`applyAccepted`), puis est découpé en titre, chapô et corps (`splitArticle`, titre de secours : nom du fichier sans extension) ; un article `origin: "import_humain"`, `status: "brouillon"`, `author` = auteur nommé est créé, dont la version 1 est signée par cet auteur (« Import de `<fichier>` — `a`/`n` proposition(s) acceptée(s) ») ; l'entreprise est rattachée si la confiance de rattachement atteint 60 ; l'import mémorise `articleId` ; audit `import.convert`. Aucun quota ni budget n'est consommé.

Erreurs spécifiques : `404 not_found`, `409 already_converted` (`details.articleId`).

<a id="linkedin"></a>

## 10. LinkedIn

Handlers : [`distribution.ts`](../src/server/handlers/distribution.ts). DTO : [`LinkedInPost`](../src/lib/api/types.ts). L'API LinkedIn n'est pas disponible au pilote : la diffusion est un **export** (adaptateur `ExportOnlyLinkedIn`, `apiAvailable = false`).

```mermaid
stateDiagram-v2
  [*] --> brouillon: POST /linkedin
  brouillon --> a_valider: submit
  a_valider --> approuve: approve
  approuve --> approuve: approve
  approuve --> a_valider: PATCH (modification)
  approuve --> exporte: publish
  exporte --> a_valider: PATCH (modification)
```

Un `PATCH` sur un post `brouillon` ou `a_valider` crée une version sans changer le statut. Le statut `publie` n'est atteint par aucun endpoint.

<a id="get-linkedin"></a>

### `GET /api/linkedin` — liste

- **Client** : `api.linkedinPosts()` (hook `useLinkedInPosts`).
- **Droit** : aucun.
- **Réponse** : `200` `LinkedInPost[]`, par mise à jour décroissante.

<a id="post-linkedin"></a>

### `POST /api/linkedin` — générer un post (WF4)

- **Client** : `api.createLinkedInPost({ articleId, signalId })`.
- **Droit** : `linkedin.write` (admin, rédacteur).
- **Réponse** : `201` `LinkedInPost` (`status: "brouillon"`, `version: 1`, `selectedVariantId` = première variante).

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `articleId` | chaîne | l'un des deux | 1 à 64 caractères ; article existant |
| `signalId` | chaîne | l'un des deux | 1 à 64 caractères ; signal existant ; défaut : signal de l'article |

Effets : refus si un post non exporté existe déjà pour cet article (ou pour ce signal sans article) ; contrôle du quota `linkedin_posts` ; appel payant `generation_linkedin` (0,08 €) produisant les variantes par gabarit (`linkedinVariants`), éventuellement réécrites par OpenAI ; identifiants de variantes `<postId>_v<i>` ; audit `linkedin.create`. L'article n'a pas besoin d'être approuvé.

Erreurs spécifiques : `400 validation_error` (aucun des deux champs : « articleId ou signalId est requis »), `404 not_found`, `409 post_exists` (`details.postId`), `422 quota_exceeded`, `402 budget_exhausted`.

```bash
curl -s -X POST http://localhost:8080/api/linkedin \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas' \
  -d '{"signalId":"sig_verkor"}'
```

<a id="patch-linkedin"></a>

### `PATCH /api/linkedin/:id` — modifier variantes ou sélection

- **Client** : `api.updateLinkedInPost(id, input)`.
- **Droit** : `linkedin.write` (admin, rédacteur).
- **Réponse** : `200` `LinkedInPost`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `selectedVariantId` | chaîne | non | 1 à 64 caractères ; variante existante |
| `variants` | `{ id, text, hashtags }[]` | non | 1 à 4 éléments, remplace la liste complète ; `id` 1 à 64 caractères et unique ; `text` 1 à 3 000 caractères ; `hashtags` 15 au plus, 1 à 60 caractères |

Sans `selectedVariantId`, la sélection courante est conservée si elle existe encore, sinon la première variante est sélectionnée. Sans changement effectif, le post est renvoyé tel quel. Sinon : `version + 1`, approbation invalidée (« Contenu modifié après approbation »), statut `a_valider` si le post était `approuve` ou `exporte` ; audit `linkedin.update`.

Erreurs spécifiques : `404 not_found`, `409 invalid_state` (post `publie`), `422 variant_not_found`, `422 duplicate_variant`.

<a id="post-linkedin-submit"></a>

### `POST /api/linkedin/:id/submit` — soumettre à validation

- **Client** : `api.submitLinkedInPost(id)`.
- **Droit** : `linkedin.write` (admin, rédacteur).
- **Corps** : aucun.
- **Réponse** : `200` `LinkedInPost`.

Effets : `brouillon` passe `a_valider`, audit `linkedin.submit`, notification « Post LinkedIn à valider ». Un post déjà `a_valider` est renvoyé sans effet. Erreurs spécifiques : `404 not_found`, `409 invalid_state` (« Seul un brouillon peut être soumis à validation. »).

<a id="post-linkedin-approve"></a>

### `POST /api/linkedin/:id/approve` — approuver la version relue

- **Client** : `api.approveLinkedInPost(id, version)`.
- **Droit** : `linkedin.decide` (admin, validateur).
- **Réponse** : `200` `LinkedInPost`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `version` | entier | oui | ≥ 1 ; doit être la version courante |

Effets : nouvelle approbation unique (`approval`, canal `linkedin`) remplaçant la précédente, statut `approuve`, audit `linkedin.approve`. Erreurs spécifiques : `404 not_found`, `409 version_mismatch` (`details.currentVersion`), `409 invalid_state` (post ni `a_valider` ni `approuve`).

<a id="post-linkedin-publish"></a>

### `POST /api/linkedin/:id/publish` — exporter le post

- **Client** : `api.publishLinkedInPost(id)`.
- **Droit** : `publish` (admin, validateur).
- **Corps** : aucun.
- **Réponse** : `201` `PublicationAttempt` ; `200` avec la tentative existante si l'export a déjà réussi pour cette version (sans audit).

Effets : clé d'idempotence `sha256("<postId>:<version>:linkedin")` ; contrôle `checkPublishable` sur l'approbation du post (codes `approval_missing`, `approval_invalidated`, `approval_version_mismatch`), tentative bloquée persistée et audit `publication.blocked` en cas de refus ; en cas de succès, tentative `status: "succes"`, `mode: "export"`, `code: "linkedin_api_unavailable"`, `message` = « API LinkedIn non disponible au pilote (accès non accordés) : contenu exporté pour publication manuelle. », `articleId` = article d'origine ; post passé `exporte` ; audit `publication.success`. Aucune notification.

Erreurs spécifiques : `404 not_found`, `422` avec un code de blocage (`details.attempt`).

```bash
curl -s -X POST http://localhost:8080/api/linkedin/li_pasqal/approve \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_claire' \
  -d '{"version":1}'
curl -s -X POST http://localhost:8080/api/linkedin/li_pasqal/publish \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_claire'
```

<a id="get-linkedin-export"></a>

### `GET /api/linkedin/:id/export` — télécharger le texte du post

- **Client** : `downloadUrl.linkedin(id)`.
- **Droit** : aucun.
- **Réponse** : `200`, fichier `linkedin-<id>-v<version>.txt` (`text/plain; charset=utf-8`).

Contenu : texte de la variante sélectionnée, ligne vide, hashtags préfixés par `#` et séparés par des espaces. Si la version courante n'est pas couverte par une approbation valide, le fichier commence par « [APERÇU — version non approuvée, ne pas publier] ». Aucun effet de bord. Erreurs spécifiques : `404 not_found`.

<a id="newsletters"></a>

## 11. Newsletters

Handlers : [`distribution.ts`](../src/server/handlers/distribution.ts), service [`newsletters.ts`](../src/server/services/newsletters.ts), rendu [`newsletter.ts`](../src/server/domain/newsletter.ts). DTO : [`NewsletterEdition`](../src/lib/api/types.ts) (sujets triés par `order`). KORA n'envoie jamais la newsletter : l'édition approuvée est exportée en HTML et en texte pour un envoi manuel.

```mermaid
stateDiagram-v2
  [*] --> composition: POST /newsletters ou inclusion d'un signal
  composition --> approuvee: approve
  approuvee --> approuvee: approve
  approuvee --> composition: PATCH, ajout ou retrait de sujet
  composition --> composition: PATCH, ajout ou retrait de sujet
  approuvee --> exportee: GET export (approuvée et droit publish)
  exportee --> [*]
```

Toute modification (titre, introduction, sujets) crée une nouvelle version (`touchEdition`), invalide l'approbation et repasse l'édition en `composition`. Une édition `exportee` n'est plus modifiable (`409 invalid_state`). L'« édition courante » utilisée par le dashboard et par `PATCH /signals/:id` est la plus récente non exportée (`currentEdition`).

<a id="get-newsletters"></a>

### `GET /api/newsletters` — liste

- **Client** : `api.newsletters()` (hook `useNewsletters`).
- **Droit** : aucun.
- **Réponse** : `200` `NewsletterEdition[]`, par création décroissante.

<a id="post-newsletters"></a>

### `POST /api/newsletters` — créer une édition

- **Client** : `api.createNewsletter({ title, weekOf })`.
- **Droit** : `newsletter.write` (admin, rédacteur).
- **Réponse** : `201` `NewsletterEdition` (`status: "composition"`, `version: 1`, aucun sujet, introduction par défaut).

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `title` | chaîne | non | 1 à 200 caractères ; défaut « Newsletter Inovallée — semaine du `<date>` » |
| `weekOf` | date ISO 8601 | non | ramenée au lundi 00:00 de sa semaine ; défaut : lundi de la semaine suivante |

`scheduledFor` vaut le lundi de `weekOf` à 9 h (information éditoriale, aucun envoi). Effets : contrôle du quota `newsletters` (5 éditions créées par mois), audit `newsletter.create`. Erreurs spécifiques : `422 quota_exceeded`.

<a id="get-newsletter"></a>

### `GET /api/newsletters/:id` — détail

- **Client** : `api.newsletter(id)`.
- **Droit** : aucun.
- **Réponse** : `200` `NewsletterEdition`. Erreurs spécifiques : `404 not_found` (« Édition introuvable. »).

<a id="patch-newsletter"></a>

### `PATCH /api/newsletters/:id` — titre, introduction, ordre et résumés

- **Client** : `api.updateNewsletter(id, input)`.
- **Droit** : `newsletter.write` (admin, rédacteur).
- **Réponse** : `200` `NewsletterEdition`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `title` | chaîne | non | 1 à 200 caractères |
| `intro` | chaîne | non | 3 000 caractères au plus |
| `items` | `{ id, summary, order }[]` | non | 100 au plus ; `id` d'un sujet de l'édition ; `summary` 1 à 1 500 caractères ; `order` entier ≥ 0 |

`items` peut ne contenir qu'une partie des sujets : seuls ceux listés reçoivent le nouveau résumé et le nouvel ordre, puis tous les sujets sont renumérotés de 1 à `n` selon `order` (un sujet passé à `order: 20` part en dernière position). Sans changement effectif, l'édition est renvoyée telle quelle ; sinon nouvelle version, approbation invalidée, statut `composition`, audit `newsletter.update`.

Erreurs spécifiques : `404 not_found`, `409 invalid_state` (édition exportée, vérifié avant la validation du corps), `422 item_not_found` (`details.itemIds`).

<a id="post-newsletter-items"></a>

### `POST /api/newsletters/:id/items` — ajouter un sujet

- **Client** : `api.addNewsletterItem(id, { signalId, articleId })`.
- **Droit** : `newsletter.write` (admin, rédacteur).
- **Réponse** : `201` `NewsletterEdition`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `signalId` | chaîne | l'un des deux | signal existant |
| `articleId` | chaîne | l'un des deux | article existant ; son signal est repris s'il en a un |

Effets : appel payant `generation_summary` (0,02 €) produisant le résumé (gabarit `summarize`, éventuellement réécrit par OpenAI) à partir de l'extrait de l'article ou du résumé du signal ; sujet ajouté en dernière position ; nouvelle version, approbation invalidée ; audit `newsletter.item_add`.

Erreurs spécifiques : `400 validation_error` (« signalId ou articleId est requis »), `404 not_found`, `409 invalid_state`, `409 already_in_newsletter` (`details.itemId`), `402 budget_exhausted`.

```bash
curl -s -X POST http://localhost:8080/api/newsletters/nl_current/items \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_lucas' \
  -d '{"signalId":"sig_verkor"}'
```

<a id="delete-newsletter-item"></a>

### `DELETE /api/newsletters/:id/items/:itemId` — retirer un sujet

- **Client** : `api.removeNewsletterItem(id, itemId)`.
- **Droit** : `newsletter.write` (admin, rédacteur).
- **Réponse** : `200` `NewsletterEdition` (et non `204`).

Effets : sujet retiré, renumérotation, nouvelle version, approbation invalidée, audit `newsletter.item_remove`. Erreurs spécifiques : `404 not_found` (édition, ou sujet absent de l'édition, vérifié avant l'état), `409 invalid_state`.

<a id="post-newsletter-approve"></a>

### `POST /api/newsletters/:id/approve` — approuver la version relue

- **Client** : `api.approveNewsletter(id, version)`.
- **Droit** : `newsletter.decide` (admin, validateur).
- **Réponse** : `200` `NewsletterEdition`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `version` | entier | oui | ≥ 1 ; doit être la version courante |

Il n'y a pas d'étape de soumission : une édition `composition` s'approuve directement. Effets : approbation unique (canal `newsletter`), statut `approuvee`, audit `newsletter.approve`. Erreurs spécifiques : `404 not_found`, `409 invalid_state` (édition exportée), `409 version_mismatch` (`details.currentVersion`), `422 newsletter_empty`.

```bash
curl -s -X POST http://localhost:8080/api/newsletters/nl_current/approve \
  -H 'x-kora-request: 1' -H 'content-type: application/json' -b 'kora_uid=u_claire' \
  -d '{"version":6}'
```

<a id="get-newsletter-export"></a>

### `GET /api/newsletters/:id/export` — télécharger HTML ou texte

- **Client** : `downloadUrl.newsletter(id, format)`.
- **Droit** : aucun pour télécharger ; la consignation de l'export exige `publish` (admin, validateur).
- **Paramètre** : `format` = `html` (défaut) ou `txt`.
- **Réponse** : `200`, fichier `newsletter-<AAAA-MM-JJ de weekOf>-v<version>.html` (`text/html; charset=utf-8`) ou `.txt` (`text/plain; charset=utf-8`).

Le fichier est rendu par `renderNewsletterHtml` ou `renderNewsletterText`. Si la version courante n'est pas couverte par une approbation valide, le rendu porte la mention « Aperçu — version `n` non approuvée. » (HTML) ou « [APERÇU — version `n` non approuvée] » (texte).

**Effet de bord sur un `GET`** : si l'édition est approuvée pour sa version courante **et** que l'utilisateur a le droit `publish`, le premier téléchargement crée une tentative de publication `succes` (`mode: "export"`, clé `sha256("<editionId>:<version>:newsletter")`), passe l'édition à `exportee` (elle n'est plus modifiable) et écrit l'audit `publication.success`. Les téléchargements suivants ne créent pas de doublon. Comme pour tout `GET`, l'en-tête anti-CSRF n'est pas exigé, et une requête sans cookie agit en tant que `u_sophie` (qui a le droit `publish`).

Erreurs spécifiques : `404 not_found`, `400 invalid_format`.

```bash
curl -s -OJ -b 'kora_uid=u_claire' 'http://localhost:8080/api/newsletters/nl_current/export?format=txt'
```

<a id="editorial-dna"></a>

## 12. Editorial DNA

Handlers : [`distribution.ts`](../src/server/handlers/distribution.ts), service [`dna.ts`](../src/server/services/dna.ts), domaine [`dna.ts`](../src/server/domain/dna.ts). DTO : [`EditorialDna`](../src/lib/api/types.ts), [`EditorialRule`](../src/lib/api/types.ts) (sans historique), [`RuleProposal`](../src/lib/api/types.ts) (sans signature interne). Les corrections humaines alimentent des propositions de règles ; rien n'est appliqué sans décision explicite (WF6).

<a id="get-editorial-dna"></a>

### `GET /api/editorial-dna` — référentiel éditorial

- **Client** : `api.editorialDna()` (hook `useEditorialDna`).
- **Droit** : aucun.
- **Réponse** : `200` `EditorialDna` : `rules` (triées par identifiant), `examples` (ordre du store), `proposals` (par création décroissante).

Les propositions sont recalculées par `refreshProposals` lorsqu'une version humaine succède à une version KORA ([`POST /api/articles/:id/versions`](#post-article-versions)) ; une proposition décidée n'est jamais reproposée.

<a id="post-editorial-dna-rules"></a>

### `POST /api/editorial-dna/rules` — créer une règle

- **Client** : `api.createRule({ kind, text })`.
- **Droit** : `rule.write` (admin).
- **Réponse** : `201` `EditorialRule` (`active: true`, `version: 1`).

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `kind` | `RuleKind` | oui | `ton`, `longueur`, `structure`, `vocabulaire`, `interdit` |
| `text` | chaîne | oui | 1 à 500 caractères |

Effets : historique initialisé, audit `rule.create`. Les règles actives sont transmises au générateur de dossiers ([`POST /api/articles`](#post-articles)).

<a id="patch-editorial-dna-rule"></a>

### `PATCH /api/editorial-dna/rules/:id` — modifier ou désactiver une règle

- **Client** : `api.updateRule(id, { text, active })`.
- **Droit** : `rule.write` (admin).
- **Réponse** : `200` `EditorialRule`.

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `text` | chaîne | non | 1 à 500 caractères |
| `active` | booléen | non | — |

Effets : sans changement effectif, la règle est renvoyée telle quelle ; sinon `version + 1`, révision ajoutée à l'historique (non exposé), audit `rule.update` (mentionne « réactivée » ou « désactivée »). Erreurs spécifiques : `404 not_found`.

<a id="patch-editorial-dna-proposal"></a>

### `PATCH /api/editorial-dna/proposals/:id` — décider d'une proposition

- **Client** : `api.decideRuleProposal(id, decision)`.
- **Droit** : `rule.write` (admin).
- **Réponse** : `200` `RuleProposal` (`status` = décision, `decidedBy` = nom de l'utilisateur).

| Champ | Type | Requis | Contraintes |
|---|---|---|---|
| `decision` | `"acceptee"` \| `"refusee"` | oui | — |

Effets : une proposition acceptée remplace le texte de la règle visée (`ruleId`, nouvelle version, règle réactivée) ou crée une nouvelle règle si `ruleId` est vide ou introuvable ; audit `rule.proposal` (`entityId` = `ruleId`, à défaut l'identifiant de la proposition). Erreurs spécifiques : `404 not_found`, `409 already_decided`.

```bash
curl -s -X PATCH http://localhost:8080/api/editorial-dna/proposals/<proposalId> \
  -H 'x-kora-request: 1' -H 'content-type: application/json' \
  -d '{"decision":"acceptee"}'
```

<a id="ajouter-un-endpoint"></a>

## 13. Ajouter un endpoint

Fichiers à toucher, dans l'ordre :

| Étape | Fichier | À faire |
|---|---|---|
| 1 | [`types.ts`](../src/lib/api/types.ts) | DTO de réponse et type d'entrée ; nouvelle valeur de `AuditEvent["entity"]` si besoin |
| 2 | [`records.ts`](../src/server/store/records.ts), [`repository.ts`](../src/server/store/repository.ts), [`memory.ts`](../src/server/store/memory.ts), [`seed.ts`](../src/server/store/seed.ts) | seulement pour une nouvelle collection : enregistrement, `Collection`, store, seed ; conversion DTO dans [`view.ts`](../src/server/services/view.ts) |
| 3 | [`validation.ts`](../src/server/validation.ts) | schéma zod dans `schemas` |
| 4 | [`permissions.ts`](../src/server/domain/permissions.ts) | nouvelle `Action` et entrée de `MATRIX` si aucune action existante ne convient |
| 5 | `src/server/handlers/<domaine>.ts` | handler `Handler` : droit, validation, règle, persistance, audit, réponse |
| 6 | [`router.ts`](../src/server/router.ts) | ligne dans `ROUTES` (un motif littéral doit précéder un motif `:param` de même méthode et de même longueur) |
| 7 | [`client.ts`](../src/lib/api/client.ts) | méthode `api.xxx` (ou entrée `downloadUrl` pour un fichier) |
| 8 | [`hooks.ts`](../src/lib/api/hooks.ts) | clé `qk` et hook `useXxx` pour une lecture ; `useKoraMutation` dans le composant pour une écriture |
| 9 | `src/test/server/*.test.ts` | test via `setup`, `teardown`, `call` et `USERS` de [`helpers.ts`](../src/test/server/helpers.ts) |
| 10 | ce document | ligne du récapitulatif et section de l'endpoint |

Règles à respecter : contrôler le droit en premier (`assertCan`), valider tout corps avec `parse` (jamais de lecture directe de `ctx.body`), lever des `HttpError` via les aides de `http.ts` avec un `code` stable, journaliser toute décision avec `audit`, invalider les approbations sur toute modification d'un contenu approuvé (`invalidateApprovals` / `invalidateApproval`), passer tout appel à un modèle ou à un fournisseur facturé par `assertQuota` puis `paidCall`, et ne renvoyer que des DTO (jamais d'enregistrement brut contenant des champs internes).

Squelette, sur un exemple **fictif** (cet endpoint n'existe pas) : modifier la note d'une grille de score.

```ts
// src/server/validation.ts — dans `schemas`
gridNote: z.object({ note: z.string().trim().max(500).nullable() }),
```

```ts
// src/server/handlers/signals.ts
export const updateGridNote: Handler = async (ctx) => {
  assertCan(ctx.user, "grid.write");
  const rec = await ctx.repo.grids.get(`grid_v${ctx.params["version"]}`);
  if (!rec) throw notFound("Grille introuvable.");
  const { note } = parse(schemas.gridNote, ctx.body);
  const next: GridRecord = { ...rec, note: note || null };
  await ctx.repo.grids.update(next);
  await audit(ctx, "grid.note", "grid", rec.id, `Note de la grille v${rec.version} modifiée`);
  return json(toGrid(next));
};
```

```ts
// src/server/router.ts — dans ROUTES, avec les grilles
{ method: "PATCH", pattern: "/scoring-grids/:version", handler: signals.updateGridNote },
```

```ts
// src/lib/api/client.ts — dans `api`
updateScoringGridNote: (version: number, note: string | null) =>
  apiFetch<ScoringGrid>(`/scoring-grids/${version}`, json("PATCH", { note })),
```

```ts
// Composant : la mutation invalide le cache ["kora"] et affiche un toast
const saveNote = useKoraMutation(
  (v: { version: number; note: string | null }) => api.updateScoringGridNote(v.version, v.note),
  { success: "Note enregistrée" },
);
```

```ts
// src/test/server/signals.test.ts
it("modifie la note d'une grille (administration uniquement)", async () => {
  const ok = await call<ScoringGrid>("PATCH", "/scoring-grids/1", { body: { note: "Grille initiale" } });
  expect(ok.status).toBe(200);
  expect(ok.body.note).toBe("Grille initiale");
  const denied = await call("PATCH", "/scoring-grids/1", {
    body: { note: "x" },
    user: USERS.redacteur,
  });
  expect(denied.status).toBe(403);
});
```

Les tests appellent directement `handleApiRequest` (pas de serveur HTTP) avec un store réinitialisé depuis le seed et une horloge figée (`NOW` = 12 octobre 2026, 10 h 30) ; `call` ajoute l'en-tête anti-CSRF sauf avec `csrf: false`, et `multipart()` construit un corps `multipart/form-data`. Lancer `bun run test`.

<a id="limites"></a>

## 14. Limites connues de l'API

Comportements actuels à connaître avant d'exposer l'API au-delà de la démonstration. Les aspects de sécurité sont développés dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

- **Pas d'authentification** : sans cookie, toute requête agit en tant qu'administratrice `u_sophie`, et `POST /api/me` permet de prendre n'importe quelle identité.
- **`GET /api/newsletters/:id/export` modifie l'état** (export consigné, édition verrouillée) alors que les `GET` ne sont pas soumis à l'en-tête anti-CSRF.
- **Persistance en mémoire** : toutes les écritures sont perdues au redémarrage ; le schéma PostgreSQL [`schema.sql`](../db/postgres/schema.sql) n'est pas branché.
- **Pagination** : seule la liste des signaux est paginée ; les autres listes renvoient tout.
- **Pas de planification** : la collecte n'est déclenchée que par `POST /collect` ou `POST /sources/:id/collect`, et la programmation d'un article (`scheduledAt`) ne déclenche rien.
- **Canaux simulés** : WordPress ne crée que des brouillons simulés, LinkedIn n'est qu'un export, la newsletter n'est jamais envoyée.
- **Plafonds non administrables** : aucun endpoint ne modifie `quotaLimits` ni ne lève une suspension budgétaire ; les quotas `search_queries` et `observations` ne sont pas bloquants.
- **Réversibilité partielle** : les contenus (corps des versions d'articles, posts, éditions) et les fichiers importés ne font pas partie des exports d'entités (voir [Exports et téléchargements](#exports)).
