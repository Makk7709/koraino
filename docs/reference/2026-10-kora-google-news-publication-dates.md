# KORA Newsroom — Correction de la fraîcheur des actualités Google News

- **Projet :** KORA Newsroom / veille Inovallée
- **Branche de travail :** `fix/kora-publication-dates`
- **Date de rédaction :** 29 octobre 2026
- **Statut :** PR Draft #2 ouverte ; correctif RSS poussé (`d618a10`) ; CI GitHub réussie avec 639/639 tests. Recette applicative isolée restante.
**Périmètre :** collecte Google News, confirmation des dates de publication, protections réseau et tests de régression

> **Note de validation du 29 octobre 2026.** L'utilisatrice a **relancé elle-même les tests dans son terminal Mac** sur `fix/kora-publication-dates` : **46 fichiers et 638 tests réussis (code de sortie 0)**. Elle a aussi exécuté `bunx tsc --noEmit -p .` (aucune erreur affichée), `bun run lint` (**0 erreur, 6 avertissements préexistants dans `src/components/ui/`**) et `bun run build` (build client, SSR et Nitro réussi). Les réponses HTTP des tests restent majoritairement **simulées** : cela n'équivaut pas à une recette Google News réelle. GitHub Actions a ensuite été exécuté avec succès sur la PR Draft, et la dernière version du code d'annulation du corps HTTP n'a pas été relue indépendamment après son dernier ajustement.

## 1. Résumé exécutif

KORA ingérait parfois des **contenus anciens comme des actualités récentes**. La date fournie par le flux Google News (date d'indexation ou de remontée dans le flux) pouvait être prise pour la date de publication originale de l'article ou de la vidéo.

La correction introduit une **confirmation de la date chez l'éditeur**, après résolution du lien Google News et avant ingestion. Un article Google News n'est désormais ingéré que si la page originale permet de vérifier une date de publication récente (fenêtre de 30 jours déjà utilisée par KORA). Une date de modification récente ne suffit pas.

Pour éviter qu'une vérification de nombreux liens ralentisse indéfiniment la collecte, la correction ajoute des **plafonds de candidats, de durée et de volume HTML**, ainsi qu'une **annulation des requêtes**. Les flux RSS officiels et Perplexity restent hors de cette nouvelle vérification.

## 2. Incident à l'origine du correctif

Dans l'environnement local de veille des 30 entreprises, deux signaux concernant **Kalray** paraissaient anormalement récents :

| Signal suspect | Date affichée dans KORA | Référence historique retrouvée |
|---|---|---|
| Kalray et l'IA pour la voiture autonome | 20 octobre 2026 | Émission BFM Business du 16 janvier 2019 |
| « On achète ou on vend ? : Worldline et Kalray à l'achat » | 19 octobre 2026 | Émission BFM Business du 28 mai 2021 |

La page Orange Actualités du premier exemple était inaccessible (HTTP 403 ou redirection vers `error403.html`). Ces rapprochements constituent de **forts indices de contenus anciens réindexés**, mais l'indisponibilité des pages Orange interdit d'affirmer que l'on a vérifié directement toutes les métadonnées de ces copies.

**Bug observé :** une date récente dans Google News pouvait suffire à faire enregistrer un contenu dont la publication originale était ancienne.

### Références utilisées pour reproduire l’incident

- **Kalray / voiture autonome :** [page Orange Actualités signalée dans KORA](https://actu.orange.fr/videos/economie/kalray-est-au-c-ur-des-intelligences-artificielles-qui-analysent-l-environnement-de-la-voiture-autonome-16-01-CNT000002tgs8W.html?pid=) ; [vidéo portant le même titre, datée de janvier 2019 sur Dailymotion](https://www.dailymotion.com/video/x70qc26).
- **Worldline et Kalray à l’achat :** [émission BFM Business du 28 mai 2021](https://www.bfmtv.com/economie/replay-emissions/c-est-votre-argent/on-achete-ou-on-vend-worldline-et-kalray-a-l-achat-28-05_VN-202105280467.html).

Ces liens sont des **références de diagnostic**, non une preuve que les copies Orange consultées avaient toutes exactement le même contenu : l’accès Orange a échoué. La recette automatisée reproduit les situations au moyen de réponses simulées, sans interroger ces liens.

### Portée sur les données déjà présentes

Le correctif agit **sur les collectes futures exécutant ce code**. Il ne constitue pas un script de correction ou de suppression rétroactive des observations et signaux déjà enregistrés. Les deux signaux Kalray présents dans la base locale des 30 entreprises n’ont pas été modifiés par les tests de cette branche. Une éventuelle revue ou correction des anciens enregistrements est une opération distincte, à décider et à tester séparément.

## 3. Comportement avant / après

| Situation | Avant | Après correction |
|---|---|---|
| Google News affiche une date récente pour une publication de 2019 | Article susceptible d'être ingéré | Rejet si la page confirme une publication ancienne |
| Date d'indexation Google News différente de `datePublished` | Date du flux conservée | Date originale confirmée utilisée |
| Vieil article avec `dateModified` récente | Risque de faux signal | `dateModified` n'est pas une preuve de nouvelle publication |
| Page éditeur en HTTP 403, 500 ou timeout | Date Google News susceptible de suffire | Candidat écarté pour cette collecte, sans date inventée |
| Cinq archives en tête de résultats, suivies de nouvelles actualités | Archives susceptibles d'occuper les cinq places | Les archives vérifiées et rejetées ne prennent pas les places d'ingestion ; sous réserve du budget de vérification |
| Article Google News avec URL éditeur directe | Pas forcément vérifié | Date originale également vérifiée |
| Flux RSS officiels | Fraîcheur selon la date du flux | Comportement inchangé |
| Résultats Perplexity | `date`, à défaut `last_updated` | Comportement inchangé |

**Attention :** les candidats Google News sont encore filtrés en amont selon la date du flux sur 30 jours. Un article dont la date originale est récente mais dont la date du flux est déjà hors fenêtre ne sera pas examiné. C'est une limite préexistante, conservée pour cette PR.

## 4. Pipeline de collecte corrigé

```text
Google News : résultats RSS (titre, lien, date de flux)
        |
        v
Filtre amont existant sur les dates RSS (30 jours)
        |
        v
Candidat encore inconnu et autorisé ?
        |
        v
Vérification Google News (au plus 15 candidats / 60 s cumulées)
        |
        +-- Lien news.google.com --> résolution du lien vers l'éditeur
        |                          (délais HTTP et annulation)
        |
        +-- URL éditeur directe --> pas de décodage nécessaire
        |
        v
Lecture HTML de l'éditeur (15 s maximum par page,
                             ou moins si le budget restant est inférieur)
        |
        v
Extraction date originale / validation du format et de la fraîcheur
        |
        +-- Date ancienne / absente / contradictoire / erreur --> ne pas ingérer
        |
        v
Évaluation et ingestion (MAX_ITEMS = 5 observations par source)
```

Les candidats qui dépassent les plafonds de vérification **ne retombent jamais automatiquement sur la date Google News**.

## 5. Règles de vérification des dates

Le module `src/server/domain/original-date.ts` examine les métadonnées de l'article principal :

- `datePublished` dans le JSON-LD d'un `Article`, `NewsArticle` ou d'une variante pertinente ;
- `article:published_time` lorsque présent dans les métadonnées HTML ;
- `uploadDate` pour un `VideoObject` principal, sans réutiliser à tort la date d'une vidéo intégrée dans un article ;
- `dateModified` et `article:modified_time` **ne sont pas utilisés** comme dates de publication.

Si plusieurs dates de publication pertinentes et lisibles se contredisent, la date n'est pas considérée comme vérifiable et l'article est écarté. La fraîcheur acceptée reste la fenêtre des **30 derniers jours**, avec la tolérance existante d'un jour dans le futur.

**Politique volontairement prudente :** en l'absence de date originale confirmée, ne pas créer de nouvelle observation à partir de la seule date Google News.

## 6. Bornes de performance et protections réseau

| Paramètre | Valeur / règle | Portée |
|---|---|---|
| `MAX_ITEMS` | **5** | Nouvelles observations ingérées par source et par collecte |
| `MAX_GOOGLE_NEWS_CHECKS` | **15** | Candidats Google News inconnus examinés par source |
| `GOOGLE_NEWS_DATE_BUDGET_MS` | **60 000 ms (60 s)** | Budget de vérification Google News, distinct du temps total de la collecte |
| `TIMEOUT_MS` du résolveur Google News | **8 000 ms (8 s)** | Par opération HTTP de décodage Google News ; lecture du corps comprise selon la dernière correction rapportée |
| Timeout de lecture éditeur | **15 000 ms (15 s)** | Maximum par page, réduit au budget restant si nécessaire |
| `MAX_PUBLISHER_HTML_BYTES` | **1 Mio** | Lecture HTML éditeur bornée en flux, rejet si la limite est dépassée |
| Redirections HTTP éditeur | `redirect: "manual"` | Une réponse 3xx n'est pas suivie ; l'article n'est pas confirmé |
| Vérification URL | `validateSourceUrl` | Refus des URL internes évidentes et des schémas non HTTP(S) ; pas de validation DNS effective |

Le contrôle de taille s'applique aux flux de réponse (`ReadableStream`) en interrompant la lecture quand le seuil est dépassé. Le cas particulier d'une réponse **sans `body` disponible** suit un chemin de repli qui vérifie la taille *après* `res.text()` : il ne faut donc pas présenter la borne mémoire comme absolue pour tous les runtimes.

### Annulation des requêtes Google News

Le service de collecte propage un `AbortSignal` au résolveur lorsque le temps restant expire. Le résolveur conserve aussi son délai individuel de huit secondes. Une annulation doit empêcher le second appel de décodage et empêcher un résultat tardif d'être ingéré.

Une erreur temporaire due à une annulation ne doit pas devenir une valeur `null` irréversible dans le cache. Les tentatives annulables sont isolées afin qu'une annulation n'interrompe pas une autre tentative indépendante ; une collecte suivante peut relancer une résolution.

**Dernière correction rapportée le 29 octobre :** le minuteur et le signal restent actifs **pendant toute la lecture du corps HTTP**, pas seulement jusqu'aux en-têtes, pour la page Google News et `batchexecute`. La lecture se fait avec un reader annulable, afin d'éviter le verrouillage de `Response.text()`. L'effectivité de la fermeture de la connexion dépend du runtime `fetch`.

## 7. Tests et démarche TDD

La démarche a été menée en **RED → GREEN → régression** : des tests ont d'abord reproduit le défaut, puis validé la correction et ses garde-fous.

| Jalons | Résultat communiqué |
|---|---|
| Baseline avant les nouveaux tests | 606 tests verts |
| Première version RED | 17 tests créés, 10 échecs attendus |
| RED renforcée, tests du pipeline | 19 tests, 13 échecs attendus |
| Première phase GREEN | 626 tests verts au total |
| Plafonds et sécurisation de la lecture | 631 tests verts au total |
| Annulation des requêtes Google News | 635 tests verts au total |
| Lecture HTTP complète sous timeout et annulation | **638 tests verts dans 46 fichiers**, confirmés par exécution indépendante sur Mac (code de sortie 0) |

### Matrice fonctionnelle de régression

| Domaine | Scénarios couverts |
|---|---|
| Dates | Vieille vidéo réindexée ; article récent ; article vieux de 60 jours ; JSON-LD ; méta `article:published_time` ; conflit de dates |
| Modification | `dateModified` récente ne remplace pas une ancienne `datePublished` ; vidéo intégrée non confondue avec l'article |
| Erreurs réseau | Timeout ; HTTP 500 ; HTTP 403 Orange ; redirection vers `error403.html` ; redirection privée non suivie |
| URLs et accès | URL interne refusée ; URL directe d'éditeur contrôlée ; lien Google News non résolu rejeté |
| Ingestion | Plusieurs archives avant les actualités pertinentes ; maximum cinq observations conservé ; maximum quinze candidats examinés |
| Charge | Budget de 60 s ; refus HTML trop volumineux ou mauvais type ; simulations sans réseau réel |
| Annulation/cache | Signal propagé, deuxième appel non lancé après abandon, nouvelle tentative possible, cache non pollué ; annulation pendant la lecture du corps HTTP |
| Non-régression | Flux RSS officiels et Perplexity inchangés ; anciens tests globaux réussis selon les rapports |

Les tests ont été exécutés avec réponses HTTP et horloges simulées : **ils ne démontrent pas à eux seuls le comportement opérationnel d'Orange, de Google News ou de Cloudflare en production**.

### 7.1 Traçabilité des tests métier (scénarios automatisés)

Les tests ci-dessous vérifient les **décisions de KORA sur les observations** ; il ne s’agit pas uniquement de tests de fonctions techniques. Les scénarios numérotés figurent dans `src/test/server/dates-publication.test.ts`. Les résultats attendus décrits ici correspondent aux assertions et intentions des tests ; les tests utilisent des réponses HTTP et des sources simulées.

| ID du test | Situation métier simulée | Résultat attendu |
|---|---|---|
| 1 | Vidéo de 2019 réindexée comme récente | Aucune observation créée |
| 2 | Publication récente, date Google News différente | Observation créée avec la date originale de l’éditeur |
| 3 et 6 | Article ancien, même avec modification récente | Aucun faux signal |
| 4 et 5 | Date publiée en JSON-LD ou métadonnée `article:published_time` | Date originale utilisée ; `dateModified` ignorée |
| 7 | Désaccord entre date Google News et date originale fiable | La date originale fait foi |
| 8 | Date originale absente ou illisible | Pas d’ingestion automatique |
| 9a et 9b | Page éditeur inaccessible (timeout ou HTTP 500) | Article écarté ; collecte poursuivie pour les autres |
| 10a, 10b et 10c | URL interne ou redirection vers un réseau privé | Aucune consultation de cette cible interdite |
| 11 | Plusieurs archives avant les publications récentes | Les archives ne monopolisent pas `MAX_ITEMS = 5` |
| 12 | Vidéo principale avec `uploadDate` | Date de mise en ligne vérifiée ; pas de confiance aveugle dans Google News |
| 13 | Cas Kalray/Orange (403 ou `error403.html`) | Aucun faux signal ; l’article voisin vérifiable peut être conservé |
| 14 | Plus de quinze candidats Google News | Seuls les quinze premiers candidats éligibles sont examinés |
| 15 | Budget de vérification dépassé | Les nouvelles vérifications cessent, sans ingestion avec la date RSS de substitution |
| 16 | URL d’éditeur directe dans un résultat Google News | Vérification de la date sans décodage inutile |
| 17 | Dates originales contradictoires ou objet vidéo lié | Rejet d’une date ambiguë ; pas d’attribution de la date de l’objet lié |
| 18 | HTML surdimensionné ou de type non HTML | Lecture bornée ; article non confirmé |
| 19 | Budget expiré pendant Google News | Annulation demandée, aucune observation ; nouvelle tentative possible |

**Autres tests métier / non-régression :** les cas de flux RSS officiel vérifient qu’un article correctement daté peut être conservé sans lire sa page et qu’un article ancien est écarté ; le cas Perplexity vérifie que ses règles de datation, filtrage et déduplication existantes restent inchangées. `liens-google-news.test.ts` couvre en complément les liens décodés, le cache, les annulations et la collecte à travers les routes simulées.

**Dernier changement après l’archive examinée :** les trois tests additionnels portant sur l’annulation pendant la lecture du *corps* HTTP (page Google News, `batchexecute`, délai individuel de huit secondes) ont été ajoutés en dernier. **L’exécution de la suite complète contenant ces tests a ensuite été reproduite indépendamment sur le Mac : 638/638, code de sortie 0.** Leur code final n’a pas été relu indépendamment après ce dernier ajustement.

### 7.2 Types de tests effectués et non effectués

| Niveau | État au 29/10/2026 | Preuve / limite |
|---|---|---|
| **Unitaires** | Couvert | Extraction de dates, identification/décodage de liens, limites et cache, réponses simulées |
| **Fonctionnels métier automatisés** | Couvert sur les scénarios listés | Assertions sur observations créées/refusées et dates retenues |
| **Intégration applicative simulée** | Couvert | Parcours de la route de collecte et de ses services avec sources, horloge, HTTP et stockage de test simulés |
| **Erreurs et résilience** | Couvert sur scénarios ciblés | HTTP 403/500, timeouts, redirections, dépassement de taille, annulation, essais suivants |
| **Régression globale** | **Réussite reproduite indépendamment** | 638/638 tests dans 46 fichiers, exécutés sur Mac le 29/10/2026 ; code de sortie 0 ; tests HTTP simulés |
| **Qualité statique et compilation** | **Réussite reproduite indépendamment** | `tsc --noEmit` sans erreur, ESLint 0 erreur/6 avertissements préexistants, build Vite + SSR + Nitro réussi ; `git diff --check` sans erreur |
| **CI GitHub sur PR Draft** | 39 tests, TypeScript, ESLint et build réussis sur `d618a10` |
| **E2E réel / recette métier** | **À faire avant mise en production** | Nouvelle version de la branche à tester en environnement isolé avec vraies pages Google News/éditeurs ; ne pas modifier la base locale de 30 entreprises |
| **Performance et stabilité réelles** | **À mesurer** | Temps/volume de requêtes d’une collecte réelle et taux de rejets par cause ; budgets simulés ≠ mesure réseau réelle |
| **Sécurité réseau de bout en bout** | **Partielle** | URL internes et redirections simulées couvertes ; DNS/rebinding et comportement exact de Cloudflare non démontrés |

**Les 639 tests ne sont pas tous spécifiques à ce correctif.** Ils correspondent à la suite globale KORA. Une recette applicative réelle de bout en bout reste nécessaire.

**Détail des tests ciblés, vérifié dans la sortie terminal du 29 octobre 2026 :** `src/test/server/dates-publication.test.ts` : **26 tests réussis** ; `src/test/server/liens-google-news.test.ts` : **13 tests réussis**. Après ajout du test de régression Google News, 40 tests ciblés (26 tests de dates et 14 tests de liens) font partie des 639 tests globaux. Le reste de la suite couvre les autres fonctions de KORA et les non-régressions.

### 7.3 Critères métier de recette à vérifier avant usage opérationnel

1. Sur un environnement isolé, une nouvelle publication vérifiable de moins de 30 jours crée une observation datée de la **publication originale**, sans doublon.
2. Une archive réindexée et une page Orange inaccessible ne produisent pas de faux signal.
3. Une source contenant de nombreuses archives permet encore de conserver des actualités récentes si elles figurent dans les **quinze candidats** et dans le **budget de soixante secondes**.
4. Les sources officielles RSS et Perplexity n’ont pas régressé.
5. Les erreurs temporaires sont **mesurées** et reconnues comme des faux négatifs possibles ; la file de réessai automatique est une **amélioration ultérieure, non incluse dans cette PR**.
6. Aucun test réel n’est lancé sur la base locale des trente entreprises sans sauvegarde, isolation et accord explicite sur le jeu de données.

### 7.4 Preuves et protocole de validation restant

**Preuves obtenues sur le Mac le 29 octobre 2026 :**

- `bun run test` : 46 fichiers, 638 tests réussis, code de sortie **0**, durée affichée **6,55 s** ;
- `bunx tsc --noEmit -p .` : aucune erreur affichée ;
- `bun run lint` : aucune erreur et six avertissements `react-refresh/only-export-components` dans les composants UI ;
- `bun run build` avec les principales variables de connexion neutralisées : builds client, SSR et Nitro terminés avec succès. Les recommandations de Vite et Nitro ne sont pas des échecs de compilation.

**Preuves obtenues :** CI GitHub réussie sur `d618a10` (639/639 tests) et quatre résolutions de liens Google News réels, dont deux dates confirmées. **Restent à vérifier :** collecte applicative complète en environnement isolé et mesures représentatives des faux négatifs et des performances.

**Recette HTTP isolée à réaliser avant toute décision de fusion/déploiement :** utiliser le code de cette branche, des sources publiques réelles et un stockage de test indépendant (ou une exécution sans persistance) ; vérifier un article récent, une archive réindexée et une source inaccessible ; relever URL, date du flux, date originale, motif de rejet ou d’acceptation, durée et nombre de requêtes. Ne pas utiliser la base locale de 30 entreprises, les secrets de production ou les API payantes. Déclarer « non démontré » tout scénario impossible à observer réellement.

---

## 8. Fichiers concernés

### Code métier

- `src/server/services/collection.ts` : vérification avant ingestion, bornes et budget partagé, propagation d'annulation ;
- `src/server/adapters/google-news.ts` : résolution Google News, annulation HTTP, cache ;
- `src/server/services/publisher-page.ts` : récupération bornée de la page éditeur, gestion erreurs, validation de date ;
- `src/server/domain/original-date.ts` : extraction prudente de la date originale.

### Tests

- `src/test/server/dates-publication.test.ts` : scénarios date/403/limites/annulation ;
- `src/test/server/liens-google-news.test.ts` : résolveur, lecture HTTP et cache ;
- `src/test/server/collecte-reelle.test.ts`, `regroupement.test.ts`, `scoring-contenu.test.ts` : adaptation des mocks et non-régression ;
- `src/test/server/budget.test.ts` : ajustements préexistants sans lien direct avec le correctif des dates.

### Qualité et CI présentes sur la branche

- `.github/workflows/kora-quality.yml` : contrôles PR vers `main`, TypeScript, ESLint, Vitest et build ;
- `eslint.config.js`, `src/server/connectionKeyCrypto.ts`, `src/test/server/budget.test.ts` : changements de qualité/formatage déjà présents avant la phase dates ; à **revoir et identifier séparément** lors de la préparation du commit.

## 9. Limites connues et décisions conservées

1. **Faux négatifs possibles :** une page inaccessible, sans date originale lisible, en 3xx, ou trop lente n'est pas ingérée lors de cette collecte.
2. **Pas de file de réessai persistante :** une collecte future peut retenter un article seulement s'il réapparaît dans les résultats ; ce n'est pas une garantie de reprise.
   **Traçabilité opérationnelle :** il n’existe pas, dans le périmètre de ce correctif, de compteur persistant détaillant les articles abandonnés pour timeout, date absente, HTTP 403, HTML trop grand ou plafond atteint. Les tests démontrent les règles, pas les proportions réelles de ces motifs.
3. **Plafond de quinze candidats :** un article pertinent au-delà du quinzième n'est pas examiné dans ce passage.
4. **Anciennes publications réellement enrichies :** l'ajout d'une vraie annonce à une ancienne page ne suffit pas aujourd'hui : `datePublished` ancienne entraîne le rejet, même avec `dateModified` récente.
5. **Filtre amont Google News :** la date RSS hors fenêtre exclut un candidat avant la vérification de l'éditeur.
6. **RSS et Perplexity :** leur logique historique de datation reste différente ; `updated` ou `last_updated` peut encore signaler une simple modification sans nouveauté métier.
7. **SSRF / DNS :** la validation URL est lexicale, sans vérification de l'IP réellement contactée ni protection applicative contre le rebinding DNS. Ne pas annoncer la sécurité SSRF comme totalement résolue.
8. **Redirections éditeur :** les redirections publiques légitimes ne sont pas suivies ; certains articles récents peuvent être perdus.
9. **Budget de 60 s :** il ne borne pas le temps complet de la collecte (lecture RSS, enrichissement Perplexity, classification IA, base de données).
10. **Déploiement :** aucun merge ni déploiement Lovable n'est autorisé dans le cadre de cette branche à ce stade.

## 10. Prochaine évolution, dans un chantier distinct

**Reprise des articles non vérifiés pour raisons techniques**, après commit et validation CI de cette correction, et **avant de déclarer la collecte suffisamment fiable pour un usage opérationnel**.

Principes à spécifier et tester :

- différencier explicitement « publication ancienne vérifiée » et « échec technique temporaire » ;
- conserver durablement les candidats ayant échoué pour timeout/erreur transitoire, avec délai et nombre de tentatives bornés ;
- ne jamais ingérer un article faute de preuve de date originale ;
- éviter doublons, réessais infinis et surconsommation réseau ;
- vérifier le comportement si le candidat disparaît du flux Google News ;
- tester sans toucher aux données locales des trente entreprises.

**Évolution métier ultérieure, distincte :** détecter une **nouvelle information** ajoutée à un article ancien, sur Google News, RSS ou Perplexity, par comparaison/corroboration du contenu — sans revenir à l'acceptation automatique de `dateModified` ou `last_updated`.

## 11. Validation Git et critères d'acceptation

Avant le commit, contrôler les fichiers ajoutés et le périmètre exact :

```bash
git branch --show-current
git status --short
git diff --check
git diff --stat
git diff --cached --stat
```

Ne pas oublier que `git diff --stat` **n'affiche pas les fichiers non suivis** (documentation, nouveaux services, nouveaux tests, `.github/`) tant qu'ils ne sont pas ajoutés à l'index Git.

À confirmer avant PR Draft :

- [ ] Le diff final de la dernière annulation HTTP a été relu.
- [ ] Les fichiers préexistants de formatage/CI sont séparés ou justifiés dans le commit.
- [x] `bun run test` (638/638), `bunx tsc --noEmit -p .`, `bun run lint` (0 erreur, 6 avertissements), `bun run build` réussissent sur la branche locale au 29/10/2026 ; à relancer si des fichiers changent.
- [ ] `git diff --check` réussit.
- [x] Le document figure dans la branche avec le correctif.
- [x] La CI GitHub a réussi sur `d618a10`. La recette applicative isolée reste nécessaire avant toute fusion.

**Protection opérationnelle :** ne modifier ni `main`, ni Lovable, ni le répertoire local `~/Projects/koraino` et sa base Supabase des trente entreprises lors de ces opérations.


---

## Addendum — validation réelle du 29 octobre 2026

### Correctif complémentaire Google News

L'ancien décodeur utilisait `news.google.com/articles/{id}`.
Ce chemin a renvoyé HTTP 429 lors d'un test réel.

Le nouveau chemin `news.google.com/rss/articles/{id}` a permis
de résoudre les liens vers les pages originales des éditeurs.

Un test automatisé de régression HTTP 429 a été ajouté.

### Résultats des tests HTTP réels

| Source | Lien éditeur résolu | Date originale | Décision |
|---|---|---|---|
| Boursier.com / Kalray Openchip | Oui | HTTP 403, non confirmée | Rejet |
| Les Échos Investir / Kalray | Oui | Non confirmée | Rejet |
| VIPress / Kalray | Oui | 29 septembre 2026 | Acceptation |
| Boursorama / Kalray | Oui | 6 octobre 2026 | Acceptation |

Bilan : 4 liens résolus sur 4 et 2 dates confirmées sur 4.

Ces tests sont exploratoires et n'équivalent pas à une recette
applicative complète.

### Gestion des articles anciens

Une date récente dans le flux Google News ne suffit plus.
La publication originale doit être confirmée dans la fenêtre
de fraîcheur de 30 jours.

### Dates de publication et de modification

Les métadonnées `datePublished`, `article:published_time`
et `VideoObject.uploadDate` peuvent confirmer la publication.

`dateModified` ne prouve pas une nouvelle publication.
Les dates contradictoires ne sont pas acceptées arbitrairement.

### Gestion des erreurs

Une erreur HTTP, un lien non résolu ou une date absente
entraîne le rejet de la nouvelle observation Google News.

Les éditeurs inaccessibles peuvent donc provoquer des faux négatifs.

### Limites de performance

- Maximum 15 candidats Google News vérifiés par source.
- Budget de vérification de 60 secondes.
- Timeout de 8 secondes par opération du résolveur Google News.
- Timeout de 15 secondes maximum par page éditeur.
- HTML éditeur limité à 1 Mio sur la lecture en flux.
- Maximum 5 nouvelles observations par source.

### Validation technique

- 639 tests automatisés réussis sur 46 fichiers en local.
- TypeScript : OK.
- ESLint : 0 erreur, 6 avertissements préexistants.
- Build Vite / SSR / Nitro : réussi.
- Première CI GitHub : 638 tests réussis.
- Nouvelle CI GitHub réussie : **639/639 tests dans 46 fichiers**, TypeScript, ESLint et build validés.

### Limites restantes

Le contenu Google News analysé provient principalement du
titre et de la description RSS, pas de l'article intégral.

Les réessais automatiques, la recherche de sources alternatives
et la détection de nouvelles annonces dans des articles anciens
restent hors périmètre.

Aucune modification des données historiques ou des 30 entreprises
existantes. Aucun déploiement.

---

## Addendum — recette applicative isolée Kalray

**Date :** 29 octobre 2026
**Branche :** `fix/kora-publication-dates`
**Exécution :** Mac local, Bun 1.2.19, stockage en mémoire.

### Collecte réelle

Une collecte Kalray a été exécutée avec le véritable
service `collectOne()`, Google News et des pages éditeurs.

Résultats :
- Statut : `succes`.
- 4 observations créées et confirmées dans le stockage mémoire.
- 3 signaux associés à Kalray.
- 4 dates originales vérifiées dans la fenêtre de 30 jours.
- Aucune erreur de collecte signalée.

Les éditeurs des quatre observations acceptées étaient
Boursorama (3 articles) et VIPress.net (1 article).

### Déduplication

Une seconde recette a rejoué un flux Google News figé,
avec le même `MemoryRepository`.

| Contrôle | Résultat |
|---|---|
| Première collecte | 4 observations |
| Deuxième collecte | `succes_sans_actualite` |
| Nouvelles observations au second passage | 0 |
| URL uniques finales | 4 |
| Doublons d'URL | 0 |
| Relations observations-signaux | Cohérentes |

Un essai exploratoire distinct avait créé 5 observations
au premier passage et 1 au second. Ce résultat ne démontre
pas un doublon : `MAX_ITEMS = 5` peut laisser des publications
distinctes pour une collecte suivante.

### Rejet des articles anciens

La commande de test ciblée
`bun --no-env-file run test src/test/server/dates-publication.test.ts`
a réussi : **26 tests sur 26**.

Elle couvre notamment :
- une vidéo de 2019 réindexée par Google News ;
- une publication vieille de 60 jours ;
- une date de modification récente sans publication récente ;
- les erreurs HTTP, redirections, budgets et dates contradictoires.

Ces scénarios sont validés avec un réseau simulé ;
ils ne constituent pas des mesures réseau réelles.

### Protection des données

La recette a utilisé un `MemoryRepository` temporaire,
avec la configuration Supabase désactivée et sans API IA payante.

Aucune écriture n'a été effectuée dans la base habituelle
des 30 entreprises par ces scripts de recette.

### Limites et prochaines validations

- La cohérence technique des regroupements a été vérifiée,
  mais leur pertinence éditoriale reste à examiner.
- Les scénarios négatifs sont validés automatiquement
  avec HTTP simulé, et non tous reproduits sur des éditeurs réels.
- Les faux négatifs des éditeurs inaccessibles restent possibles.
- Aucun déploiement ni fusion dans `main` n'a été effectué.
