# KORA Newsroom — Jalon classification multilingue FR/EN et routage IA

> **Archive du 30/10/2026 — ne pas utiliser comme état courant de l'architecture.** Ce jalon v1.1 décrit la classification seule avec GPT-4o mini en secours. La migration locale du 31/10/2026 vers Haiku 5.5 principal / GPT-4.1 mini en secours pour les chemins éditoriaux, ainsi que les correctifs A1/A2, sont décrits dans [le jalon v1.2](2026-10-31-correctifs-ia-a1-a2-v1.2.md). Le texte historique ci-dessous est conservé sans réécriture ; v1.2 n'est pas une homologation production.

**Version documentaire :** 1.1 — 30 octobre 2026
**Statut :** jalon technique intermédiaire ; **38 tests ciblés réussis**, **non homologué pour production**
**Branche locale :** `fix/kora-classification-multilingue`
**Projet :** KORA Newsroom / Inovallée
**Pilotage et revue technique :** Aya
**Destination dans le dépôt :** `docs/2026-10-30-jalon-classification-multilingue-v1.1.md`

> **Lecture impérative.** Le 30/10/2026, les **38 tests ciblés / 8 fichiers** ont réussi ensemble, et le build client / SSR / Nitro a réussi séparément. La correction du **comptage estimatif des tentatives IA** est validée sur des mocks. Cela ne constitue ni une recette exhaustive, ni une mesure des factures fournisseurs, ni une validation des API réelles, ni un feu vert pour déployer ou activer le secours payant.

## 1. Objet, périmètre et sources de preuve

Ce jalon couvre la **classification éditoriale** des publications françaises et anglaises collectées par KORA, le **regroupement d'actualités portant sur un même événement**, et le **choix du fournisseur IA pour cette classification**. L'objectif est d'obtenir une catégorie exploitable, une importance éditoriale et un motif, avec dégradation contrôlée lorsque l'IA est indisponible.

**Inclus :** règles lexicales FR/EN ; classification IA ; validation de la réponse ; repli contrôlé entre fournisseurs ; réserve budgétaire préalable ; **suivi estimatif du nombre de tentatives pour le budget API global** ; tests unitaires et d'intégration simulés.

**Non inclus :** modification de la génération des articles, des brouillons, des variantes LinkedIn ou du résumé éditorial ; changement de la collecte Google News/Perplexity ; déploiement ; accès aux vraies données Inovallée/Supabase ; facture réelle de fournisseurs.

**Sources utilisées pour ce rapport :**

1. Sorties terminal de la branche locale transmises le **30/10/2026**, dont une exécution unique de **38/38 tests à 22:28:23**, build Vite/SSR/Nitro terminé avec succès vers **22:25**, contrôles TypeScript précédemment transmis et états Git antérieurs.
2. Code de référence et documentation de la branche GitHub `main` de `Makk7709/koraino`, consultés pour les contrats existants ; **`main` n'est pas la branche modifiée**.
3. Contenu des correctifs fournis pour Haiku 5.5 / GPT-4o mini et pour le budget API global (`classification-providers.ts`, `kora-budget-api-comptage-minimal.py`), avec leurs suites de tests mockés. L'exécution de ces correctifs dans le dépôt local a été confirmée par les sorties terminal.
4. Documentation officielle des API, listée en § 12.

**Limite de preuve :** l'état local a été communiqué par les sorties terminal, mais le diff complet et le SHA de `HEAD` n'ont pas été fournis. Les descriptions du contenu modifié doivent être rapprochées de `git diff` et des nouveaux fichiers non suivis avant toute revue ou PR.

## 2. Problème initial

Le repli lexical historique reconnaissait correctement plusieurs formulations françaises sans reconnaître leurs équivalents anglais. Par exemple, un article parlant d'un partenariat pouvait être classé `partenariat` en français mais tomber sur la catégorie par défaut `innovation` en anglais. Cette différence pouvait fragiliser le regroupement de deux médias couvrant le même événement.

La correction apporte deux niveaux distincts :

- **Niveau 1, IA :** classification sémantique de la publication, à partir d'un titre, d'un extrait nettoyé et du nom de l'entreprise.
- **Niveau 2, lexical :** expressions pondérées FR/EN lorsque la classification IA ne fournit pas d'évaluation exploitable.

Ce n'est **pas** un moteur de traduction ; ni une promesse que tout article, dans n'importe quelle langue, sera classé ou regroupé correctement.

## 3. Architecture retenue au 30/10/2026

```text
Publication collectée (FR / EN)
           |
Nettoyage, sélection des éléments nouveaux, au plus MAX_ITEMS = 5/source
           |
     Claude Haiku 5.5
     (Anthropic API, modèle principal)
           |
     +-----+------------------------------+
     | réponse valide                     | erreur éligible / JSON invalide
     v                                    v
Catégorie + importance            Fallback autorisé ?
+ motif + modèle                  (flag, clés, réserve)
     |                                    |
     |                          oui ------+------ non
     |                           |                 |
     |                      GPT-4o mini           |
     |                      (OpenAI API)          |
     |                           |                |
     |               résultat valide ?           |
     |                    |      |                |
     |                   oui    non               |
     |                    |      |                |
     +--------------------+      +----------------+
     |                                      |
     |                            Règles lexicales FR/EN
     |                                      |
     +-------------------+------------------+
                         |
              Regroupement / scoring / revue humaine
```

**Modèles implémentés par le patch :**

| Rôle | Fournisseur / endpoint | Modèle | Variable de clé |
|---|---|---|---|
| Principal **classification seulement** | Anthropic `POST /v1/messages` | `claude-haiku-5-5` | `ANTHROPIC_API_KEY` |
| Secours **classification seulement** | OpenAI `POST /v1/chat/completions` | `gpt-4o-mini` | `AI_API_KEY` |
| Dernier recours | Code interne KORA | `classifyCategory()` (FR/EN) | Aucune |

La génération de dossiers, de posts LinkedIn et de résumés suit le chemin préexistant et **n'a pas été migrée vers Haiku**. Le nom historique `OpenAiEnhancer` subsiste dans le code même si la classification utilise désormais un orchestrateur distinct : dette de nommage, pas preuve que la classification utilise OpenAI en principal.

### 3.1 Ordre d'appel et politique de repli

- **Réponse Haiku valide** : retourner son évaluation ; ne pas appeler OpenAI.
- **Erreur Haiku 408, HTTP 5xx, erreur réseau ou timeout** : secours possible seulement si activé et configuré.
- **HTTP 429** : secours seulement si le corps identifie explicitement un débit limité (`rate_limit_error`, `rate_limit_exceeded` ou `slow_down`). Un 429 assimilé à des crédits épuisés **ne déclenche pas** de repli.
- **HTTP 401 ou 402** : pas de secours ; pas de contournement d'une erreur d'authentification ou de facturation.
- **Réponse Haiku HTTP 200 mais JSON invalide / réponse éditoriale inexploitable** : le code fourni permet le secours.
- **Secours indisponible ou invalide** : retourner `null` ; le service de collecte utilise ensuite les règles lexicales.
- **Absence de clé principale** : aucun appel au modèle secondaire dans le comportement actuellement testé.

Ces comportements sont démontrés avec des réponses `fetch` **simulées**, pas avec de véritables incidents Anthropic/OpenAI.

### 3.2 Entrées, sorties et validations

- Entrée : `title`, `text`, `companyName` ; titre limité à 300 caractères et texte transmis limité à 1 500 caractères dans le module de fournisseur ; une étape de nettoyage existe dans le service de collecte.
- Sortie : objet JSON avec `category` dans la taxonomie KORA, `importance` éditoriale de 0 à 100, `reason` et `model` enregistré avec la réponse validée.
- Le prompt rappelle que le contenu web est une **donnée non fiable**, jamais une instruction à exécuter.
- Anthropic : format JSON Schema demandé avec `output_config.format` ; OpenAI : `response_format: { type: "json_object" }`.
- `toAssessment()` vérifie l'appartenance à une catégorie connue, la plage d'importance et l'existence d'un motif. **Réserve technique :** la validation métier n'est pas encore une validation stricte Ajv/Zod de bout en bout : la fonction convertit `importance` par `Number(...)` avant d'arrondir. Il faut décider si les types non entiers/chaînes numériques sont recevables ou à rejeter.
- Timeout réseau : **15 secondes par fournisseur**, soit jusqu'à **environ 30 secondes** d'attente théorique en cas de bascule, hors autres opérations du lot. Aucun benchmark de latence réelle n'est fourni.

### 3.3 Règles lexicales et regroupement FR/EN

`src/server/domain/clustering.ts` : ajout d'indices anglais ciblés pour **financement, acquisition, contrat, partenariat et recrutement**, en conservant les expressions françaises et le mécanisme de pondération existant (indice fort : 3 ; faible : 1 ; valeur de repli sans indice : `innovation`). Les tests protègent notamment un partenariat FR/EN et des événements qui ne doivent pas être fusionnés abusivement.

Le regroupement d'un même événement s'appuie toujours sur l'entreprise, la date, les titres, l'affinité lexicale et les entités pertinentes. Une même catégorie **ne suffit pas** pour fusionner deux événements ; les cas incertains exigent une revue humaine. La pertinence métier sur un corpus représentatif n'a pas encore été mesurée.

## 4. Fichiers concernés dans la branche locale

| Chemin | Nature du changement / rôle |
|---|---|
| `src/server/domain/clustering.ts` | Extension des règles lexicales anglaises, en conservant les règles françaises. |
| `src/server/adapters/classification-providers.ts` | **Nouveau** : appels Anthropic Haiku 5.5 et repli OpenAI GPT-4o mini ; résultat `primaryCalls` / `fallbackCalls`. |
| `src/server/adapters/openai.ts` | Délégation de la classification à l'orchestrateur ; exposition de `classifyWithUsage()` ; fonctions éditoriales historiques conservées. |
| `src/server/adapters/index.ts` | Activation de l'adaptateur IA en fonction des clés appropriées ; isolation sous Vitest. |
| `src/server/adapters/collector.ts` | Ajout de `RawItem.classificationUsage` **transitoire, en mémoire** : nombres d'appels principaux et de secours. |
| `src/server/services/collection.ts` | Transmission des compteurs à `usageLines()` ; réservation des appels potentiels et enregistrement des tentatives dans le **budget API global**. |
| `src/test/server/classification-multilingue.test.ts` | **Nouveau**, 9 tests. |
| `src/test/server/classification-ia-integration.test.ts` | **Nouveau**, 3 tests. |
| `src/test/server/ia-fallback.test.ts` | **Nouveau**, 11 tests Haiku → GPT-4o mini. |
| `src/test/server/ia-fallback-budget.test.ts` | **Nouveau**, 1 test du refus budgétaire. |
| `src/test/server/ia-fallback-tracabilite.test.ts` | **Nouveau**, 1 test d'intégration du comptage de deux tentatives au journal. |
| `src/test/server/ia-budget-appels.test.ts` | **Nouveau**, 3 tests unitaires des compteurs d'appels. |
| `src/test/server/scoring-contenu.test.ts` | **Modifié** : libellé de consommation attendu aligné sur « Classification IA principale » ; assertions de nombre et coût maintenues. |
| `docs/2026-10-30-jalon-classification-multilingue-v1.0.md` | Photographie antérieure au correctif budgétaire, à conserver. |
| `docs/2026-10-30-jalon-classification-multilingue-v1.1.md` | **Présent document**, état après les 38 tests ciblés. |

**Limite d'inspection :** la branche de travail reste sur le Mac de développement ; le diff complet et le nouvel état `git status --short` après le dernier changement de test n'ont pas été transmis. Ce tableau décrit les chemins observés dans les sorties et les scripts, pas une inspection directe du worktree au moment de la rédaction.

## 5. Configuration, sécurité et budget

| Variable | Utilisation | Règle de sécurité |
|---|---|---|
| `ANTHROPIC_API_KEY` | Appel principal à Claude Haiku 5.5 pour **la classification** | Secret serveur ; jamais dans Git ni dans les journaux. |
| `AI_API_KEY` | Appel de secours GPT-4o mini ; aussi utilisée par des fonctions IA historiques | Ne pas la désactiver globalement sans examiner ces autres fonctions. |
| `KORA_AI_FALLBACK_ENABLED` | Bascule activable seulement avec valeur exacte `"true"` | **Rester désactivé** jusqu'à recette et approbation. |
| `KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL` | Estimation forfaitaire de réserve **par tentative potentielle du secours** | Montant positif et fini ; non assimilable à un tarif réel. |
| `OPENROUTER_API_KEY`, `KORA_AI_FALLBACK_MODEL` | Configuration ancienne OpenAI → OpenRouter | Sans rôle dans la nouvelle classification ; vérifier d'éventuels usages résiduels avant nettoyage. |

### 5.1 Réservation avant les appels

`estimatePerSource()` réserve l'enveloppe d'une recherche, des observations et des classifications principales, plus **une réserve supplémentaire pour un éventuel appel secondaire par publication** lorsque ce secours est activé et configuré. Une réservation qui dépasserait le budget API bloque la collecte avant appel. Le test `ia-fallback-budget.test.ts` valide ce comportement (HTTP 402, aucun appel collecteur).

Le **budget global de 150 € / mois est la valeur par défaut** dans le domaine ; les limites peuvent être configurées. Le coût estimé de classification principale est `COSTS.classification = 0.005 €` dans le code de référence. La réserve secondaire vient d'une variable de configuration. **Il s'agit de conventions estimatives pour KORA**, pas de prix contractuels Anthropic/OpenAI ni de factures clients.

### 5.2 Écriture des tentatives après les appels — correction v1.1

Dans la collecte, `assessItems()` peut désormais utiliser `ai.classifyWithUsage()` et récupérer :

- `assessment` : évaluation éditoriale valide ou `null` ;
- `primaryCalls` : nombre de tentatives du principal ;
- `fallbackCalls` : nombre de tentatives du modèle de secours.

Les compteurs transitent temporairement dans `RawItem.classificationUsage`. La fonction `usageLines()` sélectionne au plus `MAX_ITEMS = 5` publications nouvelles et crée des lignes `classification` pour les **tentatives**, y compris lorsqu'une réponse n'aboutit pas. Elles portent des libellés distincts, « Classification IA principale » et « Classification IA de secours ».

**La colonne `kind` reste `classification` pour les deux** : la séparation se fait actuellement par libellé, pas par colonnes structurées fournisseur/modèle. C'est un suivi de consommation **estimée** du budget API KORA, et non un journal de coûts exacts ou une comptabilité fournisseurs.

| Scénario simulé | Tentatives principale | Tentatives secours | Résultat éditorial |
|---|---:|---:|---|
| Haiku réussit | 1 | 0 | Évaluation valide |
| Haiku échoue puis GPT réussit | 1 | 1 | Une évaluation valide |
| Les deux échouent | 1 | 1 | Repli lexical FR/EN |
| Secours désactivé, Haiku échoue | 1 | 0 | Repli lexical FR/EN |
| Pas de clé principale | 0 | 0 | Règles lexicales |

L'enregistrement de deux tentatives ne crée **pas deux classifications réussies** et n'introduit **aucun mécanisme de facturation client**.

**Limites de protection :** le budget réserve un montant forfaitaire et `paidCall()` borne l'enregistrement à cette réserve. Il ne s'agit pas d'une garantie de correspondance entre le journal KORA et la facture API réelle. Un coût externe supérieur aux estimations, ou un appel IA hors réservation, peut rendre le plafond indicatif plutôt qu'absolu.

## 6. Résultats des tests — 30 octobre 2026

### 6.1 Validation ciblée commune

Exécution terminal : **22:28:23**, durée **905 ms**, **8 fichiers / 8 réussis ; 38 tests / 38 réussis**.

| Fichier Vitest | Résultat |
|---|---:|
| `src/test/server/classification-multilingue.test.ts` | **9 / 9** |
| `src/test/server/ia-fallback.test.ts` | **11 / 11** |
| `src/test/server/ia-fallback-budget.test.ts` | **1 / 1** |
| `src/test/server/ia-fallback-tracabilite.test.ts` | **1 / 1** |
| `src/test/server/ia-budget-appels.test.ts` | **3 / 3** |
| `src/test/server/regroupement.test.ts` | **5 / 5** |
| `src/test/server/classification-ia-integration.test.ts` | **3 / 3** |
| `src/test/server/scoring-contenu.test.ts` | **5 / 5** |
| **Total** | **38 / 38 — 8 fichiers / 8** |

Les **11 tests de routage IA** vérifient la priorité Haiku, la bascule HTTP 503, le succès du primaire, le double échec, les cas HTTP 401/402, la limitation HTTP 429 temporaire, les crédits épuisés, la désactivation par feature flag, l'absence de réserve, l'absence de clé principale et le JSON éditorial invalide.

Les **4 nouveaux tests de suivi budgétaire** (1 traçabilité intégrée + 3 compteurs unitaires) vérifient les deux tentatives sur une publication avec secours, la réussite du primaire, l'échec des deux modèles et la désactivation du secours.

Un test historique de `scoring-contenu.test.ts` avait brièvement échoué sur un **changement de libellé du journal**, sans erreur de nombre : « Lecture par le modèle » était devenu « Classification IA principale ». Son assertion de libellé a été mise à jour, puis les **38 tests** ont réussi ensemble. Ne pas présenter cette correction de test comme une nouvelle fonction métier.

### 6.2 Contrôles complémentaires

| Contrôle | Preuve disponible | Statut |
|---|---|---|
| `bun --no-env-file run build` | Sortie terminal complète transmise après le correctif : client, SSR et Nitro / Cloudflare réussis | **Réussi** |
| `bunx tsc --noEmit -p .` | Exécuté dans des séquences antérieures sans diagnostic visible ; aucune sortie dédiée postérieure à la correction du libellé n'a été transmise | **Pas d'erreur rapportée ; à reconfirmer sur l'état final** |
| `git diff --check` | Exécuté après les correctifs, sans diagnostic rapporté | **Sans anomalie rapportée** |
| Suite Vitest globale | Aucune preuve d'exécution de toute la suite dans les journaux récents | **Non vérifiée** |
| Lint ciblé / global | Pas de passage vert récent fourni ; erreurs historiques dans le dépôt | **Non validé** |
| Runtime Cloudflare / API réelles | Aucun appel fournisseur réel ni contrôle de production autorisé | **Non vérifié** |

Les avertissements de compilation sur `vite-tsconfig-paths` et `inlineDynamicImports` sont **non bloquants** ; ils ne prouvent ni un dysfonctionnement runtime, ni leur absence.

## 7. Anomalies et risques — état après correction

| ID | Gravité / état | Constat | Action attendue |
|---|---|---|---|
| **KORA-CLF-01** | **Corrigé dans le périmètre ciblé, tests simulés verts** | L'ancienne logique comptait les évaluations valides plutôt que les tentatives. Les compteurs `primaryCalls` / `fallbackCalls` alimentent désormais le budget API estimatif. **4 nouveaux tests verts.** | Vérifier à la revue de code la correspondance complète entre appels tentés, résultats collectés et lignes `usage`; réexaminer si le modèle de consommation change. |
| **KORA-CLF-02** | **Bloquant avant usage réel** | Budget fondé sur des forfaits ; tokens, facturation fournisseur réelle, dépassements de la réserve et conversion monétaire non vérifiés. | Vérifier que les estimations sont conservatrices et expliciter leur niveau de garantie ; tester la concurrence et les échecs d'écriture. |
| **KORA-CLF-03** | **Bloquant avant usage réel** | Les améliorations de résumés, notamment appelées après l'ingestion, n'ont pas été auditées pour garantir qu'elles passent par la réservation `paidCall`. | Inventaire de tous les appels payants et garde budgétaire complète. |
| **KORA-CLF-04** | **Bloquant avant activation** | Aucun appel réel à l'API Anthropic ni à l'API OpenAI dans ce jalon. | Recette contrôlée et explicitement autorisée des contrats HTTP, schémas, en-têtes, refus, limites, clés et quotas, sans données client réelles. |
| **KORA-CLF-05** | **Important** | Pas de mesure qualité de classification / regroupement sur un corpus FR/EN annoté représentatif. | Corpus métier, critères et métriques par langue et catégorie ; revue humaine. |
| **KORA-CLF-06** | **Important** | Timeout de 15 s par fournisseur ; le secours peut allonger la collecte. | Tests de latence, timeouts et concurrence sur environnement isolé. |
| **KORA-CLF-07** | **Important** | Interface `classifyWithUsage()` optionnelle ; deux tentatives distinguées par un libellé, sans modèle/fournisseur structuré dans `UsageEntry`. | Évaluer un contrat de télémétrie strict et typé si nécessaire, sans créer de comptabilité fournisseur. |
| **KORA-CLF-08** | **Important** | Suite Vitest complète, lint ciblé/global et runtime non démontrés sur le dernier état. | Exécutions supplémentaires ; isoler la dette historique de la branche `main`. |

**Point de décision :** `KORA-CLF-01` est clôturé pour le **comptage forfaitaire local couvert par les tests**. Il ne valide pas une comptabilité de dépenses réelles : `KORA-CLF-02` et `KORA-CLF-03` demeurent ouverts. Le feature flag de secours doit rester désactivé en environnement réel tant que la recette de sécurité n'est pas achevée.

## 8. Reproduire la validation ciblée sans API payantes

Depuis le worktree local `~/Projects/koraino-classification`, sur la branche `fix/kora-classification-multilingue` :

```bash
cd ~/Projects/koraino-classification
git branch --show-current

env \
  ANTHROPIC_API_KEY='' \
  AI_API_KEY='' \
  OPENROUTER_API_KEY='' \
  SUPABASE_URL='' \
  SUPABASE_SERVICE_ROLE_KEY='' \
  DATABASE_URL='' \
  LOVABLE_API_KEY='' \
  PERPLEXITY_API_KEY='' \
  bun --no-env-file run test \
  src/test/server/ia-fallback.test.ts \
  src/test/server/ia-fallback-budget.test.ts \
  src/test/server/ia-fallback-tracabilite.test.ts \
  src/test/server/ia-budget-appels.test.ts \
  src/test/server/classification-multilingue.test.ts \
  src/test/server/classification-ia-integration.test.ts \
  src/test/server/scoring-contenu.test.ts \
  src/test/server/regroupement.test.ts

bunx tsc --noEmit -p .
git diff --check
git status --short
```

Puis reproduire le build isolé :

```bash
env \
  ANTHROPIC_API_KEY='' AI_API_KEY='' OPENROUTER_API_KEY='' \
  SUPABASE_URL='' SUPABASE_SERVICE_ROLE_KEY='' DATABASE_URL='' \
  LOVABLE_API_KEY='' PERPLEXITY_API_KEY='' \
  bun --no-env-file run build
```

**Tests à lancer encore avant une PR :** la **suite globale** `bun --no-env-file run test`, puis un lint **ciblé** sur les fichiers réellement modifiés et tests ajoutés. Ne pas lancer de correction automatique générale (`eslint . --fix`, `prettier --write .`) sur le dépôt. Toute clé réelle doit rester absente de l'environnement utilisé pour les simulations.

## 9. État Git et politique de gel documentaire

Les sorties terminal et le correctif confirment le travail local sur `fix/kora-classification-multilingue`, avec les changements de classification, l'ajout de la télémétrie aux publications collectées, l'adaptation de l'ancien test de scoring, la création de `ia-budget-appels.test.ts` et le document v1.0. Le **statut Git final détaillé après ces changements n'a pas encore été transmis** ; exécuter `git status --short` puis examiner `git diff` **et les nouveaux fichiers non suivis** avant tout commit.

**Gel documentaire ≠ commit Git.** v1.0 est conservée comme photographie antérieure à la correction. v1.1 décrit le correctif et la validation ciblée. Aucun commit, push, merge, déploiement Cloudflare/Lovable ou accès à la base Supabase réelle n'est couvert ni autorisé par ce rapport.

## 10. Conditions d'acceptation du jalon v1.1

**Critères atteints sur les preuves disponibles :**

- [x] Règles lexicales FR/EN validées sur les scénarios ciblés.
- [x] Routage Haiku 5.5 puis GPT-4o mini en simulation (11 tests).
- [x] Regroupement, scoring et intégration IA simulée non régressés.
- [x] Réservation budgétaire préalable en présence du secours (test HTTP 402).
- [x] Transmission des compteurs `primaryCalls` / `fallbackCalls` au budget API global estimatif, sans facturation client (4 tests).
- [x] **38 tests ciblés / 38 réussis dans la même exécution**, le 30/10/2026 à 22:28:23.
- [x] Build client + SSR + Nitro réussi après les modifications de suivi du budget.

**Critères restant non démontrés :**

- [ ] Suite Vitest intégrale ; lint ciblé ; vérification TypeScript explicitement relancée après la dernière modification du test.
- [ ] Audit des autres chemins IA susceptibles d'appeler une API sans réservation.
- [ ] Vérification des hypothèses de coût / plafond réel, des écritures de journal concurrentes et des limites de forfait.
- [ ] Tests avec API réelles autorisés, puis runtime isolé Cloudflare.
- [ ] Qualité de classification FR/EN mesurée sur données annotées.
- [ ] Revue du diff complet et preuves CI associées à la future PR.

**Décision :** **OK pour figer/documenter le jalon v1.1 en local et préparer une revue**, **NON pour activer le fallback avec des secrets réels ou mettre en production**.

## 11. Suite de travaux et historique

1. Conserver **v1.0** inchangée comme photographie technique **avant** la correction du comptage.
2. Ajouter **v1.1** à la branche locale en tant qu'état **après** correction, sans écraser v1.0.
3. Exécuter la suite Vitest complète ; vérifier TypeScript et le lint ciblé sur l'état final ; inventorier les différences Git et nouveaux fichiers non suivis.
4. Auditer tous les appels IA payants et l'hypothèse de tarification forfaitaire avant tout usage réel.
5. Définir un protocole de recette sur API réelles à budget limité, sous autorisation explicite, sans données client réelles ; vérifier les résultats métiers et la dégradation lexicale.
6. Ne préparer une PR puis un déploiement qu'après décisions explicites séparées.

**Historique documentaire :**

- **v1.0 (30/10/2026)** — Haiku 5.5 / GPT-4o mini, FR/EN, 34 tests ciblés ; anomalie de comptage ouverte.
- **v1.1 (30/10/2026)** — correction du comptage estimatif des tentatives dans le budget API global ; **38/38 tests ciblés** ; build réussi ; usage réel non homologué.

## 12. Références d'API et documentation officielle

- [Anthropic — Aperçu des modèles / identifiant `claude-haiku-5-5`](https://platform.claude.com/docs/en/models/overview)
- [Anthropic — Authentification des appels API](https://platform.claude.com/docs/en/manage-claude/authentication)
- [Anthropic — Présentation de l'API et en-têtes HTTP](https://platform.claude.com/docs/en/api/overview)
- [Anthropic — Sorties structurées JSON Schema](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [OpenAI — GPT-4o mini (documentation des modèles)](https://platform.openai.com/docs/models/gpt-4o-mini)

Les sources externes valident l'existence des fonctionnalités API documentées, **pas** la réussite des appels ou la qualité du modèle sur les données KORA. Les montants de réserve spécifiques à l'application restent des **estimations internes non validées**.

---

**Historique :** v1.1 — comptage du budget API global par tentative simulée ; 38/38 tests ciblés ; build validé localement. Voir § 11 pour le lien avec v1.0.
