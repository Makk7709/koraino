import { authUnavailable } from "./token";

/** Sous-ensemble utilisé d'un compte Supabase Auth. */
export interface AuthAccount {
  id: string;
  email?: string | undefined;
  email_confirmed_at?: string | null | undefined;
  /** Posé par `inviteUserByEmail` : compte créé (ou réinvité) par un administrateur. */
  invited_at?: string | null | undefined;
}

interface AdminError {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
}

type AdminResult<T> = { data: T; error: AdminError | null };

/** Appels `supabaseAdmin.auth.admin.*` utilisés (remplaçables en test). */
export interface AuthAdminApi {
  getUserById(uid: string): Promise<AdminResult<{ user: AuthAccount | null }>>;
  inviteUserByEmail(
    email: string,
    options?: { redirectTo?: string },
  ): Promise<AdminResult<{ user: AuthAccount | null }>>;
  listUsers(params?: {
    page?: number;
    perPage?: number;
  }): Promise<AdminResult<{ users: AuthAccount[]; total?: number }>>;
  deleteUser(id: string): Promise<AdminResult<{ user: AuthAccount | null }>>;
}

let adminOverride: AuthAdminApi | null = null;

export function setAuthAdminForTests(fake: AuthAdminApi | null): void {
  adminOverride = fake;
}

async function authAdmin(): Promise<AuthAdminApi> {
  if (adminOverride) return adminOverride;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin.auth.admin;
}

export async function getAuthAccount(id: string): Promise<AuthAccount | null> {
  const { data, error } = await (await authAdmin()).getUserById(id);
  if (error) {
    if (error.status === 404) return null;
    console.error("[auth] lecture du compte impossible :", error.message);
    throw authUnavailable();
  }
  return data.user;
}

const PER_PAGE = 1000;
const MAX_PAGES = 20;

/**
 * GoTrue n'offre pas de recherche par e-mail : parcours paginé jusqu'à une page vide ou au
 * total annoncé. Une recherche tronquée lève une erreur plutôt que de conclure « aucun compte ».
 */
export async function findAuthAccountByEmail(email: string): Promise<AuthAccount | null> {
  const admin = await authAdmin();
  const wanted = email.toLowerCase();
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      console.error("[auth] liste des comptes impossible :", error.message);
      throw authUnavailable();
    }
    const hit = data.users.find((a) => a.email?.toLowerCase() === wanted);
    if (hit) return hit;
    seen += data.users.length;
    if (!data.users.length || (data.total !== undefined && seen >= data.total)) return null;
  }
  console.error(
    `[auth] plus de ${MAX_PAGES * PER_PAGE} comptes : recherche par e-mail interrompue`,
  );
  throw authUnavailable();
}

export type InviteOutcome =
  | { invitation: "sent" | "existing_account"; account: AuthAccount }
  | { invitation: "failed"; message: string };

const NOT_INVITED_ACCOUNT =
  "Un compte existe déjà pour cette adresse sans être passé par une invitation KORA : vérifiez-le dans la console Lovable Cloud (Users) puis réinvitez.";
const SEND_FAILED = "L'invitation n'a pas pu être envoyée : renvoyez-la plus tard.";

function emailExists(error: AdminError): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    (error.status === 422 && /already/i.test(error.message))
  );
}

/**
 * Invite l'adresse (e-mail avec lien vers `redirectTo`) sans jamais reprendre un compte créé
 * par un tiers : la clé publishable permet à quiconque de s'inscrire avec n'importe quelle
 * adresse. Compte non confirmé : supprimé (avec le mot de passe choisi par l'inscrit) puis
 * remplacé par un compte neuf ; compte confirmé : rattaché seulement s'il est issu d'une
 * invitation (`invited_at`).
 */
export async function inviteAccount(email: string, redirectTo: string): Promise<InviteOutcome> {
  const admin = await authAdmin();
  const existing = await findAuthAccountByEmail(email);
  if (existing?.email_confirmed_at) {
    return existing.invited_at
      ? { invitation: "existing_account", account: existing }
      : { invitation: "failed", message: NOT_INVITED_ACCOUNT };
  }
  if (existing) {
    const removed = await admin.deleteUser(existing.id);
    if (removed.error && removed.error.status !== 404) {
      console.error(
        "[auth] suppression du compte non confirmé impossible :",
        removed.error.code,
        removed.error.message,
      );
      return { invitation: "failed", message: SEND_FAILED };
    }
  }
  const { data, error } = await admin.inviteUserByEmail(email, { redirectTo });
  if (!error && data.user) return { invitation: "sent", account: data.user };
  // Compte confirmé apparu entre la recherche et l'invitation : son origine est inconnue.
  if (error && emailExists(error)) return { invitation: "failed", message: NOT_INVITED_ACCOUNT };
  console.error("[auth] invitation impossible :", error?.code, error?.message);
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
    return {
      invitation: "failed",
      message: "Limite d'envoi d'e-mails atteinte : renvoyez l'invitation plus tard.",
    };
  }
  return { invitation: "failed", message: SEND_FAILED };
}
