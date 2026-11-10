# Dossier de revue PR — Logos automatiques des entreprises (Brandfetch V1)

**Branche** : `feat/company-logos` ; **cible de PR** : `main` ; **statut** : prêt à présenter en revue, **non validé pour fusion/déploiement**.

**Périmètre** : affichage automatique des logos à partir des domaines déjà présents dans KORAINNO, sans import manuel, modification du registre, migration SQL ni nouveau service backend.

## 1. Architecture et modifications réellement réalisées

1. `src/lib/branding/companyLogo.ts` construit exclusivement des URL sur `https://cdn.brandfetch.io` : normalisation des domaines, vérification syntaxique, rejet des IP sous forme IPv4 et des TLD numériques, contrôle du format du Client ID. Cette vérification ne prouve **pas** l'identité de l'entreprise.
2. `src/components/kora/BrandMark.tsx` accepte le domaine **optionnel** d'une entreprise et affiche une image distante si elle charge. Les monogrammes et glyphes précédents restent visibles sans Client ID, en cas de domaine incorrect, de 404/erreur réseau ou après **10 secondes**.
3. Les écrans entreprises (grille/table/fichier), veille, signaux, articles, LinkedIn et newsletter transmettent `Company.domain` à `BrandMark`. Les logos de **médias/sources de presse** sont hors périmètre.
4. `src/test/company-logo.test.tsx` couvre génération d'URL, valeurs invalides, configuration absente, échec de chargement, changement de domaine, timeout et non-régression médias.
5. `.github/workflows/company-logos-ci.yml` exécute installation verrouillée, typecheck, lint sur les TS/TSX modifiés, tests Vitest, build, installation de Chromium et tests E2E Playwright sur la démonstration isolée.
6. `docs/06-securite-et-flux-tiers.md` et `docs/07-frontend.md` décrivent le flux externe, la configuration, les règles de repli et les exigences avant production.

**Aucune migration de données et aucun stockage des logos**. Les images sont chargées directement par le navigateur depuis Brandfetch, en conservant la possibilité de changer de source d'images plus tard.

## 2. Configuration et fonctionnement

Variable **publique** Vite attendue **au build** (ou au redémarrage du serveur de développement) :

```dotenv
VITE_BRANDFETCH_CLIENT_ID=<client-id-public>
```

- En local, définir la variable dans `.env.local` (ignoré par Git). Ne jamais la placer dans `.env` versionné.
- Ne jamais y placer de clé API secrète : les variables `VITE_*` sont exposées au navigateur.
- En production Lovable, la variable devra être configurée dans l'environnement de build, puis l'application reconstruite/déployée ; **cela n'a pas été effectué**.
- Sans configuration, le comportement précédent (glyphes et initiales) est conservé.
- La route Brandfetch est `https://cdn.brandfetch.io/domain/{domaine}/fallback/404?c={clientId}` ; une image manquante peut donner 404 et déclencher le repli local.
- Les images ne sont ni téléchargées par le serveur, ni copiées dans Supabase Storage.

## 3. Preuves de vérification

### CI — vérifiée sur le commit `ca4d731172150d29ffd28dcf6bd7b2096a56a39b`

**GitHub Actions** : https://github.com/Makk7709/koraino/actions/runs/41222727859

| Contrôle | Résultat constaté | Limites |
|---|---|---|
| `bun install --frozen-lockfile` | Réussi | Vérifie le lockfile en CI |
| `bunx tsc --noEmit` | Réussi | Typage statique uniquement |
| ESLint sur les TS/TSX modifiés par la branche | Réussi | **Pas le lint global** : erreurs Prettier préexistantes sur `main` |
| `bun run test` | **622/622 réussis ; 46 fichiers de tests** | Événements d'image simulés, sans appel réel Brandfetch |
| `bun run build` | Réussi | N'équivaut pas à une recette Lovable |

La CI du commit documentaire `7db98f0` est validée ([run #41249978453](https://github.com/Makk7709/koraino/actions/runs/41249978453)). Les deux nouveaux tests navigateur ont réussi sur `b3db7c1` ([run #41251217681](https://github.com/Makk7709/koraino/actions/runs/41251217681)). Réexaminer la CI après chaque nouveau commit.

### Tests E2E Playwright (automatisés, Chromium)

- Fichiers : `playwright.config.ts`, `e2e/company-logos.spec.ts`, `bun.lock` (dépendance `@playwright/test`), `package.json` (script `test:e2e`).
- Environnement : application de démonstration isolée sur `127.0.0.1:8765`, `SUPABASE_URL` explicitement vide, Client ID Brandfetch fictif et réponses du CDN interceptées. Aucune connexion à la base locale des 30 entreprises, à la production ou à l'API réelle Brandfetch.
- **Succès** : navigation vers `/entreprises`, recherche de Pasqal, réponse CDN 200 simulée avec un SVG synthétique, image chargée et visible, domaine `pasqal.com` vérifié.
- **Échec** : recherche d'Allevard Analytics (données de démonstration), réponse CDN 404 simulée, initiales `AA` présentes et image retirée.
- **Résultat** : 2/2 tests Chromium réussis sur `b3db7c1`, [exécution #41251217681](https://github.com/Makk7709/koraino/actions/runs/41251217681).
- **Rejouer** : `bun install --frozen-lockfile`, `bunx playwright install chromium`, `bun run test:e2e`. Le port 8765 doit être libre.

Ces tests vérifient le parcours d'affichage dans un navigateur réel avec un CDN simulé. La recette manuelle sur les 30 entreprises est une preuve distincte de fonctionnement avec Brandfetch réel.

### Recette manuelle (observations du pilote, non exhaustives)

- Application `feat/company-logos` lancée sur `127.0.0.1:8082`, connectée à la base **Supabase locale** comportant 30 entreprises Inovallée, sans travail sur la base de production.
- Logos effectivement visibles dans la grille pour plusieurs entreprises, notamment Arturia, Bertin Alpao, Blue Ortho et DiamSens.
- Cas négatif : sur `anatoscope.com`, le navigateur a affiché une requête Brandfetch **HTTP 404**, avec repli sur les initiales `AN`. Ce résultat est accepté dans la V1.
- La vérification manuelle **ne prouve pas 30 logos/30**, ne constitue pas une matrice HTTP exhaustive, ni une campagne de tests sur tous les navigateurs.

## 4. Sécurité et confidentialité

| Point | État / implication |
|---|---|
| Client ID | Public, embarqué côté navigateur, **pas un secret** |
| Destination HTTP | Hôte CDN constant ; le domaine d'entreprise est injecté dans le chemin après validation |
| SSRF serveur | Pas de nouvelle requête serveur à une adresse utilisateur ; le navigateur charge une image HTTPS |
| Informations divulguées au tiers | Domaine de la société demandé, adresse IP du visiteur, origine du site via `strict-origin-when-cross-origin` |
| CSP | Vérifier `img-src` dans l'environnement réel avant activation |
| RGPD / notices | Réviser la notice de confidentialité et le registre des services tiers si nécessaire |
| Droits des marques | Respecter les conditions Brandfetch et les droits attachés aux logos ; **non homologués ici** |
| Erreurs | Repli visuel, sans écriture en base ; pas de télémétrie agrégée des 404 |

Les prix, quotas et conditions d'utilisation du fournisseur sont externes et peuvent évoluer : les vérifier avant déploiement plutôt que supposer une gratuité illimitée. Le fournisseur n'est pas une source d'identités légalement certifiées.

## 5. Limites et risques résiduels explicites

1. **Couverture partielle** : plusieurs entreprises reçoivent un 404 ; aucun taux d'exhaustivité garanti. Le retour aux monogrammes est une décision V1 acceptée.
2. **Dépendance externe** : disponibilité, réponse du CDN, quotas/évolution des conditions Brandfetch. Les caches navigateur/CDN ne sont pas un stockage applicatif.
3. **Timeout fixe de 10 s** : un logo chargé très lentement peut ne pas s'afficher ; nouvelle tentative non garantie tant que le composant reste monté.
4. **Chargement non différé** : les éléments `img` ne portent pas actuellement `loading="lazy"`; l'écran peut déclencher plusieurs requêtes simultanées. Performance et impact sur les quotas à surveiller si le registre augmente.
5. **Pas de monitoring des échecs Brandfetch** : le fallback protège l'UI, mais ne donne pas de pourcentage de couverture en exploitation.
6. **Tests navigateur E2E ajoutés** : deux scénarios Playwright Chromium vérifient l'affichage d'un logo et le fallback HTTP 404 sur l'interface réelle, avec données de démonstration et réponses CDN interceptées. Ils ne vérifient ni le vrai fournisseur, ni Supabase locale avec les 30 entreprises, ni Lovable, ni tous les navigateurs. Aucune validation exhaustive mobile/accessibilité.
7. **Lint global** : non conforme dans des fichiers historiques de `main`; ce chantier ne doit pas entraîner de reformatage hors périmètre dans cette PR.
8. **Branches parallèles** : cette branche part de `main` ; elle n'inclut **pas** les changements de `fix/kora-publication-dates` ou `fix/kora-classification-multilingue`. Le plan d'intégration doit tenir compte de ces travaux avant fusion.
9. **Rattachement domaine → marque** : une réponse Brandfetch ne garantit pas que le logo correspond à l'entité juridique attendue ; l'utilisation éditoriale requiert une vérification distincte.

## 6. Critères de décision : PR / fusion / production

### Ouvrir une PR **en brouillon** pour revue

- [x] Branche isolée avec modifications ciblées.
- [x] Fonctionnalité désactivée sans Client ID.
- [x] Repli sur image indisponible et tests associés.
- [x] CI verte sur le code avant ce rapport ; nouveaux tests Playwright réussis sur `b3db7c1` ; vérifier la dernière tête de branche.
- [x] Recette manuelle sur la base locale des 30 entreprises (couverture partielle explicitement acceptée).
- [x] Documentation des modifications, de la configuration, des preuves et des risques.

### Avant fusion dans `main` (non autorisée par ce document)

- [ ] Revue contradictoire du code et de la sécurité, plus CI verte sur la tête de PR.
- [ ] Vérifier l'ordre d'intégration avec les branches dates et classification.
- [ ] Examiner les éventuels conflits et effectuer une recette de non-régression sur la version intégrée.
- [ ] Valider explicitement la décision de fusion.

### Avant activation sur Lovable / production

- [ ] Configurer le Client ID **public** dans l'environnement **de build** ; reconstruction et déploiement contrôlés.
- [ ] Tester l'accès au CDN avec la CSP réellement déployée.
- [ ] Vérifier le rendu avec un logo valide et un 404 sur poste et mobile.
- [ ] Vérifier tarifs/conditions de la Logo API, mentions de confidentialité et conditions d'utilisation des marques.
- [ ] Vérifier la stabilité et le budget de requêtes à l'échelle cible.

**Retour arrière fonctionnel sans migration** : retirer `VITE_BRANDFETCH_CLIENT_ID` du build, reconstruire et redéployer ; l'application affiche à nouveau les monogrammes. Le retrait de la variable sans rebuild ne suffit pas sur un artefact Vite déjà généré.

## 7. Contenu de la PR proposée

**Titre** : `feat(kora): logos automatiques des entreprises via Brandfetch`

**Head** : `feat/company-logos` · **Base** : `main`

La PR ne prétend **pas** couvrir 100 % des logos, résoudre la dette lint globale, certifier juridiquement les marques, ni être prête au déploiement Lovable. Aucun merge ni modification de base de données n'est demandé.

Voir aussi [Frontend](07-frontend.md) et [Sécurité et flux tiers](06-securite-et-flux-tiers.md).
