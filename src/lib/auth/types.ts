/**
 * Types de l'authentification et de la gestion des comptes, déclarés localement en
 * attendant leur fusion dans `src/lib/api/types.ts` (contrat « auth-serveur »).
 */
import type { Role, User } from "@/lib/api/types";

/** `supabase` : comptes réels (production) ; `demo` : profils de démonstration. */
export type AuthMode = "supabase" | "demo";

/** `GET /api/auth/config`. */
export interface AuthConfigResponse {
  mode: AuthMode;
}

/** Utilisateur exposé par l'API : `hasAccount` indique un compte de connexion rattaché. */
export type AccountUser = User & { hasAccount?: boolean };

/** Résultat de l'envoi d'une invitation par e-mail. */
export type InvitationStatus = "sent" | "existing_account" | "not_applicable" | "failed";

/** Corps de `POST /api/users`. */
export interface CreateUserInput {
  name: string;
  email: string;
  team?: string;
  roles: Role[];
}

/** Corps de `PATCH /api/users/:id`. */
export interface UpdateUserInput {
  name?: string;
  team?: string;
  roles?: Role[];
}

/** `201` de `POST /api/users`. */
export interface CreateUserResponse {
  user: AccountUser;
  invitation: InvitationStatus;
  /** Motif éventuel d'un échec d'invitation. */
  message?: string;
}

/** `200` de `POST /api/users/:id/invite`. */
export interface InvitationResponse {
  invitation: InvitationStatus;
  message?: string;
}

/** Codes d'erreur serveur propres à l'authentification et aux comptes. */
export type AuthErrorCode =
  | "unauthenticated"
  | "account_not_authorized"
  | "demo_only"
  | "email_taken"
  | "last_admin"
  | "self_demotion"
  | "self_delete";

/** Raison affichée sur la page de connexion après une déconnexion forcée. */
export interface AuthNotice {
  code: "unauthenticated" | "account_not_authorized";
  message: string;
}
