# KORA Newsroom IA — Inovallée

Espace éditorial d'Inovallée : veille des entreprises de l'écosystème, signaux scorés et sourcés, rédaction assistée, circuit d'approbation, et préparation de la diffusion sur WordPress, LinkedIn et la newsletter.

![Dashboard éditorial](docs/images/dashboard.webp)

## Démarrer

```bash
nvm use 24
bun install
SUPABASE_URL= bun run dev   # http://localhost:8080, données de démonstration en mémoire
```

Sans `SUPABASE_URL=`, le serveur local tente d'utiliser la base Supabase du projet (adresse lue dans `.env`) et répond `500`, faute de la clé de service fournie uniquement par Lovable Cloud. Voir [Démarrage rapide](docs/01-demarrage.md).

| Commande | Effet |
|---|---|
| `bun run test` | Tests Vitest |
| `npx tsc --noEmit -p .` | Vérification TypeScript |
| `bun run lint` | ESLint et Prettier |
| `bun run build` | Build de production (Cloudflare Workers) |

En production (Lovable Cloud), les données sont stockées dans la base Supabase du projet et la collecte lit réellement les flux RSS et Google News. Secrets lus côté serveur uniquement : `SUPABASE_SERVICE_ROLE_KEY` (fournie par Lovable Cloud) et, facultative, `AI_API_KEY` (clé OpenAI) pour améliorer les textes générés. Le fichier `.env` versionné ne contient que des valeurs publiques.

## Documentation

Toute la documentation est dans [`docs/`](docs/README.md) : démarrage, architecture, référence API, dictionnaire des données, règles métier, sécurité, frontend, guide utilisateur, exploitation, couverture du cahier des charges et anomalies connues.

## Lovable

Ce projet est connecté à [Lovable](https://lovable.dev/projects/40d714f1-3fc5-491b-9623-447358a56672) : chaque commit poussé sur `main` est synchronisé avec l'éditeur, et inversement. Ne réécrivez jamais un historique déjà poussé (pas de `push --force`, de rebase ni d'amend de commits publiés) et gardez `main` dans un état qui fonctionne. Voir [`AGENTS.md`](AGENTS.md).
