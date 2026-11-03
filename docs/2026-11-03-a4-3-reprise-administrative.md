# A4.3.2 — Reprise administrative contrôlée (jalon technique)

Référence : branche `fix/kora-a4-3-recuperation-admin`, base A4.2 `14dd27d`.
Statut : correctif soumis à revue, **non homologué pour la production**.

## Incidents traités

1. **Appel non démarré avec certitude (A4=reserved, A3=reserved)** : après vérification DBA, `kora_article_generation_admin_close_not_sent` clôture l'intention HTTP d'origine, finalise la tentative financière en `not_sent`, libère uniquement sa réserve, écrit une archive de récupération et un audit, puis libère la propriété du signal. L'intention HTTP d'origine devient `closed_not_sent` et ne peut plus être rejouée. Un nouvel appel exige une **nouvelle intention HTTP**, un nouveau contrôle budgétaire et une nouvelle réservation.

2. **Article déjà commité (A4=completed)** : après vérification DBA, `kora_article_generation_admin_recover_http` rattache l'intention HTTP au contenu effectivement enregistré, sans rappel du fournisseur. Le middleware renvoie une représentation **courante** de l'article sous `201` avec `x-kora-idempotency: recovered`. Le contenu n'est pas nécessairement identique octet pour octet à la réponse HTTP d'origine. La requête est contrôlée par identité d'acteur, route, empreinte et permission actuelle d'écriture.

3. **Appel potentiellement démarré, facturation ou résultat incertain** : **aucune libération ni relance automatique**. Même un rapprochement financier `reconciled_not_billed` ne prouve pas que l'appel n'a pas été exécuté. L'état A4 reste protégé.

## Contrôles techniques

- Migration additive `0010_kora_article_recovery.sql` : liaison HTTP → réservation A4 atomique, archive distincte et verrouillée `kora_article_generation_recoveries`, procédures DBA, nouveaux états HTTP terminaux. Les générations antérieures sans `http_operation_id` ne sont **pas** éligibles à une reprise automatique par ces procédures.
- Fonctions de résolution `SECURITY INVOKER`, contrôlant `current_user = 'postgres'`; fonctions non autorisées à `service_role`, `authenticated` ni `anon`.
- Verrouillage des lignes impliquées, transition conditionnelle, audit durable et rollback PostgreSQL en cas de violation. Les règles A3/A4 préexistantes ne sont pas remplacées.
- Justificatif structuré obligatoire : `source`, `reference`, `operator`, `sha256`, `checkedAt`. Le contrôle SQL **vérifie la forme de ces éléments**, pas l'authenticité des pièces. Le DBA doit vérifier indépendamment les éléments et conserver la pièce associée au hash.
- Codes HTTP prévus : `409 idempotency_closed_not_sent` sur l'ancienne clé clôturée ; représentation de l'article retrouvé pour `recovered_completed`.

## Banc de vérification

Les tests sont dans `tests/integration/a3/recovery-characterization.sql`, `tests/integration/a3/recovery-admin.sql` et `src/test/server/a4-3-http-recovery.test.ts`. Le script `scripts/test-a3-postgres.sh` exécute les scénarios sur un projet Docker éphémère, après les migrations 0000 et 0002 à 0011. Les assertions SQL utilisent une transaction `BEGIN ... ROLLBACK`.

Scénarios : rapprochement financier sans libération A4, article terminé avec HTTP pendant, refus des rôles non privilégiés, absence de preuve, refus des appels incertains, rejeu exact et conflit de preuve, tombstone de l'ancienne clé, nouvelle intention explicitement autorisée après clôture prouvée, restauration HTTP sans nouveau fournisseur.

Les résultats GitHub Actions et les résultats locaux doivent être conservés avec le SHA exact avant tout avis de clôture.

## Limites / travaux restants avant tout déploiement

- **A4.3.3** : procédure d'instruction humaine pour `in_flight`, `uncertain` et historique non lié, avec preuve du devenir du résultat fournisseur. Ne pas transformer une simple confirmation `not_billed` en permission de réexécuter.
- **Sécurité base** : le [durcissement A4.3.3](2026-11-03-a4-3-3-durcissement-postgresql.md) ajoute la migration 0011, des protections contre les écritures directes et une validation SQL des transitions. La portée et les limites face à une clé de service compromise y sont précisées. Vérifier la CI du SHA exact et les droits réels sur copie avant homologation.
- Le référentiel de pièces justificatives, la revue à deux personnes, l'identité réelle derrière le compte DBA, le rapprochement avec le fournisseur, et les tests de concurrence DBA sous charge ne sont pas encore homologués.
- Vérifier les migrations et les données anciennes sur copie, prendre sauvegarde et établir une procédure de retour arrière **avant toute opération réelle**.
- Aucun test ou déploiement de la base de production n'est couvert par ce jalon.
