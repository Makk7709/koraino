/**
 * Nombre de comptes nominatifs inclus dans l'abonnement (1 espace, 5 comptes). Le serveur refuse
 * d'en créer davantage (`POST /api/users`, 422 `account_limit`) ; l'interface l'affiche.
 */
export const MAX_ACCOUNTS = 5;
