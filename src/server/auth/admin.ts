import { authUnavailable } from "./token";

/** Sous-ensemble utilisé d'un compte Supabase Auth. */
export interface AuthAccount {
  id: string;
  email?: string | undefined;
  email_confirmed_at?: string | null | undefined;
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
  }): Promise<AdminResult<{ users: AuthAccount[] }>>;
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

export async function findAuthAccountByEmail(email: string): Promise<AuthAccount | null> {
  const admin = await authAdmin();
  const wanted = email.toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      console.error("[auth] liste des comptes impossible :", error.message);
      throw authUnavailable();
    }
    const hit = data.users.find((a) => a.email?.toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < PER_PAGE) return null;
  }
  return null;
}

export type InviteOutcome =
  | { invitation: "sent" | "existing_account"; account: AuthAccount }
  | { invitation: "failed"; message: string };

function emailExists(error: AdminError): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    (error.status === 422 && /already/i.test(error.message))
  );
}

/**
 * Invite l'adresse (e-mail avec lien vers `redirectTo`). Un compte déjà confirmé n'est pas
 * réinvité : il est renvoyé pour rattachement. Supabase renvoie l'invitation d'un compte
 * existant non confirmé.
 */
export async function inviteAccount(email: string, redirectTo: string): Promise<InviteOutcome> {
  const admin = await authAdmin();
  const { data, error } = await admin.inviteUserByEmail(email, { redirectTo });
  if (!error && data.user) return { invitation: "sent", account: data.user };
  if (error && emailExists(error)) {
    const account = await findAuthAccountByEmail(email);
    if (account?.email_confirmed_at) return { invitation: "existing_account", account };
    return {
      invitation: "failed",
      message:
        "Un compte existe déjà pour cette adresse mais n'est pas confirmé : il doit d'abord valider son adresse e-mail.",
    };
  }
  console.error("[auth] invitation impossible :", error?.code, error?.message);
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
    return {
      invitation: "failed",
      message: "Limite d'envoi d'e-mails atteinte : renvoyez l'invitation plus tard.",
    };
  }
  return {
    invitation: "failed",
    message: "L'invitation n'a pas pu être envoyée : renvoyez-la plus tard.",
  };
}
