import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { HttpError } from "../http";

/** Identité extraite d'un jeton d'accès Supabase vérifié. */
export interface TokenClaims {
  /** Identifiant du compte Supabase. */
  sub: string;
  /** E-mail en minuscules. */
  email: string | null;
  /** Expiration (secondes epoch). */
  exp: number | null;
}

export type TokenVerifier = (token: string) => Promise<TokenClaims | null>;

let verifierOverride: TokenVerifier | null = null;

export function setTokenVerifierForTests(fn: TokenVerifier | null): void {
  verifierOverride = fn;
}

export const authUnavailable = () =>
  new HttpError(
    503,
    "auth_unavailable",
    "Service d'authentification momentanément indisponible : réessayez dans un instant.",
  );

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** Les nouvelles clés Supabase sont opaques : jamais envoyées comme jeton Bearer. */
function supabaseFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (isNewSupabaseApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

let client: SupabaseClient | null = null;

function verifierClient(): SupabaseClient {
  if (client) return client;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY sont requis pour vérifier les jetons",
    );
  }
  client = createClient(url, key, {
    global: { fetch: supabaseFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return client;
}

const AUTHENTICATED = "authenticated";

function hasAudience(aud: unknown): boolean {
  return aud === AUTHENTICATED || (Array.isArray(aud) && aud.includes(AUTHENTICATED));
}

async function verifyWithSupabase(token: string): Promise<TokenClaims | null> {
  if (token.split(".").length !== 3) return null;
  const auth = verifierClient().auth;
  let result: Awaited<ReturnType<typeof auth.getClaims>>;
  try {
    result = await auth.getClaims(token);
  } catch (error) {
    // `alg` inattendu, clé incompatible, en-tête illisible : getClaims lève hors AuthError.
    if (isAuthRetryableFetchError(error)) throw authUnavailable();
    return null;
  }
  const { data, error } = result;
  if (error) {
    if (isAuthRetryableFetchError(error)) throw authUnavailable();
    return null;
  }
  const claims = data?.claims;
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  if (claims["is_anonymous"] === true) return null;
  if (claims.role !== AUTHENTICATED || !hasAudience(claims.aud)) return null;
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email.toLowerCase() : null,
    exp: typeof claims.exp === "number" ? claims.exp : null,
  };
}

/**
 * Null si le jeton est absent, mal formé, expiré, de signature ou d'algorithme invalide, ou
 * s'il n'est pas un jeton d'utilisateur connecté (`role` / `aud` différents de `authenticated`).
 */
export function verifyAccessToken(token: string): Promise<TokenClaims | null> {
  return (verifierOverride ?? verifyWithSupabase)(token);
}
