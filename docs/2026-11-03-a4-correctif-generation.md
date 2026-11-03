# A4 — Protection durable de la génération d'article

Implémentation sur `fix/kora-a4-concurrence-reprise`, à partir de `8b595cdaac3954609f738b2eab80bc5dcfacd0c7`.
Les preuves avant correction restent dans [la synthèse initiale](2026-11-03-a4-resultats-avant-correctif.md) et dans l'historique, notamment `2ce07f9`.

## Comportement

La création d'article depuis un signal conserve le verrou court existant, mais sa sûreté ne dépend plus de son TTL. La migration additive `0008_kora_article_generations.sql` ajoute une propriété durable par signal, un jeton aléatoire et le lien vers la tentative financière A3.

- La prise de propriété et la réservation budgétaire sont une seule transaction. Un refus budgétaire ne crée ni propriété ni tentative payante.
- Le passage en cours et le démarrage de la tentative financière sont atomiques, avant l'appel fournisseur.
- Une seconde clé HTTP pour le même signal reçoit `409 generation_unresolved` si une génération demeure réservée, en cours ou incertaine, même après expiration du verrou ou redémarrage.
- La finalisation vérifie le jeton et le signal initial, puis crée l'article, lie le signal et termine la génération dans une seule transaction. Un signal modifié entre-temps provoque un refus sans article partiel.
- Rejouer exactement cette finalisation est sans effet après succès. Le dépôt réessaie une fois pour récupérer une réponse perdue sans rappeler le fournisseur ni écraser une modification ultérieure de l'article.
- Un déclencheur protège le lien terminé contre une ancienne écriture du signal et sérialise les nouveaux articles associés au même signal pour refuser les doublons.
- La table n'est pas modifiable directement par `service_role`. Les transitions passent par des fonctions SQL dédiées ; elles ne sont pas accessibles aux rôles `anon` et `authenticated`.

## Crash et limites de reprise

Après un crash pendant l'appel, la génération demeure durablement bloquée et la réserve financière A3 est conservée. Un réessai avec une nouvelle clé ne relance pas l'appel. Un simple TTL, un redémarrage ou un échec réseau ne constituent jamais une preuve que le fournisseur n'a rien traité.

Cette version ne crée pas de reprise administrative automatique ni d'écran de rapprochement. Une génération interrompue, même avant l'envoi si la confirmation est ambiguë, peut nécessiter une vérification manuelle. Ne pas supprimer sa ligne pour réessayer : cela annulerait la protection. Le rapprochement financier A3 ne libère pas à lui seul la propriété A4. La récupération d'un contenu perdu entre réponse fournisseur et sauvegarde reste à traiter séparément.

La portée est la création d'article depuis un signal. Les autres opérations utilisant des verrous ne reçoivent pas toutes une protection durable dans ce commit. Les verrous génériques peuvent toujours expirer : les tests de caractérisation correspondants sont conservés.

Les doublons historiques ne sont pas supprimés. Cette migration ne reconstitue pas le signal d'une ancienne tentative A3 qui ne stockait pas ce lien. Avant un éventuel déploiement, arrêter les anciens processus de génération et examiner les tentatives antérieures non résolues ; appliquer la migration avant le nouveau serveur. Aucune migration de production n'a été exécutée dans ce travail.

## Vérifications exécutées le 3 novembre 2026

Sur l'environnement de travail, avec fournisseur simulé :

| Vérification                                                                      | Résultat observé                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Suite Vitest complète                                                             | 57 fichiers, 679 tests réussis, dont 5 nouveaux tests A4 |
| TypeScript application et banc d'intégration                                      | Réussi                                                   |
| ESLint global                                                                     | 0 erreur, 6 avertissements React Refresh préexistants    |
| Build Vite                                                                        | Réussi                                                   |
| Syntaxe Bash du script isolé                                                      | Réussie                                                  |
| Migrations 0000, 0002 à 0008 et assertions A4 dans PGlite, moteur PostgreSQL WASM | Réussies                                                 |

Le contrôle SQL exécute `tests/integration/a3/article-generations.sql` : refus budgétaire, propriété exclusive, mauvais jeton, conflit de signal, échec injecté entre l'insertion de l'article et l'écriture du signal, annulation transactionnelle, rejeu exact, réserve inconnue conservée et permissions. Les principales transitions sont aussi exécutées sous `service_role`. Les données de test sont annulées par `ROLLBACK`.

PGlite ne remplace pas le banc Docker/PostgREST : ce dernier n'a pas été exécuté dans cet environnement, où Docker n'est pas disponible. Ses résultats après correction sont **à recueillir**, pas réputés acquis.

## Exécution sur le Mac

Depuis le worktree A4 propre, après récupération du commit de correction :

```bash
bun install --frozen-lockfile
bunx vitest run
bunx tsc --noEmit
bun run lint
bun --no-env-file run build
env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY \
  -u ANTHROPIC_API_KEY -u AI_API_KEY -u PERPLEXITY_API_KEY \
  -u LOVABLE_DB_MIGRATION_URL bash scripts/test-a3-postgres.sh
```

Le script Docker applique désormais 0008 et les assertions SQL A4. Il conserve les contrôles A3 et vérifie le crash avec la même clé puis avec une nouvelle clé après libération du verrou. Le test d'expiration à deux clés exige `providerCalls: 1`, `statuses: [201, 409]` et `articles: 1`. Le fournisseur est local et fictif.

Le script affiche toujours le résultat du nettoyage et retourne une erreur si des conteneurs, réseaux ou volumes de son projet temporaire subsistent. Conserver le journal complet et le SHA du commit exécuté, puis ajouter une synthèse datée des résultats observés à cette branche.
