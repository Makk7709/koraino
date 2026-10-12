/** Raison affichée sur la page de connexion après une déconnexion forcée. */
export interface AuthNotice {
  code: "unauthenticated" | "account_not_authorized";
  message: string;
}
