# A4 — Résultats des tests avant correctif

Date de l'exécution : 3 novembre 2026. Ces résultats proviennent des journaux d'exécution transmis par Aya ; ils ne constituent pas une validation indépendante de la production.

## Référence et environnement

- Branche : `fix/kora-a4-concurrence-reprise`.
- Dernière exécution du banc PostgreSQL : commit [2ce07f9](https://github.com/Makk7709/koraino/commit/2ce07f91cf773fa7fa21b60ac96a9a5b370d65ce). Ce commit conserve les tests de caractérisation avant correction.
- Exécution sur Mac, avec PostgreSQL et PostgREST jetables sous Docker ; serveur HTTP KORA en processus séparé et fournisseur IA fictif local pour les scénarios système. Aucun fournisseur payant réel n'a été appelé.
- Commande du banc : `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u ANTHROPIC_API_KEY -u AI_API_KEY -u PERPLEXITY_API_KEY -u LOVABLE_DB_MIGRATION_URL bash scripts/test-a3-postgres.sh`.
- Le test mémoire a été exécuté séparément au commit `c5cfdd3` : `bunx vitest run src/test/server/locks-a4-characterisation.test.ts`.

## Trois scénarios A4

### 1. Expiration du verrou et ancien détenteur

Le test mémoire a réussi sur `c5cfdd3` : après expiration, un second détenteur a acquis le verrou alors que le premier n'avait pas terminé. La libération par le premier ne supprime pas le verrou du second.

Le test du dépôt PostgreSQL/PostgREST, exécuté notamment sur `2ce07f9`, rapporte `reacquiredAfterExpiry: true` et `staleReleasePreservedNewLock: true`. L'expiration est simulée par l'horloge du processus de test ; ce scénario seul ne démontre pas un double appel fournisseur.

### 2. Crash pendant l'appel fournisseur

Le banc HTTP arrête le processus KORA alors qu'un fournisseur fictif maintient sa réponse en attente. Après redémarrage, un réessai avec la même clé HTTP reçoit 409 sans nouvel appel fournisseur. Le journal indique un appel fictif, l'état HTTP `pending` et une réserve conservée.

Ce test ne vérifie pas la résolution administrative du `pending`, ni le comportement avec une clé différente après crash.

### 3. Deux clés pour un même signal après expiration

Le banc maintient la première génération en attente, force l'expiration de son verrou dans la base jetable, puis envoie une seconde demande avec une autre clé d'idempotence. Journal observé :

- appels au fournisseur fictif : **2** ;
- réponses HTTP : **201, 201** ;
- articles créés pour le même signal : **2**.

Ce résultat démontre la reproduction du doublon dans ces conditions de test. Il ne prouve pas qu'un incident ou une double facturation s'est produit en production.

## Autres résultats et nettoyage

Sur `2ce07f9`, les scénarios A3.1 de perte de réponse et de redémarrage après finalisation ont signalé leur réussite. Le script a affiché que le projet Docker temporaire ne conservait aucun conteneur, réseau ni volume.

Les tests A4 ci-dessus sont des **tests de caractérisation** : leur succès confirme le comportement observé, et ne valide pas une protection contre le doublon. Le futur correctif devra remplacer ou compléter ces assertions par des tests exigeant notamment un seul appel fournisseur et un seul article, puis relancer les contrôles de crash, de concurrence et de persistance. Le traitement des opérations incertaines et une revue indépendante restent à réaliser.
