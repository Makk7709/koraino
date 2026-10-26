# Règles métier et workflows

**Objet.** Ce document décrit les règles métier appliquées par le serveur KORA : score éditorial et indicateur documentaire, Signal Engine (rattachement, regroupement, fusion, dates), workflows WF1 à WF6, approbation et publication, matrice des droits, quotas et budget, Editorial DNA, imports humains, newsletter et amélioration par OpenAI. Il s'adresse aux ingénieurs qui modifient ces règles ou doivent expliquer un comportement observé. Les règles pures sont dans `src/server/domain/`, leur orchestration dans `src/server/services/` et `src/server/handlers/`. Le format exact des requêtes et réponses est dans la [Référence API](03-reference-api.md), les champs dans le [Dictionnaire des données](04-dictionnaire-des-donnees.md). Les règles qui ne figurent qu'au cahier des charges sont signalées comme telles ; la couverture complète est dans [Couverture du cahier des charges](10-couverture-cahier-des-charges.md). Les exemples chiffrés (signal Pasqal, tentative `pub_0001`) proviennent du jeu de démonstration, que seul le dépôt en mémoire charge (tests et développement local sans base) ; la base de production démarre sans données métier.

## Sommaire

- [Score éditorial](#score-éditorial)
- [Indicateur documentaire](#indicateur-documentaire)
- [Signal Engine](#signal-engine)
- [Workflows WF1 à WF6](#workflows-wf1-à-wf6)
- [Approbation et publication](#approbation-et-publication)
- [Matrice des droits](#matrice-des-droits)
- [Quotas et budget](#quotas-et-budget)
- [Editorial DNA](#editorial-dna)
- [Imports humains](#imports-humains)
- [Newsletter](#newsletter)
- [Amélioration par OpenAI](#amélioration-par-openai)

## Score éditorial

Le score éditorial mesure la priorité éditoriale d'un signal. C'est un entier de 0 à 100 (`score.total`), somme pondérée de cinq sous-notes de 0 à 100 (`score.subScores`), chacune accompagnée d'un motif rédigé (`score.reasons`). Le calcul est dans [`domain/scoring.ts`](../src/server/domain/scoring.ts).

### Critères et poids

| Critère | Clé (`Criterion`) | Poids de la grille v1 (`DEFAULT_WEIGHTS`) |
|---|---|---|
| Importance | `importance` | 30 |
| Nouveauté | `nouveaute` | 20 |
| Adéquation territoriale | `territoire` | 20 |
| Intérêt pour les lecteurs | `lecteurs` | 20 |
| Potentiel de diffusion | `diffusion` | 10 |

### Sous-notes et motifs

La fonction `assess` calcule les sous-notes à partir des seules données du signal : catégorie, titre, résumé et extraits des observations, fiche entreprise, signaux antérieurs et écart entre l'événement et sa détection. Chaque sous-note est bornée entre 0 et 100, puis arrondie.

**Importance.** Quand le modèle a lu la publication à la collecte (clé `AI_API_KEY` configurée, voir [Lecture du contenu par le modèle](#lecture-du-contenu-par-le-modèle)), la note est l'importance qu'il a donnée (0–100), avec son motif (« Lecture du contenu par le modèle : … ») ; le montant n'ajoute rien, la priorité de l'entreprise s'applique comme ci-dessous. Sinon, la base dépend de la catégorie (`CATEGORY_IMPORTANCE`) :

| Catégorie | Base |
|---|---|
| `financement`, `acquisition` | 82 |
| `contrat`, `international` | 74 |
| `partenariat`, `innovation` | 72 |
| `croissance` | 70 |
| `recherche` | 68 |
| `produit`, `distinction` | 66 |
| `brevet` | 62 |
| `recrutement` | 58 |

Le plus gros montant cité dans les textes (extrait par `extractAmountsM` dans [`domain/text.ts`](../src/server/domain/text.ts), formes « 100 M€ » ou « 12 millions d'euros ») ajoute 12 points s'il atteint 50 M€, 6 points s'il atteint 10 M€. Une entreprise de priorité `haute` ajoute 5 points ; une priorité `basse` en retire 5.

**Nouveauté.** La note vaut 86 si aucun signal de la même entreprise et de la même catégorie n'a été créé dans les 90 jours précédents, 55 sinon. Elle perd 8 points si la date de l'événement est inconnue (ni date d'événement ni date de publication), et se dégrade avec l'ancienneté de l'événement (ou de la plus ancienne publication) au moment de la création du signal : 5 points au-delà de 2 jours, 12 au-delà de 7, 20 au-delà de 14, 25 au-delà de 30.

**Territoire.** Sans entreprise rattachée, la note vaut 30. Elle vaut 95 si le territoire de l'entreprise contient « inovall », 88 s'il cite une commune de l'agglomération reconnue par l'expression régulière du code (Grenoble, Meylan, Montbonnot, Crolles, Isère, Échirolles, Saint-Égrève, Voiron), 60 sinon.

**Lecteurs.** La note dépend de la première thématique de l'entreprise : 85 pour une thématique prioritaire (`PRIORITY_THEMES` : `deeptech_quantique`, `ia_industrie`, `transition_energetique`), 80 pour `talents_rh`, 72 pour une autre thématique, 65 sans thématique. Chaque thématique supplémentaire ajoute 5 points, dans la limite de 10.

**Diffusion.** Soit k le nombre de domaines de médias distincts parmi les observations, hors reprises et hors domaine de l'entreprise. La note vaut 45 pour k = 0, 60 pour k = 1, 75 pour k = 2 et 85 au-delà. Elle gagne 10 points si l'un de ces médias figure dans `NATIONAL_OUTLETS` (lesechos.fr, lefigaro.fr, bfmtv.com, usinenouvelle.com, latribune.fr, ec.europa.eu).

Les notes éditoriales du signal en découlent : « Pourquoi c'est intéressant » (`whyInteresting`) reprend les motifs des trois meilleures sous-notes, et l'angle suggéré (`suggestedAngle`) provient du gabarit de la catégorie (`ANGLE_TEMPLATES` dans [`store/catalog.ts`](../src/server/store/catalog.ts)).

### Total et affichage sur 10

`computeTotal` calcule `round(Σ subScores[c] × weights[c] / 100)`, borné entre 0 et 100. Pour le signal Pasqal du jeu de démonstration, (95 × 30 + 90 × 20 + 95 × 20 + 90 × 20 + 85 × 10) / 100 = 92 :

```json
{
  "total": 92,
  "gridVersion": 1,
  "subScores": { "importance": 95, "nouveaute": 90, "territoire": 95, "lecteurs": 90, "diffusion": 85 },
  "reasons": {
    "importance": "Catégorie « financement », montant élevé (100 M€), entreprise prioritaire du registre",
    "nouveaute": "Premier sujet de cette nature sur 90 jours",
    "territoire": "Entreprise de l'agglomération grenobloise (Grenoble)",
    "lecteurs": "Thématique prioritaire de la ligne éditoriale",
    "diffusion": "2 média(s) indépendant(s), dont un média national"
  }
}
```

L'API renvoie toujours l'échelle 0 à 100. L'interface affiche le score sur 10 avec une décimale (`scoreOn10` dans [`labels.ts`](../src/components/kora/labels.ts)) : 92 devient « 9.2 ». Le seuil de « sujet prioritaire » du tableau de bord est `PRIORITY_SCORE = 80` ([`domain/dashboard.ts`](../src/server/domain/dashboard.ts)) ; un nouveau signal de score supérieur ou égal à 80 déclenche une notification lors de la collecte (seuil écrit en dur dans [`services/collection.ts`](../src/server/services/collection.ts)).

Les sous-notes du jeu de démonstration sont ajustées pour reproduire la maquette (`fitScores` dans [`store/seed.ts`](../src/server/store/seed.ts)), alors que les motifs proviennent de `assess`. Un motif peut donc ne pas correspondre exactement à la sous-note affichée : pour Pasqal, la sous-note territoire vaut 95 avec le motif « Entreprise de l'agglomération grenobloise (Grenoble) », qui correspond à la note 88 dans `assess`. Toute reconstruction du signal recalcule les deux de façon cohérente.

### Grille versionnée et validation des poids

Une grille (`GridRecord`) porte un identifiant `grid_v{n}`, un numéro de version, les cinq poids, la date et le nom de son auteur, un indicateur `active` et une note. La grille active est celle marquée `active`, à défaut celle de version la plus haute.

`POST /api/scoring-grids` (administrateur, action `grid.write`) crée une grille. `validateWeights` exige pour chaque critère un entier de 0 à 100 et une somme exactement égale à 100 ; sinon l'API répond 422 `weights_sum_invalid`. Le schéma zod accepte tout nombre : le contrôle d'entier est fait par `validateWeights`, qui refuse donc 30,5. La nouvelle grille prend le numéro de version maximal plus un, devient active, et toutes les autres sont désactivées. L'événement `grid.create` est journalisé. Les grilles précédentes restent consultables par `GET /api/scoring-grids`. Aucun endpoint ne supprime ni ne réactive une grille : revenir à d'anciens poids revient à créer une nouvelle version avec ces poids.

La création d'une grille l'applique aussitôt aux signaux en cours (`applyGridToSignals`, le même traitement que « Recalculer les scores ») : les signaux traités ou rejetés gardent le score, la version de grille, les sous-notes et les motifs de leur décision ; la réponse indique le nombre de signaux recalculés.

### Recalcul et décisions historiques

`POST /api/signals/rescore` (administrateur, `grid.write`) applique la grille active à tous les signaux non décidés et renvoie `{ "rescored": n }`. `applyGrid` recalcule le total à partir des sous-notes déjà stockées et met à jour `gridVersion` ; les sous-notes et les motifs ne changent pas. L'événement `grid.rescore` est journalisé.

Le cahier des charges (§3.3) exige qu'un changement de grille ne réécrive pas les décisions historiques. Le code le garantit ainsi :

1. `isDecided(status)` considère comme décidés les signaux `traite` et `rejete`.
2. Le recalcul ignore les signaux décidés.
3. Toutes les reconstructions d'un signal (nouvelle observation rattachée à la collecte, rattachement ou détachement manuel, fusion, défusion) recalculent le score, puis restaurent l'ancien score, `whyInteresting` et `suggestedAngle` si le signal est décidé : voir `ingest` dans [`services/collection.ts`](../src/server/services/collection.ts) et `rebuild` dans [`handlers/signals.ts`](../src/server/handlers/signals.ts).
4. Chaque score conserve la version de grille qui l'a produit (`gridVersion`) et aucune grille n'est supprimée ; les exports `signals` et `scores` contiennent cette version.

Le test « une nouvelle grille ne réécrit pas l'historique des signaux décidés » de [`signals.test.ts`](../src/test/server/signals.test.ts) vérifie ce comportement.

Cette protection a trois limites :

- Seuls `traite` et `rejete` sont protégés. Un signal `surveille`, `en_revue`, `a_traiter` ou `nouveau` est recalculé.
- Les transitions de statut sont libres (voir [Statuts d'un signal](#statuts-dun-signal)). Un signal rejeté puis restauré en `a_traiter` redevient recalculable, et son score antérieur n'est pas historisé : seul le journal d'audit garde trace du changement de statut.
- Une reconstruction d'un signal non décidé applique la grille active et recalcule les sous-notes. La `gridVersion` d'un signal non décidé peut donc changer sans appel à `/signals/rescore`.

## Indicateur documentaire

L'indicateur documentaire (`EvidenceState`) décrit la qualité des preuves réunies pour un signal. Il est calculé par `computeEvidence` ([`domain/evidence.ts`](../src/server/domain/evidence.ts)) à chaque lecture d'un signal (`toSignal` dans [`services/view.ts`](../src/server/services/view.ts)) et n'est jamais stocké : il reflète l'état courant des observations et de la date du jour.

### Reprises

`markSyndication` ([`domain/clustering.ts`](../src/server/domain/clustering.ts)) trie les observations du signal par date (publication, à défaut collecte), puis par identifiant. Une observation est marquée comme reprise (`isSyndicated`) si une observation antérieure d'un autre domaine a un extrait similaire à au moins 0,8 (`SYNDICATION_THRESHOLD`). La similarité (`textSimilarity` dans [`domain/text.ts`](../src/server/domain/text.ts)) est un indice de Jaccard sur les mots normalisés : minuscules, sans accents, sans mots vides, longueur supérieure à un caractère. Le marquage est refait à chaque reconstruction du signal. Une reprise n'est jamais comptée comme confirmation.

### Composantes

- **Source directe.** Une observation est directe si l'entreprise est connue et que le domaine du média est le domaine officiel de l'entreprise, ou que l'hôte de l'URL se termine par ce domaine.
- **Corroborations indépendantes.** Ce sont les domaines distincts des observations ni reprises ni directes. En présence d'une source directe, tous comptent ; sinon le premier tient lieu de source primaire et ne se corrobore pas lui-même : le nombre retenu est `max(0, n − 1)`.
- **Fraîcheur.** C'est le nombre de jours écoulés depuis la date la plus récente parmi les dates de publication, à défaut d'événement. Elle vaut `null` si aucune date n'est connue ; la date de collecte n'est jamais utilisée.
- **Contradictions.** `detectContradictions` extrait les montants en millions d'euros des titres et extraits des observations non reprises. Au moins deux montants distincts produisent un message de la forme « Montants divergents selon les sources : 100 M€ (Les Echos) / 120 M€ (La Tribune) ». Seuls les montants sont comparés, et une seule source citant deux montants suffit à déclencher l'alerte.

### Niveau

| Condition, dans l'ordre | Niveau (`level`) |
|---|---|
| Au moins une contradiction | `fragile` |
| Source directe et au moins une corroboration | `solide` |
| Source directe ou au moins une corroboration | `a_consolider` |
| Aucune des deux | `fragile` |

La liste `explanation` détaille chaque composante en phrases et se termine toujours par « Indicateur documentaire explicable, pas une probabilité de véracité ». Exemple réel (`GET /api/signals/sig_pasqal`) :

```json
{
  "level": "solide",
  "directSource": true,
  "independentCorroborations": 2,
  "freshnessDays": 0,
  "contradictions": [],
  "explanation": [
    "Source directe disponible (Pasqal)",
    "2 corroboration(s) indépendante(s) : Les Echos, La Tribune",
    "1 reprise(s) du même communiqué non comptée(s) : Le Dauphiné Libéré",
    "Publication du jour",
    "Indicateur documentaire explicable, pas une probabilité de véracité"
  ]
}
```

### Score, indicateur et confiance de rattachement

Trois valeurs distinctes accompagnent un signal. Aucune n'est une probabilité.

| Valeur | Champ | Échelle | Calcul | Stockage |
|---|---|---|---|---|
| Score éditorial | `score.total` | 0 à 100, affiché sur 10 | `assess` puis `applyGrid` | stocké, versionné par grille |
| Indicateur documentaire | `evidence.level` | `solide`, `a_consolider`, `fragile` | `computeEvidence` | recalculé à chaque lecture |
| Confiance de rattachement | `matchConfidence` | 0 à 100, affichée « Confiance 92% » | `matchCompany` | stockée |

Le score dit si le sujet mérite d'être traité, l'indicateur dit si le dossier est suffisamment étayé, la confiance dit seulement si l'entreprise rattachée est la bonne. Le critère de diffusion du score compte aussi les médias indépendants, mais une contradiction ne fait pas baisser le score : elle n'agit que sur l'indicateur et, au niveau de l'article, sur le dossier factuel (voir [WF2](#wf2--sujet-sélectionné-vers-brouillon-sourcé)).

## Signal Engine

### Chaîne d'ingestion

Chaque élément renvoyé par le collecteur passe par `ingest` ([`services/collection.ts`](../src/server/services/collection.ts)) :

1. L'URL est contrôlée par `validateSourceUrl` (voir [Filtrage SSRF](06-securite-et-flux-tiers.md#filtrage-ssrf)). Une URL refusée est ignorée sans erreur.
2. L'URL est canonisée (`canonicalUrl` : hôte sans `www`, chemin sans barre finale, paramètres `utm_*` et fragment supprimés, minuscules). Une URL déjà connue est ignorée.
3. Le titre (300 caractères au plus) et l'extrait (1 200 au plus) sont nettoyés par `sanitizeText`. Un élément vide après nettoyage est ignoré.
4. L'entreprise est recherchée par `matchCompany` ; elle n'est retenue que si la confiance atteint `MATCH_THRESHOLD = 60`.
5. La catégorie est déduite par `classifyCategory`.
6. `decideCluster` rattache l'observation à un signal existant ou crée un signal.
7. Le signal est reconstruit (`rebuildSignal` dans [`services/signals.ts`](../src/server/services/signals.ts)) : reprises, dates, observation primaire, score. Un nouveau signal de score au moins égal à 80 déclenche une notification.

Une collecte crée au plus cinq observations nouvelles par source (`MAX_ITEMS`). Les éléments sont examinés dans l'ordre du collecteur, du plus récent au plus ancien pour le collecteur réel ; un élément ignoré (URL refusée ou déjà connue, texte vide) ne compte pas dans cette limite (voir [WF1](#wf1--collecte-et-classement)).

### Rattachement aux entreprises

`matchCompany` ([`domain/clustering.ts`](../src/server/domain/clustering.ts)) cherche les noms et alias du registre dans le titre et l'extrait, à frontière de mots, sans tenir compte de la casse, des accents ni de la ponctuation.

| Situation | Confiance | Entreprise retenue | Revue (`review`) |
|---|---|---|---|
| Hôte de l'URL égal au domaine officiel ou à un sous-domaine | 97 | oui | aucune |
| Une seule entreprise citée, celle de la source, par son nom | 92 | oui | aucune |
| Une seule entreprise citée, celle de la source, par un alias | 84 | oui | aucune |
| Une seule entreprise citée, autre que celle de la source, par son nom | 82 | oui | aucune |
| Une seule entreprise citée, autre que celle de la source, par un alias | 66 | oui | aucune |
| Plusieurs entreprises citées, dont celle de la source, avec au plus un nom exact | 70 | oui, celle de la source | aucune |
| Plusieurs entreprises citées, autres cas | 45 | non | `homonymie` |
| Aucune entreprise citée, source rattachée à une entreprise | 52 | non | `homonymie` |
| Aucune entreprise citée, source sans entreprise | 20 | non | `homonymie` |

Sous le seuil de 60, `companyId` vaut `null` : le signal est « à rattacher » et la revue indique les candidates ou le motif. `PATCH /api/signals/:id` avec `companyId` rattache manuellement le signal et ses observations, fixe la confiance à 100, efface la revue, reprend les thématiques de l'entreprise et reconstruit le signal (audit `signal.attach`). `companyId: null` détache le signal et pose une revue `homonymie` « Détaché manuellement » (audit `signal.detach`). La suppression d'une entreprise détache ses signaux de la même manière.

### Classement taxonomique

Quand le modèle a lu la publication (voir ci-dessous), sa catégorie est retenue. Sinon, `classifyCategory` note chaque catégorie par des indices lexicaux sur le titre et l'extrait sans accents : un indice fort (« levée de fonds », « remporte », « s'implante », « lauréat »…) vaut 3 points, un indice faible (« prix », « double », « lance », « fonds », « recherche »…) 1 point ; la catégorie la mieux notée l'emporte, et à égalité l'ordre financement, acquisition, contrat, partenariat, brevet, recrutement, distinction, international, croissance, produit, recherche, innovation tranche. Un mot ambigu seul ne décide donc plus de la catégorie. À défaut d'indice, la catégorie est `innovation`. La catégorie est fixée à la création du signal ; aucun endpoint ne la modifie.

### Lecture du contenu par le modèle

Quand une clé `AI_API_KEY` est configurée, chaque publication nouvelle (au plus `MAX_ITEMS` par source et par collecte) est soumise au modèle avant l'ingestion, pendant la phase réseau du lot (`assessItems` dans [`services/collection.ts`](../src/server/services/collection.ts), `classify` dans [`adapters/openai.ts`](../src/server/adapters/openai.ts)) : titre et extrait nettoyés, nom de l'entreprise suivie, consigne qui rappelle que le texte est une donnée et non une instruction, réponse JSON imposée et bornée (160 jetons, température 0, délai de 15 s). Le modèle rend une catégorie, une importance éditoriale de 0 à 100 (90 et plus : levée majeure, acquisition, contrat ou implantation structurants ; 70–89 : annonce substantielle ; 50–69 : actualité ordinaire ; moins de 50 : contenu promotionnel ou reprise sans nouveauté) et un motif d'une phrase. Une réponse hors format (catégorie inconnue, importance hors de 0–100, motif vide) est ignorée : la publication est ingérée comme sans lecture. L'évaluation est enregistrée sur le signal (`assessment` : catégorie, importance, motif, modèle) et resservie à chaque recalcul du score (ajout d'une publication, fusion, changement de grille) ; une publication rattachée à un signal existant ne change pas la lecture de ce signal. Chaque lecture est comptée (`classification`, 0,005 €) dans la réservation du lot.

### Regroupement d'un même événement

`decideCluster` décide du rattachement d'une observation :

- Sans entreprise, l'observation crée toujours un nouveau signal.
- Les candidats sont les signaux de la même entreprise créés dans les 8 derniers jours (`CLUSTER_WINDOW_DAYS + 1`) dont la date de référence (date d'événement, à défaut de création) est à 7 jours au plus de la date de l'observation (publication, à défaut collecte).
- Si l'extrait est similaire à au moins 0,8 à celui d'une observation d'un candidat, l'observation est rattachée à ce candidat quelle que soit la catégorie : c'est une reprise.
- Sinon, seuls les candidats de même catégorie sont comparés sur les titres. Une similarité d'au moins 0,5 (`CLUSTER_SIMILARITY`) rattache l'observation. Une similarité d'au moins 0,3 (`UNCERTAIN_SIMILARITY`) crée un nouveau signal avec une revue `fusion_incertaine` (« Proche du signal … : fusion à confirmer »). En dessous, un nouveau signal est créé.

Les homonymies et les fusions incertaines sont ainsi soumises à revue humaine (§3.2) : la revue s'affiche sur le signal et se résout par rattachement, fusion ou défusion.

Le collecteur réel ne fournit jamais de date d'événement : la date de référence d'un signal collecté est donc sa date de création. Une publication antérieure de plus de 7 jours à cette date n'est jamais rattachée par `decideCluster`, même si elle reprend le même communiqué. La première collecte d'une source, qui peut ramener des publications vieilles de 30 jours, crée donc des signaux distincts pour un même événement ancien, sans revue ; seule une fusion manuelle les réunit.

### Fusion et défusion

`POST /api/signals/:id/merge` (`signal.write`) fusionne les signaux `otherIds` (1 à 50) dans le signal `:id`. Les contrôles sont les suivants : un signal ne peut être fusionné avec lui-même (422 `invalid_merge`), tous les signaux doivent exister (404), et ils ne peuvent concerner deux entreprises différentes (422 `company_mismatch`). Les observations sont déplacées. Les articles, posts LinkedIn et éléments de newsletter des signaux absorbés sont repointés vers le signal cible ; un doublon dans une même édition est retiré. Les signaux absorbés sont supprimés. Le signal cible garde son statut, prend la confiance maximale et l'union des tags (six au plus), et sa revue est effacée. Il est reconstruit, avec préservation du score s'il est décidé, puis l'événement `signal.merge` est journalisé. Le statut et le motif propres aux signaux absorbés sont perdus ; seul le journal d'audit en garde trace.

`POST /api/signals/:id/split` (`signal.write`) détache les observations `observationIds` (1 à 200) dans un nouveau signal. Toutes doivent appartenir au signal et au moins une doit y rester (422 `invalid_split`). Le nouveau signal est au statut `nouveau`, de même entreprise et catégorie, titré d'après la plus ancienne observation déplacée, et son résumé est produit par `enhanceSummary`. Une revue `fusion_incertaine` du signal d'origine est effacée. Les deux signaux sont reconstruits. La réponse est 201 `{ original, created }` et l'événement `signal.split` est journalisé.

### Dates

Chaque observation porte trois dates : `collectedAt` (toujours renseignée, heure du serveur à l'ingestion), `publishedAt` (fournie par la source ou `null`) et `eventDate` (`null` si inconnue). Aucun collecteur ne fournit de date d'événement : le collecteur réel ne lit que la date de publication (`pubDate`, `published` ou `updated`, ou la date d'un résultat Perplexity), et le collecteur simulé des tests n'en produit pas. Seul le jeu de démonstration contient des dates d'événement. Sans date d'événement, la nouveauté se calcule sur la plus ancienne date de publication : une publication de plus de 30 jours au moment de la création du signal perd 25 points (« événement antérieur de N jours à sa détection »). La collecte réelle écartant les publications de plus de 30 jours, ce retrait ne touche plus guère un signal collecté que s'il a absorbé, par fusion, des observations plus anciennes. Le signal reprend la plus ancienne valeur de chaque date parmi ses observations, recalculée à chaque reconstruction.

Une date inconnue n'est jamais inventée : elle reste `null` dans l'API et dans les exports JSON, vide dans les exports CSV. L'interface affiche la date de publication, à défaut la date d'événement (`signalDate` dans [`signal-utils.ts`](../src/components/signals/signal-utils.ts)), et « Date inconnue » si les deux manquent (`formatDate` dans [`labels.ts`](../src/components/kora/labels.ts)). La liste des sources du brouillon écrit « date inconnue ». La date de collecte sert de repli uniquement pour ordonner les observations et les signaux et calculer les fenêtres de regroupement ; elle n'est jamais présentée comme date de publication.

**Tri des signaux récents.** `GET /api/signals` ([`handlers/signals.ts`](../src/server/handlers/signals.ts)), avec `sort=recent` (valeur par défaut), trie par date d'actualité décroissante : date de publication, à défaut date d'événement, à défaut date de collecte ; à égalité, par date de création puis identifiant décroissants. Un signal créé aujourd'hui pour une publication d'il y a trois semaines se range donc à sa date de publication, et non en tête. `sort=score` trie par score décroissant, puis selon le même ordre. La page Signaux, qui fusionne deux requêtes, retrie avec la même règle (`byNewsDate` dans [`signal-utils.ts`](../src/components/signals/signal-utils.ts)). L'absence de toute date d'événement et de publication retire 8 points à la nouveauté, et une fraîcheur inconnue est signalée dans l'indicateur documentaire (« Date de publication inconnue »).

### Statuts d'un signal

| Statut | Libellé | Signification |
|---|---|---|
| `nouveau` | Nouveau | Créé par la collecte ou la défusion, pas encore examiné |
| `a_traiter` | À traiter | Retenu, en attente de rédaction |
| `en_revue` | En revue | Un article est en cours |
| `surveille` | Surveillé | Suivi sans rédaction immédiate |
| `traite` | Traité | Article publié ou exporté, ou marqué traité à la main ; décision figée |
| `rejete` | Rejeté | Écarté avec motif ; décision figée |

```mermaid
stateDiagram-v2
  [*] --> nouveau : collecte ou défusion
  state "Statuts non rejetés" as actifs {
    nouveau --> a_traiter : À traiter
    nouveau --> surveille : Surveiller
    a_traiter --> surveille : Surveiller
    surveille --> a_traiter : À traiter
    nouveau --> en_revue : création d'article
    a_traiter --> en_revue : création d'article
    surveille --> en_revue : création d'article
    en_revue --> traite : publication de l'article
    a_traiter --> traite : Traité
    traite --> a_traiter : À traiter
  }
  actifs --> rejete : Rejeter avec motif
  rejete --> actifs : Restaurer, vers a_traiter
```

Le diagramme montre les transitions automatiques et les principales actions de l'interface (`StatusActions`). Depuis tout statut autre que `rejete`, l'interface propose « Surveiller », « À traiter », « Traité » et « Rejeter » ; depuis `rejete`, seulement « Restaurer », qui ramène le signal en `a_traiter`. Le serveur, lui, accepte toute transition par `PATCH /api/signals/:id` (`signal.write`) ; seul le passage à `rejete` exige un motif (422 `reason_required`). Chaque changement est journalisé (`signal.status`, avec le motif). Les transitions automatiques sont les suivantes :

- La création d'un article fait passer le signal en `en_revue`, sauf s'il est `traite`.
- Une publication réussie de l'article le fait passer en `traite`, sauf s'il est `traite` ou `rejete`.
- Un signal `rejete` ne peut pas donner lieu à un article (422 `signal_rejected`).

Les endpoints des signaux, de la fusion, de la défusion et des grilles sont décrits dans [Signaux et grilles de score](03-reference-api.md#7-signaux-et-grilles-de-score).

## Workflows WF1 à WF6

Les six workflows sont ceux du §6 du cahier des charges. Les endpoints cités sont détaillés dans la [Référence API](03-reference-api.md).

| Workflow | Objet | Déclencheur | Rôles |
|---|---|---|---|
| WF1 | Collecte et classement | Bouton « Lancer la collecte » ou « Réessayer » | rédacteur, administrateur |
| WF2 | Sujet sélectionné vers brouillon sourcé | Bouton « Rédiger » sur un signal | rédacteur ; validateur pour l'approbation |
| WF3 | Import d'un article humain | Dépôt d'un fichier DOCX ou TXT | rédacteur, administrateur |
| WF4 | Post LinkedIn | Création depuis un article ou un signal | rédacteur ; validateur pour l'approbation, la publication et l'export |
| WF5 | Newsletter | Création d'une édition ou interrupteur « Inclure dans la prochaine édition » | rédacteur ; validateur pour l'approbation et l'export |
| WF6 | Corrections et référentiel | Enregistrement d'une version humaine après une version KORA | automatique ; administrateur pour la décision |

### WF1 — Collecte et classement

**Déclencheur.** `POST /api/collect` collecte toutes les sources actives ; `POST /api/sources/:id/collect` collecte une source. La collecte est uniquement manuelle : le champ `frequency` des sources est informatif et la collecte quotidienne planifiée du §12 n'est pas implémentée.

**Rôles.** Action `collect` : rédacteur et administrateur.

**Collecteur réel.** Hors tests, l'adaptateur est `RealCollector` (`collecteur-rss-google-v1`, [`adapters/collector.ts`](../src/server/adapters/collector.ts)) ; `SimulatedCollector` ne sert plus qu'aux tests Vitest ([`adapters/index.ts`](../src/server/adapters/index.ts)). L'adresse lue dépend du type de source :

| Type de source | Adresse lue |
|---|---|
| `recherche_web` | Google News RSS sur le nom de l'entreprise, sauf si l'URL de la source pointe déjà vers `news.google.com` : elle est alors lue telle quelle |
| `actualites` dont l'URL ne contient ni `rss`, ni `feed`, ni `atom`, ni `xml` | Google News RSS sur le nom de l'entreprise, avec la même exception |
| `actualites` à URL de flux, et tous les autres types | URL de la source |

`googleNewsUrl` construit `https://news.google.com/rss/search?q=…&hl=fr&gl=FR&ceid=FR:fr`, la requête étant le nom de l'entreprise entre guillemets, à défaut le libellé de la source. Pour une page d'actualités ordinaire, l'URL déclarée n'est donc jamais lue. La réponse est ensuite traitée ainsi :

1. Si elle n'est pas un flux (aucune balise `rss`, `feed` ou `rdf:RDF`), le collecteur cherche dans la page une balise `<link>` de type `application/rss+xml` ou `application/atom+xml` et lit le flux annoncé : c'est la découverte automatique. Sans flux annoncé, il essaie les adresses habituelles du site (`/feed/`, `/rss`, `/feed.xml`, `/rss.xml`) ; si aucune n'est un flux, la tentative est un échec définitif `NO_FEED` (« Aucun flux RSS annoncé sur cette page, ni aux adresses habituelles … : rien à collecter. Indiquez l'adresse du flux ou d'une page d'actualités. ») : la source passe en `erreur`, sans réessai, jusqu'à ce que son adresse soit corrigée.
2. `parseFeed` extrait par expressions régulières les entrées RSS 2.0 (`item`) et Atom (`entry`) : titre, lien, date (`pubDate`, `published`, à défaut `updated`) et description (`description`, `summary` ou `content`). Le média est lu dans la balise `source` de Google News, dont le nom est retiré de la fin du titre ; à défaut, c'est l'entreprise de la source, ou le nom d'hôte pour une source sans entreprise.
3. Pour une source lue par Google News et rattachée à une entreprise, les résultats de la recherche Perplexity sont ajoutés (voir l'enrichissement ci-dessous).
4. Pour une source d'entreprise qui ne passe pas par Google News, et dont l'hôte ne se termine pas par le domaine de l'entreprise, seules les entrées dont le titre ou la description contient le nom ou un alias sont gardées. Ce filtre est une simple inclusion de chaîne, insensible à la casse mais sensible aux accents et sans frontière de mot, à la différence de `matchCompany`.
5. Règle de fraîcheur (`FRESHNESS_DAYS = 30`) : seules les entrées publiées depuis 30 jours au plus sont gardées. Une entrée sans date est écartée, car sa fraîcheur n'est pas vérifiable ; une entrée datée de plus d'un jour dans le futur l'est aussi (certains agendas d'événements mettent la date de l'événement à la place de la date de publication). La liste est triée de la plus récente à la plus ancienne.
6. La date d'événement vaut toujours `null`.

Chaque requête est interrompue après 15 secondes (code `TIMEOUT`). Un statut HTTP d'erreur donne le code `HTTP_<statut>`, une autre erreur réseau le code porté par l'erreur, à défaut `NETWORK` ; seuls `HTTP_403` et `HTTP_404` sont marqués non transitoires. Les contrôles réseau (redirections, adresses internes) sont décrits dans [Collecteur web](06-securite-et-flux-tiers.md#collecteur-web).

Pour Google News, le lien d'une entrée pointe vers `news.google.com` et non vers le site du média, et la description ne contient qu'un lien titré suivi du nom du média : l'extrait nettoyé se réduit au titre, répété, et au nom du média. Le classement, l'extraction des montants, l'indicateur documentaire et la liste des faits du dossier ne disposent donc, pour ces observations, que du titre. Le rattachement par le domaine de l'URL (confiance 97) ne s'y applique jamais.

**Enrichissement Perplexity.** Pour une source lue par Google News (`recherche_web`, ou `actualites` sans URL de flux) et rattachée à une entreprise, le collecteur interroge aussi Perplexity, en parallèle de Google News, par la passerelle de connexion de la plateforme d'hébergement (`perplexitySearch`). La requête est `"<nom de l'entreprise>" Grenoble actualité entreprise`, limitée à cinq résultats publiés dans le dernier mois et interrompue après 20 secondes. Un résultat n'est retenu (`mapPerplexityResults`) que s'il a un titre, une URL et une date lisible, s'il n'est pas hébergé sur le domaine de l'entreprise ou un de ses sous-domaines (couverts par ses propres sources), et si son titre ou son extrait contient le nom ou un alias (même inclusion de chaîne que le filtre des flux généralistes). `mergeEnrichment` écarte ensuite les résultats déjà présents dans Google News, par URL ou par titre : Google News ne donnant que des liens de redirection, deux titres normalisés d'au moins 25 caractères dont l'un commence par l'autre désignent le même article. Le média d'un résultat Perplexity est son nom d'hôte. Les résultats retenus suivent ensuite la règle de fraîcheur et la chaîne d'ingestion communes. Chaque élément porte sa provenance (`via` : `flux`, `google_news` ou `perplexity`), conservée sur l'observation et reprise dans l'export CSV des observations. Le bilan de la recherche est enregistré sur la collecte (`enrichment` : statut `ok`, `non_configure` ou `erreur`, résultats reçus, résultats retenus, observations ajoutées, message). Sans les secrets `LOVABLE_API_KEY` et `PERPLEXITY_API_KEY`, le statut est `non_configure` (« Secret manquant : … ») ; une erreur HTTP ou un délai dépassé donne `erreur`. Dans les deux cas, la lecture de Google News suit son cours. L'appel à Perplexity n'a pas de ligne de consommation propre (voir le coût ci-dessous).

**Relais quand Google News échoue.** Si la lecture de Google News échoue alors que Perplexity a répondu (statut `ok`, même sans résultat retenu), la collecte n'échoue pas : elle se poursuit avec les seuls résultats Perplexity et porte un avertissement, `errorCode` reprenant le code de l'échec (`HTTP_<statut>`, `TIMEOUT`, `NETWORK`) et `errorMessage` le motif préfixé de « Google News : ». Si Perplexity n'a pas répondu ou n'est pas configuré, l'échec de Google News est un échec de la collecte, réessayé comme les autres ; chaque essai relance alors aussi la recherche Perplexity.

**Source Google News automatique.** `POST /api/companies` ([`handlers/registry.ts`](../src/server/handlers/registry.ts)) crée, avec l'entreprise, une source `recherche_web` intitulée `Google News — <nom>`, d'URL `googleNewsUrl(nom)`, de fréquence quotidienne et d'accès `en_attente`. La réponse porte donc `sourceCount: 1`. Cette source n'est pas contrôlée par `assertQuota("sources")`, que seul `POST /api/sources` appelle : le nombre de sources peut ainsi dépasser le plafond de 300. Seul l'événement `company.create` est journalisé. L'URL étant lue telle quelle, un renommage de l'entreprise ne change pas la requête : la collecte continue d'interroger Google News sur l'ancien nom (la recherche Perplexity, elle, utilise le nom courant). Les entreprises importées par script n'ont pas reçu cette source : [`db/data/2026-10-15_veille_presse_entreprises.sql`](../db/data/2026-10-15_veille_presse_entreprises.sql) la crée, avec la même URL, pour chaque entreprise qui n'a encore aucune source `recherche_web` (identifiant `src_<entreprise>_presse`, événement `source.create` au nom de « KORA »). Le script est rejouable sans effet.

**Étapes.**

1. Une source désactivée est refusée (409 `source_disabled`) ; la collecte globale l'ignore.
2. Une seule collecte à la fois : la collecte globale comme la collecte d'une source prennent le verrou `collecte` (durée de vie de 5 minutes, le temps d'un lot), sans attente. Si une autre collecte le détient, la demande répond aussitôt 409 `collection_in_progress` (« Une collecte est déjà en cours : réessayez dans quelques minutes. ») et rien n'est enregistré. Deux collectes simultanées partiraient du même état et enregistreraient deux fois les mêmes publications. La collecte globale se fait par lots (8 sources par défaut, 25 au plus) : le verrou ne couvre qu'un lot et se libère entre deux lots ; les lots d'une même collecte ne reprennent jamais une source déjà collectée depuis son début (`since`).
3. Le coût est réservé avant l'appel (`paidCall`, type `search_query`, estimation `COSTS.search + 5 × COSTS.observation`, soit 0,117 € par source, réservée en une fois pour tout le lot). En cas de refus, la collecte est enregistrée au statut `bloque_quota` avec le code `budget_exhausted`. Une collecte unitaire répond alors 402 ; la collecte globale marque aussi `bloque_quota` toutes les sources du lot et les sources restantes, répond 200 avec ces collectes et `remaining: 0`. Si le budget est seulement occupé (verrou `budget` non obtenu en 5 secondes, 409 `budget_busy`), seule cette exécution est enregistrée `echec`, avec le code `budget_busy` et le message « Le budget API est en cours de mise à jour : réessayez dans quelques secondes. » : le collecteur n'est pas appelé, rien n'est facturé, la source garde son état (ni passage en `erreur`, ni notification, ni mise à jour de la date de passage) et la collecte globale continue avec la source suivante. Une collecte unitaire répond 200 avec cette exécution en échec.
4. Le collecteur est appelé jusqu'à trois fois (`MAX_ATTEMPTS`) dans la même requête, sans délai entre les essais, seulement si l'échec est transitoire (`transient: true` : délai dépassé, erreur réseau, HTTP 5xx) ; un refus HTTP 403 ou 404 n'est pas réessayé et le compteur d'essais vaut 1. La recherche Perplexity, menée en parallèle de Google News, n'est lancée qu'une fois par exécution : un réessai de Google News réutilise son résultat. Dans un lot, les lectures réseau de trois sources se font en parallèle, puis l'ingestion est faite en série, source par source, dans l'ordre du lot.
5. En cas d'échec, la source passe en `erreur` avec le code et le motif (`failureCode`, `failureReason`) et un compteur d'essais limité à 3. Une notification `erreur_source` n'est émise qu'au premier échec, pas si la source était déjà en erreur. La collecte est enregistrée au statut `echec`.
6. En cas de succès, les entrées sont ingérées dans l'ordre, de la plus récente à la plus ancienne, jusqu'à cinq observations nouvelles (`MAX_ITEMS`, voir [Chaîne d'ingestion](#chaîne-dingestion)) : une publication déjà connue ne prend plus de place dans cette limite. Si un flux publie plus de cinq entrées entre deux collectes, les suivantes sont reprises aux collectes suivantes, tant qu'elles figurent encore dans le flux et datent de 30 jours au plus. La source repasse en `ok`, la date de dernière réussite est mise à jour et le motif d'échec effacé. La collecte est au statut `succes` si au moins une observation nouvelle a été créée, `succes_sans_actualite` sinon ; elle porte l'avertissement éventuel (`NO_FEED`, ou échec de Google News relayé par Perplexity) dans `errorCode` et `errorMessage`, et le bilan Perplexity dans `enrichment`.
7. La consommation enregistrée est d'une recherche (0,012 €), même en cas d'échec, et d'une observation (0,021 €) par publication renvoyée dont l'URL est acceptée et encore inconnue, dans la limite de cinq. Les publications déjà connues ne sont plus facturées.

**Coût de la collecte réelle.** Les flux RSS et Google News sont gratuits, mais chaque exécution reste imputée au budget comme un appel payant, aux coûts estimés d'un fournisseur de recherche. Une source sans nouveauté coûte 0,012 € par collecte, et 0,117 € au plus avec cinq publications nouvelles. Pour 150 sources, une collecte complète coûte entre 1,80 € et 17,55 € environ : même au coût maximal, le budget mensuel de 150 € permet huit collectes complètes. La recherche Perplexity n'est pas imputée à part : son coût réel n'est pas mesuré.

**États.** Une source a un accès `ok`, `erreur`, `en_attente` ou `desactivee`. Une collecte (`CollectionRun`) est `succes`, `succes_sans_actualite`, `echec` ou `bloque_quota`. Une requête en échec n'est jamais présentée comme « succès sans actualité ». Une page lue sans flux détectable reste au statut `succes_sans_actualite`, mais l'avertissement `NO_FEED` et son motif sont enregistrés sur la collecte et affichés dans l'historique : l'utilisateur voit qu'aucune publication n'a pu y être lue, comme le demande le §6. L'accès d'une source ne peut pas être mis manuellement à `erreur` (422 `invalid_access`) ; une modification d'URL le repasse en `en_attente`.

**Contrôles.** Droit `collect`, une seule collecte à la fois, filtrage des URL collectées, réservation budgétaire, filtre par nom des flux généralistes et des résultats Perplexity, fraîcheur de 30 jours avec date obligatoire, dédoublonnage par URL canonique, nettoyage du texte.

**Sorties.** Collectes, observations et signaux `nouveau` ; notifications (signal prioritaire, erreur de source, alertes de quota) ; événement `collect.all` pour la collecte globale. La collecte d'une seule source n'est pas journalisée.

**Endpoints.** [Sources et collecte](03-reference-api.md#6-sources-et-collecte).

### WF2 — Sujet sélectionné vers brouillon sourcé

**Déclencheur.** `POST /api/articles` avec `signalId` et, en option, `angle`.

**Rôles.** Rédacteur et administrateur créent, modifient et soumettent (`article.write`) ; validateur et administrateur approuvent ou rejettent (`article.decide`) ; l'arbitrage du dossier factuel est ouvert aux deux groupes.

**Contrôles avant génération.** Le signal doit exister (404) et ne pas avoir déjà d'article (409 `article_exists`). Il ne doit pas être rejeté (422 `signal_rejected`). Le quota d'articles doit être disponible (422 `quota_exceeded`) et le budget aussi (402 `budget_exhausted`, coût réservé `COSTS.article` = 0,45 €).

**Génération du dossier.** `generateDossier` ([`adapters/text-model.ts`](../src/server/adapters/text-model.ts)) produit :

- les faits (`factChecks`) : la première phrase de chaque extrait, regroupée avec les phrases similaires à au moins 0,5 ; les reprises sont rattachées au fait le plus proche ;
- leur statut : `etaye` si le fait a une source directe ou au moins deux domaines indépendants, `non_corrobore` sinon, et un fait `contradictoire` par contradiction détectée ;
- les angles (quatre au plus), le plan, et un brouillon composé du titre, du chapô, du corps, de l'extrait (200 caractères), du titre SEO (60 caractères), des catégories et des tags.

Le premier fait forme le chapô, les suivants le corps. Les faits non corroborés et les contradictions sont précédés de « [À vérifier] » dans le chapô comme dans le corps. Le corps se termine par une section « Sources consultées » (média, titre, date, URL). Aucune citation n'est créée. Le brouillon peut ensuite être réécrit par OpenAI (voir [Amélioration par OpenAI](#amélioration-par-openai)) ; les faits, angles et plan ne le sont jamais.

**Résultat.** L'article est créé au statut `brouillon`, d'origine `kora`, sans auteur humain, avec une version 1 signée « KORA ». Le signal passe en `en_revue` (sauf s'il est `traite`) et l'événement `article.create` mentionne les contradictions à arbitrer.

**Arbitrage du dossier factuel.** `PATCH /api/articles/:id/fact-checks/:fid` fixe le statut d'un fait à `etaye` ou `non_corrobore`, avec une note facultative, et enregistre l'arbitrage (`resolution` : nom, date, note). L'événement `article.fact_check` est journalisé. L'arbitrage ne crée pas de version et n'invalide pas les approbations. Seuls les faits `contradictoire` bloquent l'approbation et la publication ; un fait `non_corrobore` ne bloque pas, son marqueur reste dans le texte.

**Versions.** `POST /api/articles/:id/versions` enregistre une nouvelle version signée par l'utilisateur. `POST /api/articles/:id/restore` recopie le contenu d'une version antérieure dans une nouvelle version, avec la note « Restauration de la version N » ; restaurer la version courante répond 409 `already_current`, une version inexistante 422 `version_not_found`. Dans les deux cas (`pushVersion`), l'historique est conservé, toutes les approbations valides sont invalidées avec le motif « Contenu modifié après approbation », et le statut évolue comme suit : un article `approuve`, `programme` ou `publie` repasse `en_revue`, un article `rejete` repasse `brouillon`, les autres statuts sont inchangés. Une version humaine qui suit une version KORA déclenche WF6.

**Cycle de vie de l'article.**

```mermaid
stateDiagram-v2
  [*] --> brouillon : création WF2 ou conversion WF3
  brouillon --> en_revue : soumettre
  rejete --> en_revue : soumettre
  rejete --> brouillon : nouvelle version ou restauration
  en_revue --> approuve : approuver sans date
  en_revue --> programme : approuver avec date
  approuve --> programme : approuver avec date
  programme --> approuve : approuver sans date
  en_revue --> rejete : rejeter avec motif
  approuve --> rejete : rejeter avec motif
  programme --> rejete : rejeter avec motif
  approuve --> en_revue : nouvelle version ou restauration
  programme --> en_revue : nouvelle version ou restauration
  publie --> en_revue : nouvelle version ou restauration
  approuve --> approuve : publier (brouillon WordPress ou export)
  programme --> programme : publier (brouillon WordPress ou export)
  note right of publie
    Atteint quand WordPress signale
    le contenu publié
  end note
```

La soumission (`POST /api/articles/:id/submit`) n'est possible que depuis `brouillon` ou `rejete` ; répétée sur un article `en_revue`, elle est sans effet ; depuis un autre statut, elle répond 409 `invalid_state`. Elle notifie les validateurs. L'approbation et le rejet sont décrits dans [Approbation et publication](#approbation-et-publication). La publication elle-même ne change pas le statut de l'article : KORA n'envoie à WordPress qu'un brouillon, mis en ligne par une personne dans WordPress. L'article passe en `publie`, avec `publishedAt`, lorsqu'une relecture du brouillon (`POST /api/articles/:id/wordpress/refresh`, ou un nouvel envoi) le trouve publié ou privé sur le site (`settleArticle` dans [`wordpress/publish.ts`](../src/server/wordpress/publish.ts)). Le statut `programme` enregistre une date sans qu'aucun planificateur ne l'exploite.

**Endpoints.** [Articles, dossier factuel et publication](03-reference-api.md#8-articles-dossier-factuel-et-publication).

### WF3 — Import d'un article humain

**Déclencheur.** `POST /api/imports` en `multipart/form-data` avec les champs `file` et `author`.

**Rôles.** Action `import.write` (rédacteur, administrateur) pour l'import, les décisions et la conversion.

**Étapes.**

1. Contrôles : corps multipart (400 `multipart_required`), fichier présent (400 `file_required`), auteur renseigné (400 `author_required`), taille (413 `file_too_large`), format (415 `unsupported_format`), quota de stockage (422 `quota_exceeded`), extraction (415 `invalid_encoding` ou `invalid_docx`).
2. Extraction du texte et calcul des propositions (voir [Imports humains](#imports-humains)). L'événement `import.create` est journalisé.
3. Décision sur chaque proposition par `PATCH /api/imports/:id/proposals/:pid` (`import.proposal`).
4. Conversion en article par `POST /api/imports/:id/convert` (`import.convert`).

```mermaid
stateDiagram-v2
  state "Import non converti" as ouvert {
    [*] --> en_attente
    en_attente --> acceptee : accepter
    en_attente --> refusee : refuser
    acceptee --> refusee : refuser
    refusee --> acceptee : accepter
    acceptee --> en_attente : remettre en attente
    refusee --> en_attente : remettre en attente
  }
  [*] --> ouvert : dépôt du fichier
  ouvert --> converti : convertir
  converti --> [*]
  note right of converti
    Seules les propositions acceptées sont appliquées.
    Toute décision ultérieure répond 409 already_converted.
  end note
```

**Sorties.** Un enregistrement d'import (original, texte extrait, propositions), puis un article au statut `brouillon`, d'origine `import_humain`, dont l'auteur et le signataire de la version 1 sont l'auteur déclaré. L'article suit ensuite le cycle de vie de WF2.

**Endpoints.** [Imports humains](03-reference-api.md#9-imports-humains).

### WF4 — Post LinkedIn

**Déclencheur.** `POST /api/linkedin` avec `articleId` ou `signalId`.

**Rôles.** Rédacteur et administrateur créent, modifient et soumettent (`linkedin.write`) ; validateur et administrateur approuvent (`linkedin.decide`) et publient ou exportent (`publish`). Chaque utilisateur, quel que soit son rôle, peut relier son propre compte LinkedIn.

**Contrôles à la création.** L'article ou le signal doit exister (404). Un seul post en préparation est admis par contenu : un post non `exporte` ni `publie` sur le même article, ou sur le même signal sans article, répond 409 `post_exists`. Le quota `linkedin_posts` (422) et le budget (402, `COSTS.linkedin` = 0,08 €) doivent être disponibles. Le serveur accepte un article dans n'importe quel statut, y compris `brouillon`, alors que le cahier des charges décrit WF4 comme le « post LinkedIn d'un article approuvé » ; l'interface se contente de proposer d'abord les articles approuvés.

**Génération.** Le gabarit produit deux variantes à partir du titre et d'une accroche : chapô de la version courante, à défaut extrait de l'article, à défaut résumé du signal, sans le préfixe « [À vérifier] ». Les hashtags sont `#Inovallée`, `#Grenoble` et jusqu'à deux thématiques. OpenAI peut remplacer ces variantes (trois au plus). Le post est créé au statut `brouillon`, version 1.

**Modification.** `PATCH /api/linkedin/:id` modifie les variantes (une à quatre, texte de 3 000 caractères au plus, quinze hashtags au plus) ou la variante sélectionnée. Un post `publie` n'est pas modifiable (409). Sans changement effectif, rien n'est versionné. Sinon la version augmente, l'approbation est invalidée et un post `approuve` ou `exporte` repasse `a_valider`.

**Soumission, approbation, export.** La soumission n'est possible que depuis `brouillon` (sans effet si le post est déjà `a_valider`). L'approbation exige la version courante (409 `version_mismatch`) et un statut `a_valider` ou `approuve` (409 `invalid_state`) ; elle remplace l'approbation précédente. `GET /api/linkedin/:id/export` renvoie le texte de la variante sélectionnée et ses hashtags, sans effet de bord ; si la version courante n'est pas approuvée, le fichier commence par « [APERÇU — version non approuvée, ne pas publier] ». Il n'existe pas de rejet de post.

**Compte LinkedIn de l'utilisateur.** Chaque utilisateur relie son propre compte ([`handlers/connectors.ts`](../src/server/handlers/connectors.ts)) ; ces routes n'exigent aucun droit, mais seul un validateur ou un administrateur peut ensuite publier.

- `POST /api/me/linkedin/connect` renvoie l'adresse de consentement LinkedIn (autorisations `openid`, `profile` et `w_member_social`) et ouvre, pour cet utilisateur seulement, une connexion en attente valable 10 minutes ; une nouvelle demande remplace la précédente. L'adresse de retour est bâtie sur `KORA_PUBLIC_URL` (à défaut, l'origine de la requête) ; le consentement exige le secret `LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY`.
- Le consentement a lieu dans une fenêtre surgissante. La page publique `/api/oauth/linkedin/return` ([`return.ts`](../src/routes/api/oauth/linkedin/return.ts)) transmet à la fenêtre de KORA, et à elle seule (même origine), le code à usage unique renvoyé par la passerelle. Un échec y est transmis avec son motif. Si la passerelle indique que l'accès hors ligne n'est pas autorisé (`offline_access_allowed=false`), aucune clé n'est délivrée : la connexion est traitée comme un échec (`offline_access_disabled`), puisque KORA a besoin d'une clé pour publier.
- `POST /api/me/linkedin/complete` échange ce code, par la passerelle de connexion de la plateforme d'hébergement, contre une clé de connexion. Il exige la connexion en attente ouverte par le même utilisateur, consommée une seule fois (sinon 409 `linkedin_connect_not_pending`), et un retour du connecteur LinkedIn (400 `missing_code`, `connector_mismatch`). La clé est stockée chiffrée (AES-256-GCM, secret `APP_USER_CONNECTION_KEY_SECRET`) dans la table `app_user_connections`, une ligne par utilisateur ([`appUserConnections.server.ts`](../src/server/appUserConnections.server.ts)) ; le navigateur ne la reçoit jamais. Audit `linkedin.connect`.
- `GET /api/me/linkedin` donne l'état : relié (`connected`, nom et identifiant du membre lus sur LinkedIn), autorisation à renouveler (`reconnectRequired`, quand la passerelle répond 401 avec un type `credential_…`), autre erreur de LinkedIn ou de la passerelle (`error: "linkedin_unavailable"`) ou non relié. Une clé illisible répond 503 `linkedin_unavailable`.
- `POST /api/me/linkedin/disconnect` révoque l'accès auprès de la passerelle puis supprime la clé. Audit `linkedin.disconnect`. Une clé illisible (secret changé, ligne altérée) est supprimée sans révocation, ici comme à la reconnexion, et l'audit le signale.
- La suppression d'un utilisateur révoque et supprime aussi sa connexion et sa connexion en attente. Sans base (tests, développement local), aucune connexion n'est lue : la publication est toujours un export.

**Publication.** `POST /api/linkedin/:id/publish` (droit `publish`, [`handlers/distribution.ts`](../src/server/handlers/distribution.ts)) publie la version courante depuis le compte relié de la personne qui clique, ou consigne un export si elle n'en a pas.

1. Une publication réussie de même clé d'idempotence (post, version, `linkedin`) est renvoyée telle quelle (200), sans nouvel envoi. Un export ne clôt pas la version : tant que la personne qui clique n'a pas de compte relié, l'export existant est renvoyé (200), sans nouvelle tentative ; une fois son compte relié, la même version est publiée, et l'export reste dans l'historique.
2. Une tentative `verification_requise` de même clé bloque tout nouvel envoi (409 `publication_verification_required`) tant qu'une personne n'a pas tranché (voir [Reprise après une réponse ambiguë](#reprise-après-une-réponse-ambiguë)).
3. `checkPublishable` exige l'approbation de la version courante (voir [Contrôle juste avant l'envoi](#contrôle-juste-avant-lenvoi)) ; un refus est consigné `bloque` (422).
4. Le verrou `linkedin-publish:<post>:v<version>` (2 minutes, sans attente) écarte un second envoi simultané : la seconde demande reçoit 409 `publication_in_progress`. Sous le verrou, les tentatives et le post sont relus.
5. Avant l'appel, une tentative `verification_requise` (mode `publication`, code `linkedin_confirmation_pending`) est enregistrée : si l'exécution s'interrompt après l'envoi, elle subsiste et bloque toute republication.
6. Le texte envoyé est la variante retenue, une ligne vide et les hashtags (préfixés `#`). Vide ou au-delà de 3 000 caractères, il est refusé avant tout appel. KORA lit l'identité du membre (`/v2/userinfo`, 10 secondes), puis crée le post (`POST /v2/ugcPosts`, 20 secondes) sur son profil personnel (`urn:li:person:<membre>`), texte seul, visibilité publique, par la passerelle ([`linkedin/publish.ts`](../src/server/linkedin/publish.ts)). Ce n'est pas la page entreprise d'Inovallée.
7. La tentative est complétée selon le résultat :
   - post créé : `succes`, `remoteId` égal à l'URN du post, message portant le lien `https://www.linkedin.com/feed/update/<URN>` ; post `publie` ; audit `publication.success` ; 201 ;
   - autorisation expirée, révoquée ou incomplète (401, 403) : `echec`, code `linkedin_reconnect_required`, 422 ;
   - refus net (texte vide ou trop long, contenu refusé, trop de requêtes, identité illisible, coupure avant la création) : `echec`, code `linkedin_api_error`, 422, audit `publication.failed` ;
   - résultat incertain (coupure ou délai dépassé pendant la création, erreur 5xx, réponse de succès sans identifiant, post signalé comme doublon) : `verification_requise`, code `linkedin_api_error`, 422, audit `publication.unconfirmed` ;
   - clé illisible : `echec`, 503 `linkedin_unavailable`, sans export de repli ; autre erreur interne : `echec`, code `linkedin_internal_error` ;
   - aucun compte relié : `succes` en mode `export`, code `linkedin_api_unavailable`, post `exporte`, audit `publication.success`, 201.
8. Le statut du post n'est écrit que si sa version n'a pas changé pendant l'appel.

La publication n'est pas imputée au budget, n'émet pas de notification et ne change pas le statut du signal. Les tests de [`linkedin-api.test.ts`](../src/test/server/linkedin-api.test.ts) (requête et traduction des refus), [`linkedin-concurrence.test.ts`](../src/test/server/linkedin-concurrence.test.ts) (double envoi, confirmation humaine) et [`securite-linkedin.test.ts`](../src/test/server/securite-linkedin.test.ts) (connexion en attente, droit de résolution, clé illisible) vérifient ces règles.

```mermaid
stateDiagram-v2
  [*] --> brouillon : création
  brouillon --> a_valider : soumettre
  a_valider --> approuve : approuver la version courante
  approuve --> approuve : approuver à nouveau
  approuve --> exporte : publish sans compte relié (export consigné)
  approuve --> publie : publish avec compte relié, ou présence confirmée
  approuve --> a_valider : modification des variantes
  exporte --> a_valider : modification des variantes
  brouillon --> brouillon : modification des variantes
  a_valider --> a_valider : modification des variantes
  note right of publie
    Post créé sur LinkedIn par l'API,
    ou présence confirmée par une personne
    après un résultat incertain.
    Un post publie n'est plus modifiable.
  end note
```

**Endpoints.** [LinkedIn](03-reference-api.md#10-linkedin).

### WF5 — Newsletter

**Déclencheur.** `POST /api/newsletters`, ou `PATCH /api/signals/:id` avec `inNewsletter: true`, qui crée l'édition courante si elle n'existe pas.

**Rôles.** Rédacteur et administrateur composent (`newsletter.write`) ; validateur et administrateur approuvent (`newsletter.decide`) et consignent l'export (`publish`). Le téléchargement des fichiers est ouvert à tous.

**Étapes.**

1. Création de l'édition, sous réserve du quota `newsletters` (cinq éditions créées dans le mois).
2. Ajout de sujets (signal ou article), avec un résumé payant par sujet.
3. Réordonnancement, modification des résumés, du titre et de l'introduction ; retrait de sujets.
4. Approbation de la version courante (`POST /api/newsletters/:id/approve`).
5. Export HTML ou texte : téléchargement sans effet (`GET /api/newsletters/:id/export?format=html|txt`) et, pour la version approuvée, consignation de l'export (`POST /api/newsletters/:id/export`).

**Contrôles.** Une édition exportée n'est plus modifiable (409 `invalid_state`). Un même sujet ne peut figurer deux fois (409 `already_in_newsletter`) ; deux ajouts simultanés du même sujet ne déclenchent qu'un résumé payant (voir [Créations simultanées](#créations-simultanées)). La consignation exige l'approbation de la version courante (409 `approval_missing`). L'approbation exige la version courante (409 `version_mismatch`) et au moins un sujet (422 `newsletter_empty`). Il n'y a ni étape de soumission ni rejet.

**Sorties.** Fichiers d'export ; à la première consignation de la version approuvée, une tentative de publication réussie en mode `export` et le passage en `exportee`. Aucun e-mail n'est jamais envoyé. Les règles de sélection, d'ordre et de rendu sont dans [Newsletter](#newsletter).

```mermaid
stateDiagram-v2
  [*] --> composition : création de l'édition
  composition --> composition : ajout, retrait, réordonnancement, édition
  composition --> approuvee : approuver la version courante
  approuvee --> composition : toute modification
  approuvee --> exportee : consignation de l'export (POST, droit publish)
  exportee --> [*]
  note right of exportee
    Édition figée : plus aucune modification.
    Les fichiers restent téléchargeables à l'identique.
  end note
```

**Endpoints.** [Newsletters](03-reference-api.md#11-newsletters).

### WF6 — Corrections et référentiel éditorial

**Déclencheur.** Automatique : l'enregistrement d'une version humaine qui suit une version signée « KORA » appelle `refreshProposals` ([`services/dna.ts`](../src/server/services/dna.ts)). Les règles peuvent aussi être créées et modifiées manuellement.

**Rôles.** Les rédacteurs produisent les corrections ; seul l'administrateur décide des propositions et modifie les règles (`rule.write`).

**États.** Une proposition est `proposee`, puis `acceptee` ou `refusee` ; une proposition déjà décidée répond 409 `already_decided`.

**Sorties.** Règles versionnées ; événements `rule.create`, `rule.update`, `rule.proposal`. Le détail est dans [Editorial DNA](#editorial-dna).

**Endpoints.** [Editorial DNA](03-reference-api.md#12-editorial-dna).

### Créations simultanées

Les données sont lues puis réécrites sans transaction : deux requêtes simultanées (double clic, deux onglets, deux personnes) partiraient du même état. Les opérations qui créent un contenu, déclenchent un appel payant, publient ou figent une décision prennent donc un verrou nommé, stocké dans le dépôt avec une durée de vie (`withLock` dans [`services/locks.ts`](../src/server/services/locks.ts), `acquireLock` pour WordPress, LinkedIn et les utilisateurs). La requête qui ne l'obtient pas reçoit un 409, aussitôt ou après une courte attente, sans rien écrire ni rien facturer. Le verrou est libéré à la fin de l'opération ; si l'instance s'arrête avant, il expire seul.

| Opération | Verrou et durée de vie | Attente | Refus |
|---|---|---|---|
| Collecte globale ou d'une source | `collecte`, 15 min | aucune | 409 `collection_in_progress` |
| Dossier et brouillon d'un signal | `article-create:<signal>`, 2 min | aucune | 409 `generation_in_progress` |
| Post LinkedIn d'un article ou d'un signal | `linkedin-create:<article ou signal>`, 2 min | aucune | 409 `generation_in_progress` |
| Création de l'édition de newsletter courante | `newsletter-current`, 30 s | 5 s | 409 `newsletter_busy` |
| Ajout d'un sujet à une édition (résumé payant) | `newsletter-item:<édition>:<sujet>`, 2 min | aucune | 409 `generation_in_progress` |
| Écriture du sujet ajouté dans l'édition | `newsletter-write:<édition>`, 30 s | 5 s | 409 `newsletter_busy` |
| Conversion d'un import | `import-convert:<import>`, 30 s | aucune | 409 `conversion_in_progress` |
| Décision sur une proposition de règle | `rule-proposal:<proposition>`, 30 s | aucune | 409 `already_decided` |
| Envoi ou rafraîchissement WordPress | `wordpress-publish:<article>`, 2 min | aucune | 409 `publication_in_progress` |
| Publication d'un post LinkedIn | `linkedin-publish:<post>:v<version>`, 2 min | aucune | 409 `publication_in_progress` |
| Création, modification, suppression ou réinvitation d'un compte | `users:admins`, 60 s | aucune | 409 `users_busy` |
| Réservation et libération du budget, alertes | `budget`, 10 s | 5 s | 409 `budget_busy` |

Sous le verrou, l'état est relu avant d'agir : la seconde demande trouve l'article ou le post déjà créé (409 `article_exists` ou `post_exists`) ou le sujet déjà présent dans l'édition (409 `already_in_newsletter`). Une seule génération payante a donc lieu par contenu, et un seul résumé par sujet de newsletter. Après le résumé, l'élément est écrit sous le verrou de l'édition, sur l'édition relue : une modification faite pendant la génération n'est pas écrasée. Le verrou des comptes protège aussi la règle du dernier administrateur (422 `last_admin`) : deux administrateurs qui se retireraient mutuellement le rôle ne passent pas tous deux le contrôle.

## Approbation et publication

### Contenu d'une approbation

Une approbation (`Approval`, [`store/records.ts`](../src/server/store/records.ts)) enregistre :

| Champ | Contenu |
|---|---|
| `id` | Identifiant `apv_…` |
| `version` | Numéro de la version approuvée |
| `channel` | `wordpress`, `linkedin` ou `newsletter` |
| `approvedBy` | Nom affiché du validateur |
| `approvedAt` | Date de l'approbation |
| `scheduledAt` | Date de programmation ou `null` |
| `valid` | `true` tant que l'approbation n'est pas invalidée |
| `invalidatedAt`, `invalidatedReason` | Date et motif de l'invalidation |

Un article peut porter une approbation valide par canal ; une nouvelle approbation sur le même canal invalide la précédente avec le motif « Remplacée par une nouvelle approbation ». Un post LinkedIn et une édition de newsletter ont une seule approbation. Par rapport au §6, l'identité du validateur est son nom affiché et non son identifiant, et les médias ne sont pas couverts : le modèle de données n'en contient pas.

L'approbation d'un article (`POST /api/articles/:id/approve`, `article.decide`) exige :

- la version relue égale à la version courante (409 `version_mismatch`, avec `details.currentVersion`) ;
- un statut `en_revue`, `approuve` ou `programme` (409 `invalid_state`) ;
- aucune contradiction non arbitrée dans le dossier factuel (422 `contradiction_unresolved`, avec `details.factCheckIds`) ;
- une date de programmation future si elle est fournie (422 `schedule_in_past`).

L'événement `article.approve` est journalisé. Le rejet (`POST /api/articles/:id/reject`, `article.decide`) exige un motif d'au moins trois caractères (400 `validation_error`) et un statut `en_revue`, `approuve` ou `programme`. Il invalide toutes les approbations valides avec le motif « Rejet : … », journalise `article.reject` et notifie.

Aucune règle n'empêche un utilisateur d'approuver une version qu'il a rédigée. Seuls les rôles comptent : un compte qui cumule les rôles rédacteur et validateur, comme Sophie Martin en démonstration, peut approuver son propre texte. Le cahier des charges (§7) admet ce cumul par décision d'Inovallée, en précisant qu'il ne constitue pas une séparation à deux personnes.

### Invalidation

| Contenu | Événement invalidant | Motif enregistré |
|---|---|---|
| Article | Nouvelle version ou restauration | « Contenu modifié après approbation » |
| Article | Rejet | « Rejet : motif » |
| Article | Nouvelle approbation sur le même canal | « Remplacée par une nouvelle approbation » |
| Post LinkedIn | Modification des variantes ou de la sélection | « Contenu modifié après approbation » |
| Newsletter | Modification du titre, de l'introduction, des sujets ou de leur ordre | « Contenu modifié après approbation » |

L'arbitrage d'un fait du dossier ne modifie pas le texte et n'invalide pas l'approbation. Une restauration crée une nouvelle version et exige donc une nouvelle approbation, conformément au §6.

### Contrôle juste avant l'envoi

Chaque demande de publication revérifie le droit `publish` (administrateur, validateur), puis l'état par `checkPublishable` ([`domain/workflow.ts`](../src/server/domain/workflow.ts)) sur la version courante et le canal demandé. Les conditions sont évaluées dans cet ordre :

| Ordre | Condition | Résultat |
|---|---|---|
| 1 | Un fait `contradictoire` sans arbitrage | `contradiction_unresolved` |
| 2 | Une approbation valide pour ce canal et cette version | publication autorisée |
| 3 | Une approbation valide pour ce canal, sur une autre version | `approval_version_mismatch` |
| 4 | Une approbation valide pour cette version, sur un autre canal | `approval_wrong_channel` |
| 5 | La dernière approbation de ce canal a été invalidée | `approval_invalidated` |
| 6 | Aucune approbation | `approval_missing` |

Un refus répond 422 avec le code, un message explicatif et la tentative bloquée dans `details.attempt`. Pour un post LinkedIn, seul l'état d'approbation est vérifié : les faits de l'article source ne sont pas examinés. Pour la newsletter, la consignation de l'export (`POST /api/newsletters/:id/export`) n'appelle pas `checkPublishable` : elle exige seulement une approbation valide sur la version courante, sinon 409 `approval_missing`, sans tentative enregistrée. Le modèle de texte n'a aucun droit : une publication ne résulte que d'un appel HTTP d'un utilisateur autorisé.

### Clé d'idempotence

```ts
idempotencyKey(contentId, version, channel) = sha256Hex(`${contentId}:${version}:${channel}`)
```

La clé ([`domain/workflow.ts`](../src/server/domain/workflow.ts)) est l'empreinte SHA-256 en hexadécimal (64 caractères) de la chaîne UTF-8 `identifiant:version:canal`, calculée par une implémentation JavaScript pure ([`domain/sha256.ts`](../src/server/domain/sha256.ts)). L'identifiant est celui de l'article, du post ou de l'édition. Par exemple, `art_pasqal:1:wordpress` donne `d49c3a574a302ed418569561b903df66d6abf55156707a8dedd1477685055b0e`, clé de la tentative `pub_0001` du jeu de démonstration.

Avant tout envoi, le serveur cherche une tentative réussie portant la même clé (pour WordPress, seulement si le brouillon de cette tentative est toujours celui de l'article). S'il la trouve, il la renvoie telle quelle (200) sans nouvel envoi ; pour un article, l'événement `publication.replay` est journalisé. Pour un post LinkedIn, un export réussi compte comme une tentative réussie : la même version ne peut plus être publiée par l'API. Une tentative bloquée de même clé et de même code est mise à jour (compteur `attempts` incrémenté) plutôt que dupliquée. Une nouvelle version produit une nouvelle clé ; pour WordPress, le même brouillon distant est alors mis à jour, car son identifiant distant est conservé sur l'article.

### Reprise après une réponse ambiguë

Le §6 demande de vérifier l'existence du contenu distant avant toute reprise, à défaut de passer en revue humaine. Pour WordPress ([`wordpress/publish.ts`](../src/server/wordpress/publish.ts)), un seul envoi ou rafraîchissement à la fois est admis par article (verrou `wordpress-publish:<article>`, 409 `publication_in_progress`). Avant d'écrire, le serveur enregistre une tentative `verification_requise`. Une création au résultat incertain (délai dépassé, coupure, erreur 5xx, réponse illisible) garde ce statut : au prochain envoi, KORA recherche sur le site les brouillons de son compte portant le marqueur de l'article, dans la fenêtre qui suit l'envoi interrompu. Un seul brouillon trouvé est repris, aucun donne une absence confirmée et un nouveau brouillon, plusieurs répondent 409 `publication_verification_required` avec la liste à nettoyer dans WordPress. Une mise à jour interrompue se renvoie sans risque de doublon. Les refus survenus avant toute écriture (configuration, compte capable de publier, brouillon retouché dans WordPress ou déjà publié) sont enregistrés en `echec` avec leur code.

Pour LinkedIn ([`handlers/distribution.ts`](../src/server/handlers/distribution.ts)), KORA ne relit pas le fil du membre : la vérification est humaine. La tentative `verification_requise` posée avant l'appel, ou laissée par un résultat incertain, bloque tout nouvel envoi de la version : 409 `publication_verification_required`, ou 409 `publication_in_progress` si la publication est encore en cours (verrou détenu). La personne qui a lancé la tentative, ou un administrateur, tranche en rappelant `POST /api/linkedin/:id/publish` avec `resolution` (sinon 403 `resolution_forbidden` ; une tentative sans auteur connu est réservée à l'administrateur) :

- `published` : la tentative passe `succes` (code `linkedin_confirmed_by_user`, sans `remoteId`), le post `publie`, audit `publication.confirmed` ;
- `not_published` : la tentative passe `echec` (code `linkedin_absence_confirmed`), audit `publication.absence_confirmed`, puis le post est publié de nouveau depuis le compte relié de la personne qui répond, ou exporté si elle n'en a pas.

Une résolution sans tentative à vérifier répond 409 `verification_not_pending`.

### Tentatives et codes d'échec

- **Collecte.** Trois essais au plus par collecte, code et motif visibles sur la source et sur la collecte, notification au premier échec. Codes du collecteur réel : `HTTP_<statut>`, `TIMEOUT`, et `NETWORK` pour une erreur réseau sans code ; le collecteur simulé des tests produit `HTTP_403`, `HTTP_404`, `TIMEOUT` et `TLS_ERROR`. Le code `budget_busy` (budget momentanément occupé) n'apparaît que sur la collecte : la source n'est ni marquée en erreur ni notifiée. Une collecte réussie peut aussi porter un code d'avertissement : `NO_FEED`, ou le code de l'échec de Google News relayé par Perplexity.
- **Publication.** Aucune reprise automatique. Chaque demande refusée par `checkPublishable` est enregistrée comme tentative `bloque` avec son code ; un refus de WordPress avant écriture, comme tentative `echec` ; un refus de LinkedIn, comme tentative `echec` (`linkedin_reconnect_required`, `linkedin_api_error`, `linkedin_unavailable`, `linkedin_internal_error`) ou `verification_requise` si le post a pu être créé. Le compteur `attempts` compte les demandes répétées et n'est pas borné.
- **Budget.** Un appel refusé répond 402 `budget_exhausted` ; une collecte refusée est enregistrée `bloque_quota`. Un budget momentanément occupé répond 409 `budget_busy` ; pour une collecte, l'exécution est enregistrée `echec` avec ce code, sans toucher à l'état de la source.

### Comportement réel de chaque canal au pilote

| Canal | Endpoint | Adaptateur | Mode | Effet sur le contenu |
|---|---|---|---|---|
| WordPress | `POST /api/articles/:id/publish` avec `channel: "wordpress"` | `RestWordPress` (site configuré), `SimulatedWordPress` (tests et démonstration locale) | `brouillon_distant` | `wordpress.status = "brouillon"`, identifiant distant conservé |
| LinkedIn (post) | `POST /api/linkedin/:id/publish` | compte LinkedIn relié de la personne qui publie ([`linkedin/publish.ts`](../src/server/linkedin/publish.ts)) ; à défaut, export (`ExportOnlyLinkedIn`) | `publication`, ou `export` sans compte relié | post `publie`, ou `exporte` |
| Newsletter | `POST /api/newsletters/:id/export` | aucun | `export` | édition `exportee` |
| LinkedIn ou newsletter (article) | `POST /api/articles/:id/publish` avec `channel: "linkedin"` ou `"newsletter"` | aucun | `export` | aucun |

[`adapters/channels.ts`](../src/server/adapters/channels.ts) contient les adaptateurs. Leur comportement est le suivant :

- **WordPress** est réel quand les variables `WORDPRESS_URL`, `WORDPRESS_USERNAME` et `WORDPRESS_APP_PASSWORD` sont définies ([`wordpress/config.ts`](../src/server/wordpress/config.ts)) : `RestWordPress` crée ou met à jour un brouillon (statut `draft`, ou `pending` conservé) sur le site, avec un compte qui ne doit pas pouvoir publier. Rien n'est jamais publié par KORA ; le message précise « Aucune publication : la mise en ligne se fait dans WordPress. » Sans aucune de ces variables, sous Vitest ou en démonstration locale sans base, `SimulatedWordPress` crée un brouillon fictif `wp-NNNN` sans contacter de site ; en production, une configuration absente ou incomplète refuse l'envoi (`non_configure`).
- **LinkedIn** publie réellement quand la personne qui clique a relié son compte (voir [WF4](#wf4--post-linkedin)) : le post est créé sur son profil, par la passerelle de connexion de la plateforme d'hébergement, sans passer par les adaptateurs. `ExportOnlyLinkedIn` (`apiAvailable: false`) reste déclaré dans `adapters().linkedin`, mais ne sert plus qu'à fournir le code `linkedin_api_unavailable` et le message de l'export de repli, quand aucun compte n'est relié. Le texte reste récupérable par `GET /api/linkedin/:id/export`.
- **Newsletter** : le fichier HTML ou texte est produit à la demande, jamais envoyé.
- **Publication d'un article sur un autre canal** que WordPress : une tentative « Export … prêt : diffusion manuelle » est consignée, sans fichier associé.

Toute publication réussie d'un article fait passer son signal en `traite` et notifie. Le statut de l'article ne change pas à l'envoi (voir [WF2](#wf2--sujet-sélectionné-vers-brouillon-sourcé)) ; la programmation (`scheduledAt`) ne conditionne pas la publication.

## Matrice des droits

Les droits sont définis dans [`domain/permissions.ts`](../src/server/domain/permissions.ts) et contrôlés côté serveur dans chaque handler par `assertCan`. Un refus répond 403 `forbidden` avec un message qui cite les rôles de l'utilisateur. Un utilisateur cumule les droits de tous ses rôles.

| Action | Endpoints | Lecteur | Rédacteur | Validateur | Administrateur |
|---|---|---|---|---|---|
| Lecture (aucun contrôle) | Tous les `GET`, y compris exports, audit et liste des utilisateurs, sauf `GET /wordpress/check` et `GET /wordpress/categories` | oui | oui | oui | oui |
| Aucun contrôle | `POST /notifications/read` ; `POST /me` (changement de profil, en démonstration seulement : 403 `demo_only` sinon) ; `POST /me/linkedin/connect`, `complete`, `disconnect` (compte LinkedIn de l'utilisateur courant) | oui | oui | oui | oui |
| `registry.write` | `POST`, `PATCH /companies` ; `POST`, `PATCH`, `DELETE /sources` | non | oui | non | oui |
| `registry.delete` | `DELETE /companies/:id` | non | non | non | oui |
| `collect` | `POST /collect`, `POST /sources/:id/collect` | non | oui | non | oui |
| `signal.write` | `PATCH /signals/:id` (statut, motif, entreprise), `merge`, `split` | non | oui | non | oui |
| `newsletter.write` | `PATCH /signals/:id` (`inNewsletter`), création et composition des éditions | non | oui | non | oui |
| `article.write` | `POST /articles`, `versions`, `restore`, `submit` | non | oui | non | oui |
| `article.write` ou `article.decide` | `PATCH /articles/:id/fact-checks/:fid` | non | oui | oui | oui |
| `article.decide` | `approve`, `reject` d'un article | non | non | oui | oui |
| `import.write` | `POST /imports`, décisions, conversion | non | oui | non | oui |
| `linkedin.write` | `POST /linkedin`, `PATCH`, `submit` | non | oui | non | oui |
| `linkedin.decide` | `POST /linkedin/:id/approve` | non | non | oui | oui |
| `newsletter.decide` | `POST /newsletters/:id/approve` | non | non | oui | oui |
| `publish` | `POST /articles/:id/publish`, `POST /articles/:id/wordpress/refresh`, `POST /linkedin/:id/publish`, `POST /newsletters/:id/export` | non | non | oui | oui |
| `grid.write` | `POST /scoring-grids`, `POST /signals/rescore` | non | non | non | oui |
| `rule.write` | Règles et propositions de l'Editorial DNA | non | non | non | oui |
| `users.manage` | `POST /users`, `PATCH`, `DELETE /users/:id`, `POST /users/:id/invite` | non | non | non | oui |
| `wordpress.manage` | `GET /wordpress/check`, `GET /wordpress/categories`, `PUT /wordpress/settings` | non | non | non | oui |

Les comptes de démonstration sont décrits dans [Démarrage](01-demarrage.md) ; ils n'existent que dans le dépôt en mémoire (tests et développement local sans base). La base de production ne contient que les comptes créés par invitation, le premier administrateur étant désigné par la variable `KORA_ADMIN_EMAILS` (voir [Session et identité](06-securite-et-flux-tiers.md#session-et-identité)). Les tests de [`security.test.ts`](../src/test/server/security.test.ts) et [`studio.test.ts`](../src/test/server/studio.test.ts) vérifient notamment qu'un lecteur ne peut rien modifier, qu'un rédacteur ne peut pas approuver et qu'un validateur ne peut pas rédiger.

Quatre points sont à connaître :

- **Approbation de son propre texte.** Rien ne compare le validateur à l'auteur de la version : un utilisateur à la fois rédacteur et validateur (Sophie Martin en démonstration, ou tout compte auquel un administrateur donne ces deux rôles) approuve son propre texte.
- **Suppression d'une source.** `DELETE /sources/:id` exige `registry.write` et est donc ouvert aux rédacteurs, alors que la suppression d'une entreprise est réservée à l'administrateur.
- **Propriété des contenus.** Aucune règle de propriété n'existe : tout rédacteur peut modifier tout article, post ou édition.
- **Lectures.** Toutes les lectures sont ouvertes à tous les rôles, y compris le journal d'audit et les exports, à l'exception du test de connexion WordPress et de la liste de ses catégories, qui interrogent le site. La sécurité de la session elle-même est décrite dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md).

## Quotas et budget

Les plafonds et coûts sont dans [`domain/budget.ts`](../src/server/domain/budget.ts), leur application dans [`services/usage.ts`](../src/server/services/usage.ts). L'état est consultable par `GET /api/usage` ; les réponses 402 et 422 sont décrites dans [Budget API et quotas](03-reference-api.md#budget-api-et-quotas).

### Compteurs et plafonds

| Compteur | Clé | Plafond (`DEFAULT_LIMITS`) | Mesure | Blocage au plafond |
|---|---|---|---|---|
| Budget API | `api_budget_eur` | 150 € HT | Somme des coûts du mois | 402 `budget_exhausted` |
| Recherches web | `search_queries` | 3 000 | Recherches du mois | aucun |
| Nouvelles observations | `observations` | 6 000 | Observations du mois | aucun |
| Dossiers et articles | `articles` | 25 | Générations d'articles du mois | 422 à `POST /articles` |
| Posts LinkedIn | `linkedin_posts` | 25 | Générations de posts du mois | 422 à `POST /linkedin` |
| Éditions de newsletter | `newsletters` | 5 | Éditions créées dans le mois | 422 à la création d'une édition |
| Entreprises suivies | `companies` | 150 | Total du registre | 422 à `POST /companies` |
| Sources configurées | `sources` | 300 | Total du registre | 422 à `POST /sources`, pas à `POST /companies` |
| Stockage | `storage_gb` | 10 Go | Base fixe des réglages plus taille des imports | 422 à `POST /imports` |

`assertQuota` répond 422 `quota_exceeded`. Les compteurs `search_queries` et `observations` sont mesurés et alertés mais ne bloquent rien ; seul le budget limite la collecte. Chaque exécution de collecte compte une recherche, qu'elle interroge Google News ou lise directement un flux. La source Google News créée avec chaque entreprise échappe au contrôle du quota de sources (voir [WF1](#wf1--collecte-et-classement)). Le stockage part de la base fixe `storageBaseGb`, qui vaut 2,4 Go dans les réglages initiaux, y compris pour une base de production vide. La conversion d'un import ne consomme pas le quota d'articles. Les autres plafonds du §12 ne sont pas appliqués : cinq comptes, deux variantes par article, une collecte quotidienne par source, nombre de traitements simultanés.

### Coûts unitaires

| Clé (`COSTS`) | Coût estimé (€ HT) | Appel concerné |
|---|---|---|
| `article` | 0,45 | Dossier et brouillon (`generation_article`) |
| `linkedin` | 0,08 | Variantes LinkedIn (`generation_linkedin`) |
| `summary` | 0,02 | Résumé d'un sujet de newsletter (`generation_summary`) |
| `classification` | 0,005 | Lecture d'une publication par le modèle à la collecte (`classification`) |
| `search` | 0,012 | Recherche de la collecte (`search_query`) |
| `observation` | 0,021 | Observation collectée (`observation`) |

Le coût est réservé et enregistré par unité, que le texte soit produit par les gabarits ou par OpenAI : la présence de la clé `AI_API_KEY` ne change ni l'estimation ni la consommation enregistrée. Le coût réellement facturé par OpenAI n'est pas mesuré.

### Réservation avant l'appel

`paidCall` encadre chaque appel payant :

1. Sous le verrou `budget` (voir ci-dessous), il calcule la dépense du mois à partir du journal de consommation.
2. `decideReservation` refuse l'appel si les appels payants sont déjà suspendus pour le mois, ou si la dépense, plus les réservations en cours (`reservedEur`), plus l'estimation dépassent le plafond.
3. En cas de refus, il marque la suspension pour le mois (`paidCallsSuspended`, `suspendedMonth`), puis, hors verrou, journalise `quota.suspension` au nom de « KORA », notifie « Budget API : appels payants suspendus » et répond 402 `budget_exhausted`.
4. Sinon il ajoute l'estimation aux réservations, toujours sous le verrou, puis exécute l'appel hors verrou.
5. Si l'appel réussit, il enregistre les lignes de consommation : le coût réel fourni par l'appelant (seule la collecte en fournit un) ou, à défaut, l'estimation. Le total enregistré ne dépasse jamais l'estimation réservée.
6. Il libère ensuite la réservation, sous le verrou, que l'appel ait réussi ou échoué. Le coût réel étant enregistré avant la libération, l'appel reste compté à tout instant, en réservation ou en consommation, et ne peut échapper au plafond.
7. Il vérifie les alertes. Un échec de cette vérification (verrou `budget` occupé, base indisponible) est seulement journalisé côté serveur : l'appel, déjà payé et enregistré, aboutit quand même, et les alertes sont revérifiées au prochain appel payant.

Deux appels à OpenAI échappent à cette réservation. Le résumé produit à la collecte est calculé pendant l'ingestion, après l'enregistrement de la consommation et la libération de la réservation, et aucune ligne de consommation ne lui correspond en propre. Le résumé produit à la défusion n'est encadré par aucun `paidCall` et reste possible quand le budget est suspendu.

Les réservations (`reservedEur`), la suspension et les alertes déjà notifiées sont stockées dans un seul document de réglages, relu puis réécrit en entier (`saveSettings`). Ces écritures sont sérialisées par le verrou `budget` (durée de vie de 10 secondes) : la réservation, la libération et la mémorisation des alertes le prennent tour à tour, en attendant jusqu'à 5 secondes ; au-delà, la requête répond 409 `budget_busy` (« Le budget API est en cours de mise à jour : réessayez dans quelques secondes. »). Ce refus ne survient qu'à la réservation, avant l'appel : la libération ne le renvoie jamais (voir ci-dessous) et la vérification des alertes ne fait pas échouer l'appel. Pour une collecte, il ne fait échouer que l'exécution de la source concernée (voir [WF1](#wf1--collecte-et-classement)). Deux appels simultanés ne peuvent donc plus dépasser ensemble le plafond ni perdre une réservation. Si la libération ne peut pas prendre le verrou, elle est faite sans lui plutôt que laissée en suspens. Une exécution interrompue par l'hébergeur entre la réservation et la libération laisserait encore sa réservation en base, où aucun redémarrage ne l'efface.

### Alertes à 80 % et 100 %

`alertLevel` classe chaque compteur : `seuil_80` à partir de 80 % du plafond, `atteint` à 100 %, `ok` sinon. Après chaque appel payant, `checkAlerts` examine le budget, les recherches, les observations, les articles, les posts, les newsletters et le stockage (pas les entreprises ni les sources) et émet une notification par compteur, par niveau et par mois, mémorisée sous la clé `AAAA-MM:clé:niveau` dans `notifiedAlerts`. Seul le niveau courant est notifié : un compteur qui passe en une fois de moins de 80 % à 100 % ne reçoit que l'alerte `atteint`. Les alertes ne sont vérifiées qu'après un appel payant : un dépassement du stockage par un import, par exemple, n'est notifié qu'au prochain appel payant. Une vérification qui échoue ne fait pas échouer l'appel ; l'alerte est émise au prochain appel payant.

### Comportement à 100 % du budget

Les appels payants sont refusés : création d'article, création de post LinkedIn, ajout d'un sujet à une newsletter, collecte. La consultation, les exports CSV et JSON, la publication et les exports LinkedIn, les exports de newsletter, les décisions (approbation, rejet, publication), les imports, les modifications du registre et l'enregistrement de versions restent possibles. Le test « budget épuisé » de [`budget.test.ts`](../src/test/server/budget.test.ts) vérifie la consultation, l'export CSV, l'export de newsletter et la publication WordPress. Le moteur est affiché comme inactif sur le tableau de bord.

La suspension dure jusqu'à la fin du mois, même si le plafond était relevé ; en base, elle survit aux redémarrages. Aucun endpoint ne modifie les plafonds (`quotaLimits`). Le dépôt en mémoire les copie de `DEFAULT_LIMITS` à chaque démarrage ; la base Supabase ne les copie qu'une fois, à l'initialisation des réglages, si bien qu'une modification ultérieure de `DEFAULT_LIMITS` n'a plus d'effet sur une base existante (voir [Exploitation](09-exploitation.md)).

### Période

Le mois courant est `monthKey(now)`, au format `AAAA-MM`, calculé en heure locale du serveur ([`domain/dates.ts`](../src/server/domain/dates.ts)). Les totaux sont recalculés à chaque appel à partir du journal de consommation ; rien n'est reporté d'un mois sur l'autre.

## Editorial DNA

### Règles

Une règle (`RuleRecord`) a un type (`ton`, `longueur`, `structure`, `vocabulaire`, `interdit`), un texte de 500 caractères au plus, un indicateur `active` et une version. L'administrateur la crée (`POST /api/editorial-dna/rules`) ou la modifie (`PATCH /api/editorial-dna/rules/:id`) ; toute modification augmente la version et conserve l'état précédent dans `history`, qui n'est exposé ni par l'API ni par les exports.

À la création d'un article, les règles actives sont transmises à `generateDossier`. Seule une règle de type `longueur` mentionnant « titre » et un nombre de caractères est interprétée : elle borne la longueur du titre. Les autres règles ne modifient pas le texte produit par les gabarits et ne sont pas transmises à OpenAI.

### Exemples

Les exemples d'articles (`EditorialExample` : titre, extrait, URL, date) proviennent du jeu de démonstration et sont affichés par `GET /api/editorial-dna`. La base de production est initialisée avec les règles du jeu de démonstration mais sans exemple : la liste y est vide. Aucun endpoint n'en ajoute et la génération ne les utilise pas : la récupération d'exemples pertinents au moment de la rédaction (§4.1) n'est pas implémentée.

### Propositions issues des corrections

`collectCorrections` ([`domain/dna.ts`](../src/server/domain/dna.ts)) forme les paires (version KORA, version humaine suivante) de tous les articles. `analyzeCorrections` ne propose une règle qu'à partir de trois corrections concordantes (`MIN_CORRECTIONS`) :

- **Longueur.** Si au moins trois titres ont été raccourcis sous 85 % de leur longueur, la règle proposée est « Titres de N caractères maximum. », N étant la longueur moyenne des titres humains arrondie aux 5 supérieurs, et au moins 40. Elle cible la règle de longueur existante mentionnant « titre ».
- **Vocabulaire.** L'analyse porte sur le chapô et le corps. Si un mot d'au moins quatre lettres est retiré et qu'une expression de deux mots est ajoutée exactement dans les mêmes corrections, au moins trois fois, la règle proposée est « Préférer « ajout » à « retrait ». ». Elle cible la règle de vocabulaire existante qui mentionne le mot retiré.
- **Terme interdit.** Si un mot d'au moins quatre lettres est retiré du chapô ou du corps dans au moins trois corrections, et qu'il n'est ni déjà l'objet d'une proposition de vocabulaire ni mentionné par une règle `interdit`, la règle proposée est « Éviter le terme « mot ». ». Le nombre de ces propositions n'est pas limité.

L'acceptation d'une proposition qui cible une règle existante remplace tout le texte de cette règle par le texte proposé.

`refreshProposals` ([`services/dna.ts`](../src/server/services/dna.ts)) dédoublonne les propositions par signature, met à jour celles qui sont en attente et ne repropose jamais une proposition déjà décidée.

### Décision

`PATCH /api/editorial-dna/proposals/:id` (administrateur) accepte ou refuse une proposition. L'acceptation met à jour la règle ciblée (version augmentée, règle réactivée) ou crée une nouvelle règle ; le refus ne change que le statut. Le nom du décideur et la date sont enregistrés et l'événement `rule.proposal` est journalisé. Rien n'est appliqué sans cette décision et aucun modèle n'est réentraîné ; le test « propose des règles à partir des corrections et n'applique rien sans décision » de [`studio.test.ts`](../src/test/server/studio.test.ts) le vérifie.

## Imports humains

Les règles sont dans [`domain/imports.ts`](../src/server/domain/imports.ts) et [`handlers/imports.ts`](../src/server/handlers/imports.ts).

### Formats et taille

`detectFormat` exige une extension et un type MIME compatibles :

| Extension | Types MIME acceptés | Format |
|---|---|---|
| `.txt` | vide, `text/plain` (avec ou sans jeu de caractères), `application/octet-stream` | texte |
| `.docx` | vide, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/octet-stream`, `application/zip` | DOCX |

Toute autre combinaison répond 415 `unsupported_format` (par exemple un PDF, ou un `.txt` déclaré `application/pdf`). La taille maximale est `MAX_IMPORT_BYTES` = 10 Mio (10 × 1 024 × 1 024 octets). Une requête dont l'en-tête `content-length` dépasse 10 Mio plus 64 Kio est refusée avant lecture du corps ; la taille du fichier est ensuite contrôlée. Les deux refus répondent 413 `file_too_large`. Il n'y a pas d'OCR.

### Extraction

- **Texte.** Le contenu doit être de l'UTF-8 strict, sinon 415 `invalid_encoding`. Le BOM est retiré. L'original est le texte décodé ; le texte extrait en normalise seulement les fins de ligne.
- **DOCX.** Le fichier doit commencer par la signature ZIP `PK`. Seule la partie `word/document.xml` est décompressée (fflate), et seulement si sa taille décompressée ne dépasse pas 50 Mio. Les paragraphes `<w:p>`, les textes `<w:t>`, les tabulations et les sauts de ligne sont extraits par expressions régulières, et les entités XML sont décodées. L'original est la suite des paragraphes séparés par un saut de ligne ; le texte extrait est la suite des paragraphes non vides séparés par une ligne vide. Les en-têtes, pieds de page, notes, commentaires et images sont ignorés. Tout échec répond 415 `invalid_docx`.

Le nom de fichier est assaini (chemin et caractères de contrôle retirés, 200 caractères au plus). L'auteur est obligatoire (400 `author_required`) et tronqué à 120 caractères. Les octets originaux sont conservés dans l'enregistrement de l'import (`bytes`), mais aucun endpoint ne permet de les télécharger. En base, ce `Uint8Array` est sérialisé par `JSON.stringify` en objet à clés numériques, soit environ 12,5 octets de JSON par octet de fichier : un fichier de 1 Mio produit une ligne `kora_records` d'environ 12,5 Mio.

### Propositions

`buildProposals` calcule sur le texte extrait des propositions positionnées (début, fin, texte avant, texte après), sans chevauchement et au nombre de soixante au plus :

| Type (`kind`) | Règle |
|---|---|
| `correction` | Espace insécable avant « : » (sauf après un chiffre ou une barre oblique) et espace fine insécable avant « ; », « ? » et « ! » |
| `mise_en_forme` | Passage entre guillemets droits (300 caractères au plus, sur une seule ligne) remis entre guillemets « » avec espaces insécables |
| `correction` | Doubles espaces réduites à une seule |
| `enrichissement` | Première mention d'une entreprise du registre transformée en lien interne `[Nom](/entreprises?id=…)` |

Chaque proposition est `en_attente` jusqu'à décision. Une décision peut être changée, y compris en revenant à `en_attente`, tant que l'import n'est pas converti ; ensuite elle répond 409 `already_converted`. Le serveur ne calcule pas de différence : l'interface ([`ImportView.tsx`](../src/components/articles/imports/ImportView.tsx)) affiche la différence mot à mot (`diffWords` dans [`diff.ts`](../src/components/articles/diff.ts)) de chaque proposition et celle entre l'original et le texte extrait.

### Conversion

`POST /api/imports/:id/convert` applique les seules propositions acceptées, de la fin du texte vers le début, et seulement si le texte situé aux positions enregistrées est encore celui de la proposition. `splitArticle` découpe ensuite le texte en paragraphes (lignes non vides) sans ajouter ni retirer de mot :

- avec au moins trois paragraphes et un premier paragraphe de 180 caractères au plus, le premier devient le titre, le deuxième le chapô et le reste le corps ;
- avec deux paragraphes et un premier paragraphe de 180 caractères au plus, le premier devient le titre et le second le corps ;
- sinon, le titre est le nom du fichier sans extension et tout le texte forme le corps.

L'article créé est au statut `brouillon`, d'origine `import_humain`. Son auteur (`author`) est l'auteur déclaré à l'import et la version 1 est signée de ce même nom, jamais « KORA ». La note de version indique le nombre de propositions acceptées. L'entreprise est recherchée dans le texte avec le seuil de confiance de 60. L'article n'a ni signal ni dossier factuel. Le champ `author` n'est modifiable par aucun endpoint : les versions suivantes enregistrent le nom de leur rédacteur dans `createdBy`, mais l'auteur n'est jamais remplacé. Un article importé n'alimente pas WF6, puisque sa première version n'est pas signée « KORA ».

## Newsletter

Les règles sont dans [`domain/newsletter.ts`](../src/server/domain/newsletter.ts), [`services/newsletters.ts`](../src/server/services/newsletters.ts) et [`handlers/distribution.ts`](../src/server/handlers/distribution.ts).

### Édition courante et création

L'édition courante est l'édition non exportée la plus récente. Une nouvelle édition porte par défaut le titre « Newsletter Inovallée — semaine du … ». Sa semaine (`weekOf`) est le lundi de la date fournie, à défaut le lundi suivant. Sa date d'envoi prévue (`scheduledFor`, le lundi à 9 h) est purement informative, car KORA n'envoie rien. Elle reçoit une introduction par défaut et démarre en `composition`, version 1.

### Sélection et résumés

Un sujet est ajouté par `POST /api/newsletters/:id/items` (signal ou article), ou par l'interrupteur « Inclure dans la prochaine édition » (`PATCH /api/signals/:id` avec `inNewsletter`). Son titre est celui de l'article, à défaut celui du signal. Son résumé est un appel payant (`COSTS.summary` = 0,02 €) qui part de l'extrait de l'article, à défaut du résumé du signal, à défaut du titre. Le gabarit retient la première phrase, 280 caractères au plus, sans le préfixe « [À vérifier] » ; OpenAI peut la remplacer par un résumé de 400 caractères au plus.

### Ordre et modifications

Chaque sujet a un rang (`order`) de 1 à n. `PATCH /api/newsletters/:id` modifie le titre, l'introduction et, pour chaque sujet, le résumé (1 500 caractères au plus) et le rang ; un sujet inconnu répond 422 `item_not_found`. Les sujets sont triés par rang demandé puis renumérotés de 1 à n : un rang de 20 place le sujet en dernier. Le retrait (`DELETE /api/newsletters/:id/items/:itemId`, ou l'interrupteur désactivé) renumérote aussi. Toute modification augmente la version, invalide l'approbation et ramène l'édition en `composition`.

### Export HTML et texte

`GET /api/newsletters/:id/export?format=html|txt` produit un fichier `newsletter-AAAA-MM-JJ-vN.html` ou `.txt` (400 `invalid_format` pour un autre format), sans aucun effet sur l'édition :

- Le **HTML** est une page autonome aux styles en ligne, sur une largeur de 640 pixels : en-tête « Inovallée · Semaine du … », titre, introduction, sujets numérotés (titre et résumé), pied de page. Tout le texte est échappé (`escapeHtml`).
- Le **texte** contient le titre en majuscules, l'en-tête, l'introduction, les sujets numérotés et le pied de page.

Le pied de page indique « Export préparé avec KORA Newsroom ; aucun envoi automatique. ». Sans approbation valide sur la version courante, le fichier porte la mention « Aperçu — version N non approuvée. » en bandeau HTML ou « [APERÇU — version N non approuvée] » en première ligne du texte.

La consignation est une requête d'écriture distincte : `POST /api/newsletters/:id/export` (droit `publish`, en-tête anti-CSRF comme toute écriture). Elle exige une approbation valide sur la version courante (409 `approval_missing`). À la première consignation de cette version, le serveur enregistre une tentative réussie en mode `export` (clé d'idempotence de l'édition, de la version et du canal `newsletter`), fait passer l'édition en `exportee` et journalise `publication.success` ; une consignation répétée renvoie l'édition sans nouvelle tentative. L'interface l'appelle au clic sur « Export HTML » ou « Export texte » quand la version est approuvée, l'édition pas encore exportée et l'utilisateur validateur ou administrateur. Un simple téléchargement, par exemple par un lien ouvert directement ou par un rédacteur, ne fige donc jamais l'édition ; un rédacteur qui télécharge une édition approuvée obtient le fichier sans mention d'aperçu.

## Amélioration par OpenAI

La chaîne de génération est décrite dans [Architecture](02-architecture.md#chaîne-de-génération-avec-openai) ; les données transmises et la gestion de la clé sont dans [Sécurité et flux tiers](06-securite-et-flux-tiers.md#openai). Cette section décrit les règles métier.

### Activation

`OpenAiEnhancer` ([`adapters/openai.ts`](../src/server/adapters/openai.ts)) est instancié par `adapters()` ([`adapters/index.ts`](../src/server/adapters/index.ts)) si la variable `AI_API_KEY` est définie au premier appel et que le processus n'est pas lancé par Vitest. Sans clé, toutes les sorties viennent des gabarits de `TemplateTextModel`.

### Points d'insertion

| Point | Fichier | Texte remplacé | Encadrement budgétaire |
|---|---|---|---|
| Résumé de signal à la collecte | [`services/collection.ts`](../src/server/services/collection.ts) | `summary` du signal créé | hors réservation, après la réservation de la collecte |
| Résumé de signal à la défusion | [`handlers/signals.ts`](../src/server/handlers/signals.ts) | `summary` du nouveau signal | aucun |
| Dossier et brouillon | [`handlers/articles.ts`](../src/server/handlers/articles.ts) | titre, chapô, corps, extrait, titre SEO de la version 1 | `paidCall`, 0,45 € |
| Variantes LinkedIn | [`handlers/distribution.ts`](../src/server/handlers/distribution.ts) | variantes du post (trois au plus) | `paidCall`, 0,08 € |
| Résumé de newsletter | [`services/newsletters.ts`](../src/server/services/newsletters.ts) | résumé du sujet (400 caractères au plus) | `paidCall`, 0,02 € |

OpenAI ne touche jamais aux faits du dossier, aux angles, au plan, aux catégories, aux tags, aux notes éditoriales, au score ni à l'indicateur documentaire.

### Garde-fous

- **Gabarit d'abord.** Le texte du gabarit est toujours calculé. OpenAI ne fait que le remplacer.
- **Repli silencieux.** Toute erreur réseau, réponse non 2xx, réponse vide ou dépassement du délai de 30 secondes conserve le texte du gabarit. C'est aussi le cas d'un JSON invalide ou incomplet : un dossier sans titre, chapô ou corps, des variantes sans texte ni hashtags, un résumé de 20 caractères ou moins. Aucun échec n'est journalisé.
- **Consigne système.** Le modèle reçoit la consigne d'un rédacteur en chef factuel et journalistique, en français, avec la « Règle absolue : n'invente AUCUN fait, chiffre ou citation. Utilise uniquement les éléments fournis. » et l'ordre de conserver les marqueurs « [À vérifier] ». La demande de dossier exige en plus de reprendre à l'identique la section « Sources consultées ». La consigne ne contient pas d'instruction spécifique contre les consignes injectées dans les contenus.
- **Aucun contrôle de sortie.** Rien ne vérifie que les marqueurs « [À vérifier] » et la section « Sources consultées » sont conservés, ni qu'aucun chiffre nouveau n'apparaît. La demande LinkedIn fixe deux variantes de 600 caractères au plus, mais le code en accepte trois et ne contrôle ni leur longueur ni leurs hashtags. La sortie est seulement tronquée : extrait à 200 caractères, titre SEO à 60, résumé à 400.
- **Approbation humaine.** Le texte réécrit passe par les mêmes versions, approbations et contrôles avant envoi que le texte du gabarit, et le modèle n'a aucun droit de publication.

Le gabarit lui-même retire le marqueur « [À vérifier] » de l'accroche LinkedIn, des résumés et de l'extrait de l'article : une phrase non corroborée peut ainsi y figurer sans marqueur.

### Budget

La réservation se fait par unité, selon `COSTS`, quel que soit le fournisseur ; la consommation enregistrée est l'estimation, pas le coût réel en jetons (voir [Coûts unitaires](#coûts-unitaires)). Le modèle (`gpt-4o-mini`) et la température (0,4) sont fixés dans le code ; aucune limite de jetons (`max_tokens`) ni format de réponse imposé (`response_format`) n'est transmis.
