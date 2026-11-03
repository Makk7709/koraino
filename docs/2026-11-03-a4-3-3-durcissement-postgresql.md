# A4.3.3 — Durcissement PostgreSQL

Branche : `fix/kora-a4-3-recuperation-admin`. Base inspectée :
`38039f950e3df6ceff0d53abbe0c8b7dc212bd45`. Migration additive : `0011`.
Périmètre : code du dépôt et bases jetables. Aucune inspection ni modification de la base de production.

## Défauts démontrés avant correction

`permissions-characterization.sql`, exécuté après 0010 et avant 0011, reproduit :

- les écritures directes de `service_role` dans les tentatives financières, les paramètres budgétaires et les opérations HTTP ;
- le droit `TRUNCATE` hérité du `GRANT ALL` de 0000 ;
- la libération d'une réservation `unknown` par `kora_paid_finish(id, '[]', NULL)` :
  les anciennes conditions `NOT IN` / comparaisons ordinaires ne refusaient pas SQL NULL.

Ces manipulations sont annulées par `ROLLBACK`. Elles prouvent une possibilité dans le schéma reconstruit,
pas un incident ni une exploitation en production.

## Protection retenue

| Objet | Accès de service_role après 0011 |
|---|---|
| kora_records, données métier ordinaires | SELECT et DML conservés ; identité collection/id immuable en modification directe |
| paid_attempts et http_idempotency | Lecture conservée ; écritures par les seules fonctions SQL contrôlées |
| usage | Ajout direct limité aux compteurs à coût nul hors identifiants réservés ; aucune modification/suppression directe |
| audit | Ajout applicatif conservé ; aucune modification/suppression directe ni insertion des événements réservés à la récupération |
| kora_settings | SELECT ; initialisation et modification par fonctions dédiées |
| kora_article_generations | SELECT ; transitions par fonctions A4 existantes |
| kora_article_generation_recoveries | Aucun accès applicatif, y compris lecture |
| TRUNCATE, TRIGGER, REFERENCES sur ces tables | Révoqués |
| Création d'objets dans public | Révoquée aux rôles applicatifs et à PUBLIC |

`service_role` conserve BYPASSRLS. Le contrôle des collections mixtes utilise donc un trigger
**SECURITY INVOKER**, qui contrôle `current_user`, et non une politique RLS contournable par ce rôle.
Il ne fait confiance ni aux claims JWT ni à une variable de session. Les refus du trigger produisent
un événement PostgreSQL structuré `kora.postgres.protected_write_denied`, sans contenu métier ni secret.
Les refus par ACL restent des erreurs PostgreSQL `42501`.

Les fonctions financières et HTTP ciblées passent en **SECURITY DEFINER**, propriétaire `postgres`,
avec SQL statique qualifié, `search_path` vide, `lock_timeout=3s`, `statement_timeout=15s`,
EXECUTE accordé à `service_role` uniquement parmi les rôles applicatifs.
Les fonctions DBA de rapprochement/récupération restent **SECURITY INVOKER**, sans EXECUTE applicatif.
Le contrôle d'accès et la validation SQL restent nécessaires même si l'appelant TypeScript utilise Zod.

La migration refuse une hiérarchie de rôles dangereuse, un propriétaire de table inattendu,
ou des droits hérités/sur colonnes qui empêcheraient de garantir cette séparation.
L'inventaire SQL `permissions-audit.sql` expose les propriétaires, privilèges effectifs, RLS,
modes de sécurité, chemins de recherche et timeouts des fonctions sur la base jetable.

## Validations et compatibilité

- Rejet explicite des statuts/codes NULL ; contrôle des champs obligatoires, types JSON,
  précision monétaire, dates et cohérence du mois des lignes de consommation.
- Une tentative `unknown` ne peut plus être clôturée par le contournement NULL démontré.
- `kora_settings_initialize` initialise une seule fois par `ON CONFLICT DO NOTHING`.
  Un nouvel appel ne remet à zéro ni les réservations ni les quotas existants.
  Une base sans paramètres mais contenant déjà un registre financier exige une investigation DBA.
- `DbRepository.ensureReady` utilise cette RPC avec un timeout explicite de 10 secondes,
  sans repli sur une écriture directe. Le test applicatif couvre l'échec puis la reprise.
- Un reset de fixture A4 auparavant effectué comme service_role est désormais explicitement DBA.
  Les opérations applicatives du test continuent d'utiliser service_role.
- La mutation atomique A4.2 ne permet plus de fabriquer les événements d'audit réservés à A4.3.

## Preuves et exécution

Le même `scripts/test-a3-postgres.sh` exécute, dans cet ordre :

1. migrations 0000 puis 0002–0010 ;
2. preuve avant correction, avec rollback ;
3. migration 0011 **dans une transaction unique** et inventaire des privilèges ;
4. tests A4.3.3 : DML direct, UPSERT, changement de collection, TRUNCATE, droits DBA,
   désactivation de trigger, variables de session falsifiées, paramètres RPC invalides ;
5. comparaison intégrale des quatre tables après les refus ;
6. écritures métier et transitions financières/HTTP légitimes, puis régressions A3/A4/A4.2/A4.3 ;
7. requêtes réelles PostgREST utilisant le JWT service_role, avec contrôle de `42501` et des états inchangés ;
8. scénarios HTTP de crash/concurrence et nettoyage du projet Docker temporaire.

Les tests SQL locaux ont également été exécutés avec PostgreSQL embarqué via PGlite, dans l'outillage
de travail uniquement (aucune dépendance ajoutée au projet). Cela ne remplace pas le banc natif
PostgreSQL 16/PostgREST de Docker et GitHub Actions. Les résultats CI doivent être associés au SHA exact.

Validation applicative locale : **686 tests Vitest**, typage strict, build et ESLint
(0 erreur, 6 avertissements préexistants). Les tests SQL ont réussi avant/après correction,
ainsi que les régressions de génération, fusion/défusion et récupération administrative.

## Limites et préparation d'un éventuel déploiement

Ce durcissement bloque les contournements directs testés ; il **ne rend pas une clé service_role
compromise inoffensive**. Elle garde accès aux données métier et aux RPC opérationnelles,
dont les modifications de quotas, les déclarations de coûts estimés et les identités/horodatages
fournis par l'application. Ces fonctions ne prouvent pas l'exécution ou la facturation d'un fournisseur.
Les authentifications et autorisations humaines restent du ressort du serveur applicatif.
Une protection contre tout abus d'une clé serveur nécessiterait une séparation supplémentaire
des capacités et une vérification indépendante des éléments fournisseurs.

Le rôle `postgres`, les propriétaires de fonctions, l'outillage de migration et les autres fonctions
SECURITY DEFINER éventuellement présentes dans une base existante font partie du périmètre de confiance.
Le dépôt ne permet pas d'inventorier les objets ajoutés manuellement en production.
Le journal applicatif n'est pas un registre inviolable face à un DBA ; l'archive de récupération reste
la preuve interne réservée au DBA, avec justificatifs externes à vérifier indépendamment.

Avant un déploiement : sauvegarde vérifiée, copie représentative des données historiques,
inventaire des privilèges/objets effectifs, validation des anciens formats et revue du plan de retour arrière.
La migration doit être appliquée atomiquement (transaction du migrateur ou `psql --single-transaction -f`),
pour ne pas exposer transitoirement les nouvelles fonctions avant leurs REVOKE.
L'application mise à jour doit être déployée de manière coordonnée avec 0011 ; un ancien binaire ne sait
plus initialiser un espace neuf par accès direct aux paramètres. Aucun rollback automatique des ACL
ne doit réintroduire le contournement financier.

Les générations réellement incertaines et les générations historiques sans liaison HTTP vérifiable
restent bloquées. Le protocole humain de décision, la vérification des justificatifs et la concurrence DBA
en charge restent des travaux distincts. **Ce jalon ne vaut pas homologation de production.**

Références de comportement PostgreSQL : [privilèges](https://www.postgresql.org/docs/16/ddl-priv.html),
[RLS et BYPASSRLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html),
[sécurité des fonctions](https://www.postgresql.org/docs/16/sql-createfunction.html).
