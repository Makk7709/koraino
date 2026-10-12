# Couverture du cahier des charges

**Objet.** Relier chaque exigence de la proposition commerciale et technique *KORA Newsroom IA — Inovallée, v2.0 du 8 septembre 2026* à ce qui existe dans le code, avec un statut honnête, puis lister le travail restant avant production. Public : chef de projet, ingénieurs, et préparation de la recette (épreuves R01 à R13).

Le cahier des charges précise lui-même (§2 et §14) qu'« inclus » désigne un engagement de réalisation et non une validation obtenue. Ce document suit la même logique : un statut « fait » signifie que la fonctionnalité existe et est couverte par des tests automatiques sur les données de démonstration, pas que l'épreuve de recette correspondante a été passée avec les données réelles d'Inovallée.

## Légende des statuts

| Statut | Signification |
|---|---|
| **Fait** | Implémenté de bout en bout (API, interface, tests). |
| **Simulé** | Le parcours complet fonctionne, mais le service tiers est remplacé par un adaptateur simulé (WordPress). |
| **Partiel** | Une partie de l'exigence est implémentée ; le manque est décrit dans la colonne de droite. |
| **Non fait** | Absent du code. |
| **Hors périmètre** | Exclu par le cahier des charges lui-même. |

## §3 — Détecter, qualifier, justifier

| Exigence | Implémentation | Statut | Remarques |
|---|---|---|---|
| 3.1 Registre des entreprises : raison sociale, alias, domaine officiel, secteur, territoire, priorités, sources rattachées | Écran Entreprises ; `/api/companies` ; [`handlers/registry.ts`](../src/server/handlers/registry.ts) | Fait | Quota de 150 entreprises appliqué ; domaine officiel filtré contre les adresses internes. |
| 3.1 Source : type, URL, fréquence, statut d'accès, dernière réussite, motif d'échec | Écran Veille, onglet « Registre des sources » ; `/api/sources` | Fait | Six types : site officiel, actualités, communiqués, RSS, recherche web, import de newsletter. |
| 3.1 Collecte des sites, pages d'actualités, communiqués, flux RSS et recherche web | `RealCollector` ([`collector.ts`](../src/server/adapters/collector.ts)) : flux RSS et Atom (découverts dans la page au besoin), Google News RSS comme recherche web ; une source Google News créée automatiquement pour chaque nouvelle entreprise | Partiel | Les pages sans flux ne sont pas lues (collecte réussie avec zéro publication) ; seules les 3 publications les plus récentes sont retenues par source et par exécution ; pas de fournisseur de recherche au sens du §5 (Google News uniquement). Voir [Architecture](02-architecture.md#brancher-un-vrai-fournisseur). |
| 3.1 Aucun contournement d'accès | Filtrage des URL ([`domain/security.ts`](../src/server/domain/security.ts)) ; user-agent identifié `KORA-Newsroom/1.0` | Partiel | Pas de contournement de protection ni de connexion à une boîte mail. Les redirections et l'URL de flux découverte dans une page ne sont pas revalidées ; `robots.txt` n'est pas consulté. Le flux Google News, utilisé pour chaque entreprise, est réservé par ses conditions à un usage personnel et non commercial (voir [P1-12](11-anomalies-connues.md#p1--avant-toute-ouverture-à-des-utilisateurs-réels)). |
| 3.2 Date de collecte, de publication et d'événement ; « Date inconnue » affichée comme telle | Observations et signaux ; `formatDate` ([`labels.ts`](../src/components/kora/labels.ts)) | Fait | Testé : une date inconnue reste `null`, jamais inventée. |
| 3.2 Rapprochement des alias, regroupement des sources d'un même événement | [`domain/clustering.ts`](../src/server/domain/clustering.ts), [`services/collection.ts`](../src/server/services/collection.ts) | Fait | Rattachement de confiance inférieure à 60 laissé « à rattacher ». |
| 3.2 Homonymies et fusions incertaines soumises à revue ; regroupement réversible | Fusion et défusion (`/api/signals/:id/merge`, `/split`) ; panneau de revue de l'écran Signaux | Fait | Fusion interdite entre entreprises différentes. |
| 3.2 Taxonomie : financement, acquisition, contrat, partenariat, innovation, produit, brevet, recrutement, croissance, international, distinction, recherche | Type `Category` ([`types.ts`](../src/lib/api/types.ts)) | Fait | Les douze catégories exactes. |
| 3.2 Tableau de bord distinguant nouveautés, surveillés, rejetés, traités | Dashboard et onglets de statut de l'écran Signaux | Fait | Six statuts : nouveau, à traiter, en revue, surveillé, traité, rejeté. |
| 3.3 Score 0–100, grille pondérée à cinq critères, poids, sous-notes et motifs consultables et versionnés | [`domain/scoring.ts`](../src/server/domain/scoring.ts) ; Paramètres, onglet « Grille de score » ; détail du score dans l'écran Signaux | Fait | Affiché sur 10 dans l'interface. |
| 3.3 Somme des poids = 100 % ; un changement de grille ne réécrit pas les décisions historiques | Validation des poids ; recalcul limité aux signaux non décidés | Fait | Testé. |
| 3.3 Indicateur documentaire distinct : source directe, corroboration indépendante, fraîcheur, contradictions ; reprises non comptées | [`domain/evidence.ts`](../src/server/domain/evidence.ts) ; panneau « preuves » | Fait | État explicable, pas une probabilité. |
| 3.3 Evidence Pack reliant faits, extraits et références | Dossier factuel de l'article (`factChecks` reliés aux observations) ; écran Articles, onglet « Dossier factuel » | Fait | |

## §4 — Production et diffusion

| Exigence | Implémentation | Statut | Remarques |
|---|---|---|---|
| 4.1 Après sélection humaine : dossier factuel, angles, titre, chapô, plan, brouillon | `POST /api/articles` ; `TemplateTextModel.generateDossier` ; amélioration OpenAI optionnelle | Fait | Sans clé OpenAI, le brouillon est produit par gabarits. |
| 4.1 Faits reliés aux sources ; éléments non corroborés signalés ; aucune citation inventée | Dossier factuel (`etaye`, `non_corrobore`, `contradictoire`) ; marqueurs « [À vérifier] » ; consigne anti-invention du prompt OpenAI | Partiel | Les gabarits n'inventent rien par construction. Avec OpenAI, la règle repose sur la consigne du prompt : la revue humaine (épreuve R05) reste indispensable. |
| 4.1 Règles de ton, longueur, structure et vocabulaire tirées du corpus | Editorial DNA : règles actives transmises au générateur | Partiel | Les règles sont appliquées (par exemple la longueur du titre). Le corpus historique d'Inovallée n'est pas encore chargé. |
| 4.1 Récupération d'exemples pertinents au moment de la rédaction | Entité `EditorialExample` affichée dans Paramètres | Partiel | Les exemples ne sont **pas** encore transmis au générateur lors de la création d'un article. |
| 4.1 Corrections alimentant une revue explicite des règles (pas de modification automatique) | WF6 : propositions de règles à valider (`/api/editorial-dna/proposals/:id`) | Fait | Testé : rien n'est appliqué sans décision. |
| 4.2 Import DOCX et texte UTF-8, 10 Mo maximum, sans OCR | `POST /api/imports` (multipart) ; [`domain/imports.ts`](../src/server/domain/imports.ts) | Fait | 413 au-delà de 10 Mo, 415 pour les autres formats ou encodages. |
| 4.2 Original, texte extrait et propositions distincts ; toute différence présentée à validation ; auteur jamais remplacé | Écran Articles, vue d'import (onglets « Propositions », « Texte extrait », « Original ») | Fait | Seules les propositions acceptées sont appliquées à la conversion. |
| 4.3 WordPress : brouillon, titre, corps, extrait, catégories, tags, retour de statut | `SimulatedWordPress` ; `POST /api/articles/:id/publish` | Simulé | Brouillon distant uniquement, conforme au pilote : l'article reste au statut « approuvé » et ne passe jamais à « publié ». Client REST WordPress réel à écrire. |
| 4.3 WordPress : média autorisé | — | Non fait | `WordPressDraftInput` ne comporte pas de champ média. |
| 4.3 WordPress : publication ou programmation après approbation (phase 2) | Approbation avec date de programmation (`scheduledAt`, statut « programmé ») | Partiel | La programmation est enregistrée ; aucune publication publique n'est possible, ce qui est conforme au pilote. |
| 4.3 LinkedIn : post, variantes, export pour une page ; API conditionnelle | Écran LinkedIn ; `ExportOnlyLinkedIn` | Fait | Export manuel ; l'API LinkedIn n'est pas branchée (conditionnelle aux accès). |
| 4.3 Newsletter : sélection hebdomadaire, ordre, résumés, export HTML simple et texte | Écran Newsletter ; `/api/newsletters` | Fait | Aucun envoi d'e-mail, conforme au cahier des charges. |
| 4.3 Images et SEO : suggestions de titre SEO et résumé | Champ « Titre SEO » et extrait dans l'éditeur | Partiel | Pas de suggestion de liens internes. Génération d'images et connecteur de plugin SEO : hors périmètre. |
| 4.3 Collecte LinkedIn de pages tierces | — | Hors périmètre | Explicitement exclu. |

## §5 — Architecture

Voir [Architecture](02-architecture.md#architecture-actuelle-et-architecture-cible). En résumé : API métier et adaptateurs en place ; données persistées dans la base PostgreSQL de Supabase (Lovable Cloud), sous forme générique JSONB et sans transactions ; schéma relationnel, stockage de fichiers et traitements asynchrones restent à construire ; les secrets ne transitent jamais par le navigateur. La conservation du modèle, des paramètres, du gabarit de requête et du coût de chaque appel fournisseur (§5, « Fournisseurs ») n'est pas implémentée : seule une ligne de consommation estimée est enregistrée.

## §6 — Workflows et contrôles

| Exigence | Implémentation | Statut | Remarques |
|---|---|---|---|
| WF1 collecte et classement | Collecte par source ou globale ; historique des collectes | Partiel | Collecteur réel (flux RSS et Google News) ; pas de planification automatique. |
| WF2 sujet sélectionné vers brouillon sourcé | Création d'article depuis un signal | Fait | |
| WF3 import d'un article humain | Imports | Fait | |
| WF4 post LinkedIn d'un article approuvé | Écran LinkedIn | Partiel | La préparation d'un post n'exige pas que l'article source soit approuvé (`createLinkedIn`, [`handlers/distribution.ts`](../src/server/handlers/distribution.ts)). L'export du post, lui, exige bien l'approbation de sa propre version. |
| WF5 newsletter à partir des sujets retenus | Écran Newsletter, interrupteur « Inclure dans la prochaine édition » | Fait | |
| WF6 corrections et proposition de mise à jour du référentiel | Editorial DNA | Fait | |
| Approbation : validateur, date, version, canal, programmation | Entité `Approval` | Fait | |
| Toute modification du contenu approuvé invalide l'approbation | Enregistrement d'une nouvelle version | Fait | Testé pour les articles, LinkedIn et la newsletter. |
| Droits et état revérifiés juste avant envoi ; envoi bloqué sans approbation valide ou en cas de contradiction non résolue | Contrôle avant publication ([`domain/workflow.ts`](../src/server/domain/workflow.ts)) | Fait | Testé. |
| Clé d'idempotence contenu + version + canal ; vérification du contenu distant avant reprise | `idempotencyKey` (sha-256) ; `findDraftByKey` | Partiel | Testé : une seconde publication renvoie la tentative existante. Le cas « vérification impossible, reprise soumise à revue humaine » n'est pas implémenté : les statuts `echec` et `verification_requise` existent dans les types mais ne sont jamais produits. |
| Échecs avec code, essais bornés, état visible | Collecte : trois essais, code et motif visibles ; source en échec jamais présentée comme réussie | Fait | |
| Quota fournisseur : suspension des appels concernés | `paidCall` et suspension budgétaire | Fait | |
| Versions, sources, décisions, motifs de rejet, identifiants de publication exportables | `/api/export/:entity` | Fait | |
| Retour à une version précédente : historique conservé, nouvelle approbation requise | `POST /api/articles/:id/restore` | Fait | La restauration crée une nouvelle version. |

## §7 — Sécurité et données

| Exigence | Implémentation | Statut | Remarques |
|---|---|---|---|
| Comptes nominatifs, MFA pour l'administration | Cookie de session sans authentification | Non fait | Le changement de profil libre est un outil de démonstration à retirer. Écart devenu critique : les données sont désormais persistées en base de production, modifiables par quiconque connaît l'adresse de l'application. |
| Rôles administrateur, rédacteur, validateur, lecteur (cumul possible) | [`domain/permissions.ts`](../src/server/domain/permissions.ts), contrôles côté serveur | Fait | Testé, y compris les refus. Côté interface, deux hooks `usePermissions` divergent ([`articles/hooks.ts`](../src/components/articles/hooks.ts) et [`veille/kit/hooks.ts`](../src/components/veille/kit/hooks.ts), qui ne bloque que le lecteur) : certains boutons restent actifs pour des profils que le serveur refuse ensuite (voir [Guide utilisateur](08-guide-utilisateur.md#le-bouton-est-grisé)). |
| Contenus externes non fiables : nettoyage HTML, contrôle des formats et tailles, filtrage des URL et blocage des adresses internes (SSRF), instructions des pages ignorées | [`domain/security.ts`](../src/server/domain/security.ts), [`domain/text.ts`](../src/server/domain/text.ts), imports | Partiel | Testé sur l'URL saisie. Le collecteur réel ne revalide ni les redirections ni l'URL de flux découverte dans une page, et ne résout pas le DNS avant l'appel (voir [Anomalies connues](11-anomalies-connues.md)). |
| Secrets hors code | `AI_API_KEY` en variable d'environnement serveur | Fait | Rotation et révocation à documenter avec l'hébergeur. |
| Écritures protégées contre les requêtes intersites | En-tête `x-kora-request` exigé sur toute méthode autre que `GET` | Partiel | `GET /api/newsletters/:id/export` modifie l'état (édition marquée exportée, tentative de publication, audit) et échappe donc à ce contrôle. À transformer en `POST` ou à protéger autrement. |
| Journaux techniques sans textes complets ni secrets | Console : erreurs internes uniquement | Partiel | Pas de politique de journalisation formalisée. |
| TLS, chiffrement du stockage et des sauvegardes | Supabase (Lovable Cloud) : connexions HTTPS ; chiffrement et sauvegardes selon l'offre | Partiel | Garanties de chiffrement et politique de sauvegarde de l'offre Supabase à vérifier et à consigner. |
| Rétention : journaux 90 jours, signaux et décisions 12 mois, sauvegardes 30 jours | — | Non fait | Voir [Exploitation](09-exploitation.md#rétention-des-données). |
| Séparation logique de l'espace Inovallée, tests d'accès croisé | Espace unique `ws_inovallee` | Partiel | Un seul espace existe ; le contrôle d'appartenance devra être ajouté avec la base. |

Le détail des contrôles et l'inventaire des flux tiers (dont les données envoyées à OpenAI) sont dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

## §12 — Exploitation et enveloppe

| Exigence | Implémentation | Statut | Remarques |
|---|---|---|---|
| 1 espace, 5 comptes | 4 comptes de démonstration | Partiel | Pas de gestion des comptes (création, désactivation, changement de rôles) : l'onglet « Utilisateurs & rôles » est en lecture seule. |
| 150 entreprises, 300 sources, 3 000 recherches, 6 000 observations, 25 articles, 25 posts, 5 newsletters, 10 Go, 150 € HT d'API | `DEFAULT_LIMITS` ([`domain/budget.ts`](../src/server/domain/budget.ts)) ; Paramètres, onglet « Quotas & budget » | Fait | Plafonds modifiables uniquement dans le code. Le stockage est estimé (base fixe des réglages plus taille des fichiers importés), pas mesuré sur un stockage réel. |
| 1 collecte quotidienne planifiée par source | — | Non fait | Collecte déclenchée manuellement (« Lancer la collecte », « Réessayer »). |
| Réservation du coût maximal estimé avant appel ; alertes à 80 % et 100 % ; suspension à 100 % avec consultation et exports maintenus | `paidCall` ([`services/usage.ts`](../src/server/services/usage.ts)) | Fait | Coût estimé, pas le coût réel facturé par le fournisseur. |
| Traitements simultanés bornés | — | Non fait | Pertinent une fois la file de travaux en place. |

## §13 — Réversibilité

| Exigence | Implémentation | Statut | Remarques |
|---|---|---|---|
| Export CSV/JSON : entreprises, sources, signaux, scores, règles, décisions | `/api/export/:entity` (neuf entités, dont observations, articles et audit) | Partiel | CSV UTF-8 avec BOM, formules neutralisées. L'export des articles ne contient ni le texte ni l'historique des versions ; les grilles de score, les posts LinkedIn, les éditions de newsletter et les imports ne sont pas exportables en lot. |
| Export HTML/TXT des contenus | Newsletter (HTML et texte), post LinkedIn (texte) | Partiel | Les articles sont exportés en CSV/JSON, pas en fichiers HTML individuels. |
| Manifeste et dictionnaire des relations | `/api/export/manifest` ; [Dictionnaire des données](04-dictionnaire-des-donnees.md) | Fait | |
| Fichiers client dans leur format d'origine | Original des imports sérialisé dans le JSON de l'import (`kora_records`) | Partiel | Pas d'export des fichiers originaux ; en base, le `Uint8Array` est converti en objet JSON et ne se relit pas tel quel. |

## Épreuves de recette R01 à R13 (§9)

Ce tableau indique ce qui est déjà vérifié automatiquement sur les données de démonstration et ce qui reste à faire pour passer chaque épreuve avec les données réelles.

| Épreuve | Déjà couvert | Reste à faire pour la recette |
|---|---|---|
| R01 Registre pilote puis production | Registre, quotas, collecte par source ; collecteur réel et source Google News automatique par entreprise. | Charger les 30 puis 150 entreprises réelles ; au moins une collecte réussie par fiche (attention au budget : une collecte complète coûte environ 11 € estimés). |
| R02 100 observations du jeu de recette | Identifiant, URL, date de collecte, entreprise ou « à rattacher », aucune date inventée (tests `signals.test.ts`). | Exécuter sur le jeu de recette réel. |
| R03 30 groupes de doublons et 20 événements distincts | Dédoublonnage, regroupement, défusion (tests). | Mesurer les seuils (27/30 groupes réunis, au plus 1/20 fusion à tort) sur le corpus annoté. |
| R04 30 sujets scorés, dont incomplets et contradictoires | Grille et version, motifs, indicateur documentaire, contradictions visibles (tests). | Exécuter sur les 30 sujets annotés. |
| R05 10 brouillons issus de dossiers validés | Dossier factuel relié aux observations, marqueurs « [À vérifier] », contradiction bloquante. | Revue humaine des dix brouillons, en particulier ceux réécrits par OpenAI. |
| R06 5 imports humains DOCX/TXT | Original conservé, différences présentées, aucune substitution silencieuse (tests). | Exécuter avec cinq articles réels. |
| R07 10 brouillons WordPress et 3 reprises | Champs, aucun envoi public, aucun doublon en reprise (tests sur l'adaptateur simulé). | Client WordPress réel sur le site de test ; champ média. |
| R08 5 posts LinkedIn et 2 newsletters | Exports modifiables, version approuvée conservée (tests). | Exécuter ; test de l'API LinkedIn seulement si les accès sont fournis. |
| R09 Accès, validation, changement de version, envoi sans droit | Cas négatifs de rôles, d'approbation et de version bloqués (tests). | Authentification réelle, puis tests d'accès croisé. |
| R10 Échec de source ou d'API, quota, budget épuisé | Essais bornés, état visible, 402 et suspension (tests). | Rejouer avec les fournisseurs réels. |
| R11 Export puis restauration sur environnement isolé | Exports et manifeste (tests). | Base de données, sauvegardes et procédure de restauration. |
| R12 50 documents de test, dont instructions malveillantes | Nettoyage du HTML collecté, instructions ignorées, formats interdits refusés (tests). | Constituer le jeu de 50 documents ; tester aussi la réécriture OpenAI face à ces contenus. |
| R13 100 consultations, 5 utilisateurs, 100 000 signaux, 95 % des lectures en 2 s ou moins | — | Base de données avec pagination et index, puis test de charge. |

## Synthèse du reste à faire

Par ordre de priorité pour une mise en production :

1. **Authentification nominative** et MFA pour l'administration ; gestion des comptes. Désormais prioritaire : la base de production est ouverte à quiconque connaît l'adresse.
2. **Fiabiliser la persistance** : transactions sur les opérations composées, schéma relationnel et pagination en base, stockage des fichiers hors JSON, sauvegardes et restauration testée. Fait : données persistées dans Supabase avec migrations versionnées.
3. **Compléter la collecte** : fournisseur de recherche sous licence commerciale à la place du flux Google News, lecture des pages sans flux, file de travaux, planification quotidienne, concurrence bornée et facturation au coût réel. Fait : collecteur réel par flux RSS et Google News.
4. **Client WordPress réel** (REST API, brouillon sur le site de test), avec champ média.
5. **Traçabilité fournisseur** : coût réel des appels OpenAI dans le budget, conservation du modèle et des paramètres, journalisation des échecs sans contenu sensible.
6. **Editorial DNA** : chargement du corpus d'Inovallée, transmission des exemples pertinents au générateur.
7. **Rétention et purge**, réglages modifiables sans redéploiement (plafonds, coûts).
8. **Recette** R01 à R13 sur les données réelles, consignée dans un procès-verbal.

En parallèle, les bugs relevés dans le code actuel sont listés et classés dans [Anomalies connues](11-anomalies-connues.md) ; les entrées P1 sont à traiter avant toute ouverture à des utilisateurs réels.
