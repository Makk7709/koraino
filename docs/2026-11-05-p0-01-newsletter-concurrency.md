# P0-01 / P2-54 — concurrence des newsletters

Base de travail : `fix/kora-a4-3-recuperation-admin`, SHA `db82472af90822f77d662d546fdcca4a5783817d`.
Branche dédiée : `fix/kora-p0-01-newsletter-concurrency`. PR dépendante d'A4.3 ; aucune fusion ni migration Cloud autorisée par ce document.

## Défaut reproduit

Avant correction, le test `newsletter-concurrency.test.ts` lance deux modifications du même résumé depuis le même état affiché. Les deux requêtes répondent `200` au lieu de `[200, 409]`. Cette reproduction utilise le routeur réel et le dépôt mémoire ; ce n'est pas une reproduction PostgreSQL de l'ancien code.

## Contrat API et persistance

- `version` reste le numéro éditorial : une modification du contenu l'incrémente et invalide l'approbation.
- `revision` change à chaque écriture, y compris approbation et export. Les lignes historiques sans révision sont lues comme révision `0`, sans réécriture de masse.
- PATCH édition, POST ajout, DELETE retrait, POST approbation et POST consignation d'export exigent `{version, revision}` dans le corps JSON. Un client ancien reçoit `400 validation_error` ; une révision dépassée reçoit `409 version_mismatch`.
- Les commandes serveur « inclure dans la prochaine édition » lisent leur état de départ puis utilisent le même CAS. Il n'y a pas de réapplication silencieuse d'une commande en conflit.
- `commitEdition` est la frontière commune de persistance : création/mutation, audit et éventuelle tentative de publication vont dans `newsletterMutations.commit`.
- La RPC `kora_newsletter_commit` verrouille la ligne PostgreSQL, compare l'intégralité de l'état initial, puis écrit dans une seule transaction. Le verrou consultatif transactionnel utilise la même clé que les mutations de signaux A4.2. Il n'a pas de TTL applicatif.
- L'approbation est revalidée sous verrou avant export. Un index unique impose une tentative par édition/version/canal newsletter. Le rejeu de l'export figé restitue l'état enregistré sans ajouter d'audit ou de tentative.
- Un trigger interdit les écritures directes applicatives sur newsletters et exports newsletter, y compris avec `service_role.BYPASSRLS`. Les RPC s'exécutent sous `postgres`, avec `search_path` vide et délais SQL explicites (verrou : 3 s ; requête : 15 s ; client RPC : 20 s).
- Les fusions de signaux créent désormais une nouvelle version de toute édition touchée et invalident son approbation dans leur transaction existante. Une fusion touchant une édition exportée est refusée pour préserver l'export figé. L'évolution éventuelle des références historiques constitue une décision métier distincte.

## Interface et téléchargements

Le premier changement local conserve l'état sur lequel l'utilisateur a travaillé. Un rafraîchissement distant ne remplace pas ses saisies. Le conflit laisse les textes visibles ; l'utilisateur peut les copier puis abandonner explicitement son brouillon avec « Annuler » pour recharger l'édition.

Les actions d'ajout, retrait, ordre et export sont bloquées tant que le texte local n'est pas enregistré. L'export approuvé est consigné avant le téléchargement ; le lien est lié à la version et à la révision retournées. Un téléchargement obsolète retourne `409` au lieu de servir silencieusement un autre contenu. Les liens de prévisualisation existants sans paramètres restent en lecture seule.

## Tests et limites

- `src/test/server/newsletter-concurrency.test.ts` : éditions concurrentes, saisie obsolète, corps incomplets, décisions concurrentes, invalidation, double export et rejeu, échec de l'audit, expiration du verrou applicatif, contrôle des mutations de signaux.
- `src/test/newsletter-conflict-ui.test.tsx` : conservation des saisies après rafraîchissement et après réponse `409`, transmission de la révision affichée. Tests React/jsdom, pas une recette navigateur avec Supabase Auth.
- `scripts/test-newsletter-postgres.sh` : nouveau projet Docker jetable, migrations jusqu'à `0014`, deux processus KORA sur ports distincts, PostgREST et PostgreSQL réels. Aucun appel fournisseur externe ; identité de démonstration contrôlée.
- Scénarios PostgreSQL : deux résumés, modification/approbation, deux approbations, deux ajouts, ajout/retrait puis reprise explicite, deux exports, index unique, approbation périmée, échec d'audit après les écritures, terminaison de connexion avant COMMIT, lease expiré, mutation de signal, refus des écritures directes et ACL RPC.
- Le crash simulé termine une connexion PostgreSQL contenant une mutation non commitée. Il ne prétend pas couvrir toutes les fenêtres de crash de l'hébergement Nitro ou les fournisseurs IA.
- Un conflit après génération d'un résumé ne rejoue pas automatiquement l'appel payant : le coût déjà engagé reste comptabilisé. Une nouvelle intention explicite peut entraîner un nouvel appel. La propriété durable des générations de résumés reste un sujet distinct.
- La recette navigateur avec deux comptes réels, la migration sur copie représentative et la restauration ne sont pas remplacées par les tests automatisés.

## Déploiement et retour arrière

1. Revoir cette PR et ses branches parentes, puis vérifier la base réellement intégrée. Rejouer les tests après intégration.
2. Sur une copie isolée récente, appliquer `0014` après `0013`. L'index refuse les doublons d'exports historiques : les examiner et les réconcilier manuellement, sans purge automatique. Mesurer les verrous DDL et vérifier les privilèges.
3. Tester sauvegarde et restauration. Déployer migration, API et interface de façon coordonnée : les anciens clients échouent volontairement ; les anciens handlers ne peuvent plus écrire directement.
4. En cas d'incident, suspendre les mutations newsletter. Ne pas supprimer l'index ou le trigger pour faire fonctionner l'ancien code sans décision DBA explicite. Préférer un correctif ou la restauration vérifiée d'une copie cohérente.

## État de validation

Contrôles locaux du 5 novembre 2026, avant publication du correctif :

- Reproduction rouge sur la copie des sources A4.3 `db82472` : le test des deux résumés reçoit `[200, 200]` au lieu de `[200, 409]`.
- TypeScript strict application et banc newsletter : réussite.
- Vitest : **700 tests dans 61 fichiers**, dont 12 tests serveur P0-01 et 2 tests React de conservation des saisies.
- ESLint : aucune erreur ; 6 avertissements Fast Refresh dans des composants UI non modifiés.
- Build Vite/Nitro et `git diff --check` : réussite.
- Parcours HTTP via le serveur Vite réel, en mémoire : création, ajout, modifications concurrentes avec deux identités de démonstration (`200`/`409`), approbation par le validateur, export et téléchargement HTML lié à la version.
- Contrôle SQL complémentaire sous PGlite : migrations `0000`, `0002`–`0014`, CAS, approbation, export unique/rejeu et refus d'écriture directe. **Ce contrôle embarqué ne remplace pas PostgreSQL/PostgREST multi-processus.**

Docker n'est pas disponible dans l'environnement de préparation. Le workflow GitHub Actions exécute le banc Docker jetable avec deux processus applicatifs et des identités distinctes. Les résultats CI sont rattachés au SHA dans la PR. Tant que ce banc n'est pas vert, P0-01 n'est pas déclaré clôturé. La recette navigateur à deux comptes Supabase et la migration sur copie représentative restent distinctes. Aucun déploiement de production effectué.
