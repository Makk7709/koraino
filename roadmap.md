# Roadmap

- [x] Connecteur LinkedIn "par utilisateur" : table de stockage chiffré (migration 0001)
- [ ] Helpers passerelle App User Connector (server-only) + crypto clé de connexion
- [ ] Endpoints connexion : statut / démarrer / compléter / déconnecter (session app)
- [ ] Route de retour OAuth `/api/oauth/linkedin/return` (HTML public)
- [ ] Client API + carte de connexion sur la page LinkedIn
- [ ] Publication réelle via ugcPosts quand l'utilisateur est connecté (fallback export)
- [ ] Vérifications : typecheck, tests, parcours au navigateur

## Config LinkedIn (côté utilisateur, portail LinkedIn Developers)
- [ ] App LinkedIn : ajouter https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback comme URL de redirection autorisée (OAuth 2.0 settings) — en attente utilisateur
- [ ] App LinkedIn : demander les produits "Sign In with LinkedIn using OpenID Connect" et "Share on LinkedIn" (donne les scopes openid/profile/w_member_social) — en attente utilisateur
- [ ] App LinkedIn : noter que "Sign In with LinkedIn using OpenID Connect" exige une adresse e-mail ajoutée à l'app (verification) — en attente utilisateur
