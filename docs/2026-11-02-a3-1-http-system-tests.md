# A3.1 — réponse HTTP perdue et redémarrage

## Périmètre

Deux tests système HTTP sont ajoutés au banc PostgreSQL/PostgREST jetable existant.
Ils exécutent le routeur KORA réel dans un processus distinct avec DbRepository et
les RPC des migrations 0000, 0002 à 0007. Le fournisseur IA est un adaptateur
factice qui effectue une requête HTTP locale comptée hors du processus KORA.

L'identité utilise le mode démo via la couture de test existante. Ces tests ne
valident ni Supabase Auth, ni le navigateur, ni la conservation de la clé par le
client React, ni les API IA réelles. Le serveur de test n'est pas le serveur
Nitro compilé. Ce sont des preuves système côté HTTP/serveur/base, pas une
homologation E2E complète de l'interface.

## Scénarios et assertions

1. Le proxy attend la réponse complète du routeur, puis détruit la connexion
   sans envoyer de réponse au client. Le client doit constater un échec réseau.
   L'opération doit être durablement completed. Le rejeu avec la même clé doit
   retourner HTTP 201, le marqueur replayed et exactement le corps sauvegardé.
   Le compteur fournisseur doit rester à un ; les instantanés PostgreSQL
   (opération, usage, articles, réservations) doivent rester identiques.
2. Une deuxième génération est terminée. Le processus serveur est tué avec
   SIGKILL, puis remplacé par un nouveau processus avec PID distinct, sans
   redémarrer PostgreSQL ni le fournisseur factice. Le rejeu doit restituer le
   corps initial et replayed, sans nouvelle invocation. Au total : deux
   invocations pour deux intentions, deux articles, deux lignes d'usage
   supplémentaires et aucune réserve restante.

Le deuxième scénario porte sur un arrêt **après** finalisation, pas sur un
crash pendant un appel fournisseur ou sur une opération incertaine (A4).

## Exécution et preuves

```bash
env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY bash scripts/test-a3-postgres.sh
```

Prérequis : Bun, Docker Compose, curl et Python 3. Le script refuse les
identifiants Supabase hérités, crée un projet Docker unique et supprime ses
conteneurs et volumes à la sortie. Les hôtes HTTP écoutent uniquement sur
127.0.0.1 et des ports éphémères ; les requêtes applicatives sortantes sont
limitées à PostgREST et au fournisseur factice. Les lectures HTTP et le
démarrage/arrêt serveur sont bornés par des délais explicites.

Les événements attendus sont a3.e2e.lost_response.pass et
a3.e2e.restart.pass. Une absence ou un échec d'assertion fait échouer le job
isolated-postgres existant. Le succès doit être vérifié dans les logs du
commit concerné ; l'ajout de ce document n'atteste pas à lui seul l'exécution.

Aucun test rouge sur une ancienne version n'est revendiqué ici. La preuve
repose sur les assertions exécutées sur le commit soumis. Aucune migration
de production, fusion ou requête IA payante n'est nécessaire.
