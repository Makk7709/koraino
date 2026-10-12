# Roadmap

- [x] Connecteur LinkedIn "par utilisateur" : table de stockage chiffré (migration 0001)
- [x] Helpers passerelle App User Connector (server-only) + crypto clé de connexion
- [x] Endpoints connexion : statut / démarrer / compléter / déconnecter (session app)
- [x] Route de retour OAuth `/api/oauth/linkedin/return` (HTML public)
- [x] Client API + carte de connexion sur la page LinkedIn
- [x] Publication réelle via ugcPosts quand l'utilisateur est connecté (fallback export)
- [ ] Vérifications : typecheck, tests, parcours au navigateur

## Config LinkedIn (côté utilisateur, portail LinkedIn Developers)
 - [x] App LinkedIn : ajouter https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback comme URL de redirection autorisée (OAuth 2.0 settings) — en attente utilisateur
 - [x] App LinkedIn : demander les produits "Sign In with LinkedIn using OpenID Connect" et "Share on LinkedIn" (donne les scopes openid/profile/w_member_social) — en attente utilisateur
 - [x] App LinkedIn : noter que "Sign In with LinkedIn using OpenID Connect" exige une adresse e-mail ajoutée à l'app (verification) — en attente utilisateur
- [x] Publication réelle via ugcPosts + carte de connexion testée (typecheck OK, 76/76 tests, popup OAuth ouverte avec la bonne URL passerelle)
- [ ] Consentement LinkedIn refuse (page "something went wrong") : vérifier côté portail LinkedIn que les 2 produits sont approuvés/actifs sur l'app — en attente utilisateur
- [ ] Parcours complet : connexion → publication réelle → post visible sur LinkedIn
