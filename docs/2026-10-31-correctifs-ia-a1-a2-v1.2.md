# KORA Newsroom — Correctifs IA A1/A2 et migration Haiku / GPT-4.1 mini

**Version documentaire :** 1.2 — 31 octobre 2026
**Statut :** correctifs A1/A2 implémentés, validés localement sur mocks et publiés sur la branche de travail ; **non homologués pour production**
**Branche de travail :** `fix/kora-classification-multilingue`
**Périmètre :** classification FR/EN, réécriture éditoriale, résumés et garde budgétaire
**Responsabilité de revue :** pilotage technique KORA
**Décision :** documenter A1/A2 et les rapprocher du registre historique ; maintenir A3/A4 et la recette des API réelles ouverts.

> **Portée de la preuve.** Ce document synthétise le code de la migration préparée et les sorties de validation transmises le 31/10/2026. Il ne prétend ni que la facture des fournisseurs a été contrôlée, ni qu'une transaction réelle Anthropic/OpenAI a été testée, ni qu'un déploiement a eu lieu. Au moment de la première rédaction, la migration était locale, non commitée et non poussée. **Actualisation du suivi le 31/10/2026 :** les commits de code `b38ff57` et de documentation `f264ae8` ont été poussés sur `fix/kora-classification-multilingue`. Cette publication de branche ne vaut ni fusion dans `main`, ni déploiement, ni recette API réelle.

## 1. Historique et traçabilité

- **Jalon v1.1 du 30/10/2026 :** classification FR/EN, Haiku 5.5 en principal et GPT-4o mini en secours **uniquement pour la classification**, sur mocks. Ce jalon est conservé comme photographie historique et ne décrit **pas** l'architecture après migration.
- **Jalon v1.2 du 31/10/2026 :** migration proposée et appliquée localement du routage éditorial vers **Claude Haiku 5.5** en principal et **GPT-4.1 mini** en secours explicite, avec correction de A1 et A2.
- **Preuve d'exécution locale :** 644 tests Vitest réussis dans 53 fichiers ; TypeScript sans erreur affichée ; ESLint ciblé sans diagnostic après formatage ; build Vite client, SSR et Nitro terminé ; `git diff --check` sans diagnostic final. Ces validations portent sur la version locale **après** la migration et la correction des assertions de test.

Les résultats proviennent de journaux locaux transmis par l'équipe, non d'une CI indépendante. Ils ne remplacent pas la revue du diff, les tests avec fournisseur réel ou une recette de production.

### Correspondance avec les anomalies historiques de `main`

La référence historique fait foi pour le registre des anomalies ; les identifiants A1/A2 servent au suivi de ce jalon. Les correspondances ont été vérifiées dans [`docs/11-anomalies-connues.md`](11-anomalies-connues.md) sur `main`.

| Identifiant du jalon | Identifiant historique | Correspondance | Statut |
|---|---|---|---|
| **A1 — Résumés IA hors garde budgétaire** | **P1-03** | **Directe** : améliorations post-collecte et après défusion hors `paidCall()` | Corrigé et testé localement sur mocks ; recette réelle restant à faire |
| **A2 — Fallback HTTP 429 financier ou ambigu** | **Aucun identifiant historique exact** | **Nouveau constat** du routage fournisseur ; ne pas l'assimiler à **P1-05**, qui traite des garde-fous éditoriaux | Corrigé pour les scénarios ciblés et testé sur mocks ; recette réelle restant à faire |

Le registre de la branche de travail classe déjà **P1-03 / A1** et **A2** dans « Corrigées depuis la consolidation ». Cela désigne la **clôture fonctionnelle locale**, pas une homologation de production.

**Hors périmètre de cette clôture :** **A3** prolonge partiellement **P1-11** (opérations non transactionnelles et réservation orpheline) ; **A4** recoupe **P1-11** et le contexte historique de **P2-20** (amélioration antérieure par verrou, sans atomicité transactionnelle démontrée). A3/A4 demeurent **ouverts, non corrigés** et ne doivent pas être comptés comme des anomalies nouvelles indépendantes de ces recouvrements. Aucun rapport de correction A3/A4 n'est déclaré ici.

## 2. Routage des modèles

| Fonction IA identifiée | Modèle prioritaire | Modèle secondaire (conditionnel) | Repli sans IA |
|---|---|---|---|
| Classification FR/EN et importance éditoriale | `claude-haiku-5-5` (Anthropic) | `gpt-4.1-mini` (OpenAI) | Classement lexical / absence d'évaluation IA |
| Résumé des signaux (collecte et défusion) | `claude-haiku-5-5` | `gpt-4.1-mini` | Résumé déterministe |
| Dossier et brouillon d'article | `claude-haiku-5-5` | `gpt-4.1-mini` | Gabarit déterministe |
| Variantes LinkedIn | `claude-haiku-5-5` | `gpt-4.1-mini` | Gabarit déterministe |
| Résumé de newsletter | `claude-haiku-5-5` | `gpt-4.1-mini` | Gabarit déterministe |

**Hors de cette migration :** collecte RSS, Google News et recherche complémentaire Perplexity ; ce dernier est un fournisseur de recherche, et non le modèle de réécriture décrit ci-dessus. Le nom de classe historique `OpenAiEnhancer` subsiste : il ne prouve pas que le modèle principal demeure OpenAI.

Le secours exige `KORA_AI_FALLBACK_ENABLED="true"`, une clé serveur OpenAI et une réserve positive configurée. Sans clé Anthropic, la génération éditoriale conserve le gabarit et **ne bascule pas directement sur OpenAI**. L'activation en environnement réel reste une décision distincte.

## 3. A1 / P1-03 — Appels de résumé hors garde budgétaire

### Anomalie initiale

Les améliorations de résumé exécutées après un lot de collecte (`enhanceSummaries`) et à la défusion d'un signal (`splitSignal`) pouvaient appeler le fournisseur IA sans réservation préalable via `paidCall()`. Le plafond mensuel de KORA ne gouvernait donc pas entièrement ce chemin.

### Correction implémentée localement

- `src/server/services/summary-ai.ts` introduit `improveSummary(ctx, input, base)`, avec garde sur la présence de la clé Anthropic, appel via `paidCall()` (`kind: generation_summary`) et estimation `estimatedTextAiCost(COSTS.summary)`.
- `src/server/services/collection.ts` fait passer les améliorations post-collecte par ce service et conserve les signaux ingérés si la réécriture facultative ou sa persistance échoue.
- `src/server/handlers/signals.ts` fait passer le résumé de défusion par le même service.
- `src/server/adapters/index.ts` retire l'ancien helper de résumé exporté qui permettait un appel IA sans contexte budgétaire.
- `src/server/services/ai-estimate.ts` prévoit une réserve supplémentaire pour le modèle secondaire lorsqu'il est activé et correctement configuré. Les appels éditoriaux déjà sous `paidCall()` (articles, LinkedIn, newsletter) utilisent cette estimation ajustée.

### Tests et limites

Les quatre tests de `src/test/server/ia-resumes-budget.test.ts` vérifient la réservation et la comptabilisation estimée, le blocage par budget, l'absence de requête sans clé Anthropic et la non-annulation de la collecte après échec de réécriture. **Limite :** `paidCall()` libère encore une réservation lors d'une exception sans enregistrer une tentative de facturation incertaine ; cela relève de **A3**, non couvert par cette clôture. Les coûts sont forfaitaires, et non une garantie de plafond sur facture fournisseur (**A5**).

**État A1 :** chemin de résumé local corrigé et testé sur mocks ; clôture **fonctionnelle locale uniquement**, sous réserve de revue et de recette.

## 4. A2 — Repli abusif lors d'un HTTP 429 (sans équivalence historique exacte)

### Anomalie initiale

Une réponse 429 Anthropic portant `rate_limit_error` pouvait déclencher un second appel payant OpenAI, même si ses détails désignaient un plafond de dépense (par exemple `details.error_code = enforced_spend_limit_reached`).

### Correction implémentée localement

- `src/server/adapters/classification-providers.ts` applique une politique **fail-closed** : un 429 ambigu, sans code transitoire explicite, ne déclenche plus le secours.
- Les indices de blocage financier (`spend`, `credit`, `billing`, `payment`, `balance`, `budget`, `exhausted`, etc.) empêchent le repli en présence des codes examinés.
- Le chemin de génération éditoriale dans `src/server/adapters/openai.ts` réutilise la même règle de décision.
- Le modèle de secours devient `gpt-4.1-mini` à la place de `gpt-4o-mini`.
- Le repli demeure conditionné par un drapeau explicite, les credentials et l'estimation budgétaire. Les erreurs 408 et 5xx restent traitées comme transitoires par la logique locale actuelle.

### Tests et limites

Les tests de `ia-fallback.test.ts` et `ia-haiku-editorial.test.ts` couvrent notamment la priorité du modèle principal, le 429 ambigu, le 429 marqué financier, le 429 explicitement temporaire et le repli après 503, à l'aide de `fetch` simulé. **Limite :** cette politique repose sur les champs d'erreur interprétés par le code et n'a pas été éprouvée contre tous les formats d'erreurs réels des fournisseurs. Les erreurs de réponse et les contrats d'API réels restent à vérifier.

**État A2 :** contournement budgétaire par les scénarios 429 ciblés bloqué et testé sur mocks ; clôture **fonctionnelle locale uniquement**, sous réserve de recette API.

## 5. Validations reproductibles

| Vérification du 31/10/2026 | Résultat observé | Limite de la preuve |
|---|---|---|
| `bunx vitest run` | **644/644 tests**, **53/53 fichiers** réussis | Tests locaux et mocks ; pas de requêtes fournisseur réelles |
| `bunx tsc --noEmit -p .` | Aucune erreur rapportée dans la sortie combinée | Ne démontre ni la sécurité runtime ni le contrat réseau réel |
| ESLint ciblé sur les fichiers IA, handlers et tests | Aucune erreur rapportée après Prettier | Pas nécessairement un lint exhaustif de tout le dépôt |
| `bun run build` | Client, SSR et Nitro construits | Pas de vérification du comportement en production |
| `git diff --check` | Aucune anomalie affichée lors de la validation finale | Aucun contrôle indépendant du diff complet |

Le passage initial montrait deux tests échoués parce qu'ils comptaient les entrées `generation_summary` déjà présentes dans le jeu de données ; leurs assertions ont été corrigées pour comparer les nouvelles entrées produites par l'exécution. Une première exécution ESLint montrait 39 erreurs de formatage ; elles ont été corrigées avant l'exécution finale. Ces corrections sont documentées pour préserver l'historique de validation.

## 6. Risques résiduels et critères de clôture

| Identifiant | État au 31/10/2026 | Critère avant production |
|---|---|---|
| **A3 — Tentatives payantes en exception** | **Ouvert** | Journal de tentative durable avec état de facturation inconnue, prévention du double comptage, rapprochement fournisseur |
| **A4 — Concurrence / expiration des réservations** | **Ouvert** | Tests de timeout, arrêt/annulation et lot concurrent ; réservations récupérables sans sous-estimer l'exposition |
| **A5 — Coût estimé vs facture réelle** | **Ouvert** | Séparer métriques estimatives, usage fournisseur et montants facturés ; documenter devises et sources de prix |
| **A6 — Validation des réponses externes** | **À auditer** | Schéma d'entrée/sortie exhaustif et erreurs expurgées ; scénarios JSON malformé et réponse tronquée |
| **A7 — Configuration historique** | **À nettoyer** | Retirer les mentions OpenRouter devenues inactives après inventaire des usages |
| **A8 — Cohérence documentaire** | **En cours** | Revue du présent jalon et alignement du README/de la configuration d'exploitation avant fusion |

**Bloquants de production :** A3/A4 et recette réelle des API avec des requêtes bornées et autorisées ; vérification des données sensibles, des plafonds fournisseurs et de l'absence de secrets dans les commits. Une CI verte ne constitue pas une homologation.

## 7. Configuration et exploitation

| Variable | Rôle | Exigence |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clé serveur pour Haiku principal | Secret serveur ; jamais commité ni journalisé |
| `AI_API_KEY` | Clé serveur pour GPT-4.1 mini | Secret serveur ; pas de secours par défaut |
| `KORA_AI_FALLBACK_ENABLED` | Active explicitement le secours si `"true"` | Laisser à `false` jusqu'à approbation |
| `KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL` | Majoration estimative pour la tentative secondaire | Valeur finie et strictement positive si le secours est configuré ; **pas** une mesure de facturation |

Les prompts considèrent les textes collectés comme des données non fiables. Les protections existantes des marqueurs `[À vérifier]` et de la section `Sources consultées` doivent être conservées dans les réécritures. Aucun secret ni contenu utilisateur sensible ne doit être écrit dans les journaux d'erreur.

## 8. Références du dépôt

- Historique : [`2026-10-30-jalon-classification-multilingue-v1.1.md`](2026-10-30-jalon-classification-multilingue-v1.1.md).
- Architecture : [`02-architecture.md`](02-architecture.md).
- Registre des anomalies : [`11-anomalies-connues.md`](11-anomalies-connues.md).
- Code : `src/server/adapters/classification-providers.ts`, `src/server/adapters/openai.ts`, `src/server/services/summary-ai.ts`, `src/server/services/ai-estimate.ts`, `src/server/services/collection.ts`, `src/server/handlers/signals.ts`, `src/server/services/usage.ts`.
- Tests : `src/test/server/ia-fallback.test.ts`, `src/test/server/ia-haiku-editorial.test.ts`, `src/test/server/ia-resumes-budget.test.ts`.

**Changement documenté, non déployé.** Aucune fusion dans `main` n'est couverte par ce document.


## Addendum du 01/11/2026 — A3

La mention « A3 ouvert » ci-dessus décrit la situation au 31 octobre et demeure une **information historique**. Le correctif A3/P1-11 a depuis été implémenté et publié sur `fix/kora-a3-tracabilite-appels-payants`, commit de référence `2a5c1b3`, avec conservation des réservations inconnues, journalisation des dépassements (`0005`) et réconciliation DBA (`0004`). 664 tests Vitest réussis localement ; tests SQL isolés et lecture réelle PostgreSQL locale réussis. Des jobs GitHub Actions et un banc de mutation isolé sont ajoutés et restent à confirmer par leurs exécutions. Les risques A4/A5 et la validation production restent ouverts. Voir [le rapport A3](2026-11-01-a3-p1-11-validation.md).
