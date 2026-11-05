# KORA — Revue finale A4.3 / A4.3.4 / A4.3.5 — dossier de décision (PR en brouillon)

**Date :** 2026-11-03 ; revue actualisée 2026-11-05  
**Branche source :** `fix/kora-a4-3-recuperation-admin`  
**Base de revue :** `fix/kora-a4-2-fusion-defusion` (commit initial vérifié : `14dd27d941396156dfa67381b9740f077273c079`)  
**Périmètre :** migrations `0010` à `0013`, application, sécurité des rôles, récupérations DBA, tests et compatibilité historique.  
**Décision :** **REVIEW ONLY / NO MERGE / NO PRODUCTION DEPLOYMENT** jusqu'à levée documentée des blocages.

## 1. Traçabilité et éléments vérifiés

- Sur la branche A4.3, la CI a exécuté 686 tests Vitest (59 fichiers), TypeScript, ESLint (0 erreur, 6 avertissements) et build ; PostgreSQL 16.6/PostgREST v14.18 jetables ont passé les tests A3/A4/A4.2/A4.3/A4.3.4 au commit `5aac2dbb714cc55ba9a95af23d85c6e7856aa85d`.
- L'exécution locale sur Mac de ces scénarios a été rapportée, avec nettoyage Docker ; elle ne démontre pas la conformité d'une base de production.
- Un second banc isolé, construit de 0000 à 0009 puis alimenté d'enregistrements **synthétiques** (un A4 réservé et un A4 terminé, budget A3, HTTP pending, article, audit, usage), vérifie les migrations de 0010 à 0013 sans réécriture d'historique. Fichiers : `historical-fixture-seed.sql`, `historical-migration-verify.sql`, `scripts/test-a3-postgres.sh`. Ce banc est une **répétition de schéma**, pas une preuve de compatibilité avec les données d'exploitation.
- Une empreinte MD5 sert uniquement à comparer les lignes synthétiques `kora_records` et `kora_settings` avant et après la migration, **pas** à protéger des preuves réelles contre la falsification.
- A4.3.5 (2026-11-05) : le commit `0c0ede7f889a554f244295f023e29b627a309fd7` a passé les jobs GitHub Actions `quality` et `isolated-postgres` ([run #42041497595](https://github.com/Makk7709/koraino/actions/runs/42041497595)). Cette preuve concerne ce commit et doit être renouvelée pour chaque SHA ultérieur.
- Sur Supabase **local** PostgreSQL 17.11, l'opérateur a confirmé l'application de `0013` (`REVOKE`) et l'inventaire `service_role` suivant : exécution de `kora_article_generation_reserve(uuid,jsonb,jsonb)` = `false`, `reserve_linked(uuid,jsonb,jsonb,text)` = `true`. Les permissions locales n'établissent pas la conformité Cloud.
- Une sauvegarde locale préalable à `0013` a été créée et son catalogue `pg_restore --list` a été lu ; **aucun essai de restauration complète n'a été fait**.

## 2. Revue migration par migration

| Migration | Modifications vérifiées dans le dépôt | Risques / critères de revue |
|---|---|---|
| **0010** | Ajoute `kora_article_generation_recoveries`, colonne `kora_article_generations.http_operation_id UNIQUE`, réservations liées HTTP, clôture DBA et récupération d'une réponse HTTP terminée | `ALTER TABLE ... ADD COLUMN ... UNIQUE` prend des verrous DDL ; anciennes générations sans liaison restent `NULL` et ne doivent **jamais** être reliées par supposition ; états HTTP anciens `pending/uncertain` à inventorier |
| **0011** | Révoque les grants génériques, protège les collections financières/HTTP par trigger `SECURITY INVOKER`, élève des RPC métier en `SECURITY DEFINER` appartenant à `postgres`, borne `lock_timeout` et `statement_timeout` | Attente stricte de propriétaires `postgres`, absence d'héritage de droits dangereux, privilèges de colonnes et absence de CREATE public. Les changements de rôles/fonctions peuvent casser du code déployé ailleurs ou des scripts manuels |
| **0012** | Refuse `kora_paid_finish(...,'not_sent')` pour une tentative conservant une propriété A4 | Une ancienne génération A4 réservée reste verrouillée et exige récupération DBA contrôlée ; aucune suppression ou réconciliation silencieuse ; compatibilité à vérifier avec les anciennes requêtes/applications |
| **0013** | Révoque `EXECUTE` sur l'ancienne RPC de réservation A4 non liée pour `service_role` et les rôles publics ; l'adaptateur PostgreSQL refuse également `reserve()` sans liaison HTTP | Préserver l'appel interne `SECURITY DEFINER` de `reserve_linked()` ; tester les droits, les réservations liées, les tests historiques et la cohérence avec `meta/_journal.json` |

**Important :** la migration `0010` est additive pour les enregistrements, mais le caractère additif n'implique pas un déploiement sans verrou ni sans interruption. La migration `0011` modifie significativement le modèle d'autorisations.

## 3. Préflight d'une COPIE représentative — zéro écriture

Le fichier `scripts/a43-preflight-readonly.sql` exécute `BEGIN READ ONLY`, `statement_timeout=15s`, `lock_timeout=3s`. Il inventorie :

- version, rôles, propriétaires, privilèges effectifs, héritages pertinents, RLS/BYPASSRLS et droit CREATE sur `public` ;
- fonctions `kora_*`, propriétaires, attributs `SECURITY DEFINER`, paramètres et EXECUTE pour les rôles applicatifs ;
- volumes et états A3/HTTP, structure des paramètres et écarts de formes JSON, colonnes A4 et triggers, **sans retourner de lignes métier ni de secrets**.

Exécution **uniquement sur une copie isolée, approuvée et sans connexion d'écriture de production** : dans une session `psql` déjà connectée à cette copie, exécuter `\i scripts/a43-preflight-readonly.sql`, ou utiliser le chemin absolu. Vérifier visuellement la cible (`current_database()`, hôte, projet Supabase) et les autorisations avant toute opération.

**Ne pas passer de chaîne de connexion, jeton ou mot de passe dans les logs de PR.** Archiver un rapport expurgé des identifiants et des volumes sensibles. Ce script ne vaut pas certification automatique : un DBA doit lire et interpréter chaque différence.

## 4. Critères bloquants pour envisager une approbation de fusion / déploiement

- [ ] Confirmer la **base cible exacte** et la chaîne de déploiement Lovable/Supabase, ainsi que la chaîne de dépendance des branches A3 → A4 → A4.2 → A4.3. Ne pas fusionner A4.3 directement dans `main` tant que ses migrations parentes ne sont pas présentes.
- [ ] Sauvegarde cohérente et **restauration vérifiée** sur une copie isolée ; établir le point de restauration et conserver la version d'application correspondante. Aucun secret dans le dépôt.
- [ ] Préflight `READ ONLY` sur copie **représentative et récente**, avant migration ; contrôle des rôles réels, propriétaires de tables et fonctions, privilèges hérités/sur colonnes, extensions, objets non versionnés, permissions des services tiers.
- [ ] Identifier les anciens `paid_attempts` et `http_idempotency` à état incertain, les générations A4 sans `http_operation_id`, les anomalies des JSON et les réserves financières inexpliquées ; définir une résolution humaine pour chaque exception, sans déclencher de second appel IA.
- [ ] Répéter `0010` → `0011` → `0012` → `0013` **dans l'ordre, en transactions atomiques**, sur copie historique ; contrôler différences avant/après sur lignes A3/HTTP, liens A4, `reservedEur`, `usage`, `audit`, articles et archives. Lancer des tests runtime sur la copie autorisée.
- [ ] Mesurer les temps de migration/attente de verrous, recenser les sessions longues et prévoir une fenêtre d'interruption courte avec écritures applicatives suspendues. Déterminer les `lock_timeout` de migration explicites, hors fonctions.
- [ ] Valider l'application mise à jour avec les nouvelles ACL (incluant `ensureReady` via RPC), le mode de connexion, le rollback applicatif compatible et les intégrations ; pas de clients avec droits implicites `service_role` supposés.
- [ ] Revue indépendante des fonctions `SECURITY DEFINER`, du trigger sur collections mixtes, des limites de `service_role` compromis et des chemins DBA (identité opérateur, preuve fournisseur, validation à deux).
- [ ] Capturer SHA des commits, journaux de migration, résultats tests, changements de grants, approbations et date de sauvegarde. Ne pas poster de JWT, DSN ou pièces fournisseur sensibles dans GitHub.
- [ ] Accord écrit du responsable applicatif et du DBA sur le plan de retour arrière et les critères de STOP/GO.

## 5. Plan de retour arrière — scénario opérationnel, non exécutable automatiquement

**Avant toute migration :** figer les écritures métier et appels IA, obtenir une sauvegarde validée (base ET données/objets connexes nécessaires), puis **tester sa restauration** dans un espace isolé. Capturer les permissions et définitions des fonctions avant modification. Préparer la version applicative précédente, mais ne pas la redémarrer automatiquement contre le schéma durci.

**Échec pendant une migration atomique :** constater l'annulation de la transaction, ne pas lancer la suivante, conserver les logs, vérifier état du schéma, données et permissions avant toute réouverture. Les quatre migrations sont successives : une transaction déjà validée avant l'échec d'une autre ne sera pas annulée rétroactivement.

**Échec après application partielle de la série ou après mise en service :** STOP écriture/appels payants ; isoler les requêtes in-flight et les états incertains. Évaluer avec le DBA une restauration coordonnée de la sauvegarde et de la version applicative, sur une **copie d'abord**. Si des écritures ont eu lieu après le point de sauvegarde, documenter la perte potentielle/stratégie PITR validée avant de restaurer ; ne jamais écraser ces données par une simple commande de rollback.

**Ne pas réaccorder `GRANT ALL` à `service_role`, ne pas désactiver les triggers de sûreté, ne pas supprimer les archives A4.3, ne pas purger une tentative `unknown`, ne pas retraiter un appel IA incertain** au seul motif d'un incident de déploiement.

**Critères de réouverture :** état financier rapproché, A4/HTTP cohérents, permissions conformes, tests de récupération et de concurrence réussis, application et opérateurs vérifiés.

## 6. Hors périmètre / incertitudes explicites

- **Aucun accès ni audit de base Cloud/production ou de copie représentative de production** n'a été réalisé lors de la préparation de ce dossier. Des contrôles ont été effectués sur Supabase local ; ils ne démontrent ni les données anciennes Cloud, ni ses ACL.
- Les scénarios d'historique synthétique ne prouvent pas qu'une ancienne base Lovable possède les mêmes extensions, rôles, migrations, propriétaires ou conventions JSON.
- L'historique sans lien HTTP ne peut pas être réparé de manière automatique fiable. Les preuves de facturation et les états d'exécution fournisseur doivent être vérifiés indépendamment.
- Les fonctions DBA restent dépendantes du rôle `postgres` et des preuves fournies ; une validation à deux et un référentiel externe de preuves sont à définir.
- Les tests PostgreSQL du dépôt ne couvrent pas exhaustivement tous les interleavings sous charge ni l'ensemble des objets ajoutés manuellement sur une base existante.

**Décision de revue proposée :** après CI verte sur le dernier SHA, la PR peut passer de **Draft** à **Ready for review** pour solliciter une revue indépendante ; ce geste **n'autorise ni fusion, ni migration Cloud, ni déploiement production**. Les critères bloquants ci-dessus restent exigés avant approbation de fusion/déploiement.
