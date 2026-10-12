import { parseCookies, SESSION_COOKIE, unauthenticated } from "../http";
import type { UserRecord } from "../store/records";
import type { Repository } from "../store/repository";
import { DEFAULT_USER_ID } from "../store/seed";
import { authMode } from "./mode";
import { verifyAccessToken, type TokenClaims } from "./token";
import { resolveKoraUser } from "./users";

/** Copie du jeton d'accès pour les téléchargements par lien direct (mode supabase). */
export const AUTH_COOKIE = "kora_session";
export const MAX_SESSION_SECONDS = 3600;

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function authSessionCookie(token: string, maxAge: number): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; ${COOKIE_ATTRIBUTES}; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function clearAuthSessionCookie(): string {
  return `${AUTH_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/**
 * `Authorization: Bearer` en priorité ; le cookie `kora_session` n'est accepté qu'en lecture
 * (GET/HEAD) : toute écriture doit présenter le jeton explicitement.
 */
export function readAccessToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
    return match?.[1] ?? null;
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  return parseCookies(request.headers.get("cookie"))[AUTH_COOKIE] || null;
}

export interface Authenticated {
  user: UserRecord;
  /** Jeton vérifié (mode supabase uniquement). */
  token: string | null;
  claims: TokenClaims | null;
}

/** Utilisateur de la requête ; 401 `unauthenticated` ou 403 `account_not_authorized` en mode supabase. */
export async function authenticate(
  request: Request,
  repo: Repository,
  now: Date,
): Promise<Authenticated> {
  if (authMode() === "demo") {
    const cookies = parseCookies(request.headers.get("cookie"));
    const user =
      (cookies[SESSION_COOKIE] ? await repo.users.get(cookies[SESSION_COOKIE]) : undefined) ??
      (await repo.users.get(DEFAULT_USER_ID));
    if (!user) throw new Error("Utilisateur par défaut absent du store");
    return { user, token: null, claims: null };
  }
  const token = readAccessToken(request);
  if (!token) throw unauthenticated();
  const claims = await verifyAccessToken(token);
  if (!claims) throw unauthenticated();
  return { user: await resolveKoraUser(repo, claims, now), token, claims };
}
