import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { resetAdapters } from "@/server/adapters";
import { setAuthAdminForTests, type AuthAccount, type AuthAdminApi } from "@/server/auth/admin";
import { setAuthModeForTests } from "@/server/auth/mode";
import { setTokenVerifierForTests } from "@/server/auth/token";
import { setClock } from "@/server/clock";
import { handleApiRequest } from "@/server/router";
import { resetStore } from "@/server/store/memory";

/** Instant de référence des tests (heure locale). */
export const NOW = new Date(2026, 9, 12, 10, 30, 0);

type Globals = { File: unknown; Blob: unknown };
let savedGlobals: Globals | null = null;

/**
 * Le setup partagé impose jsdom, qui remplace File/Blob ; le serveur s'exécute avec les
 * classes Node (nécessaires à `Request.formData()`).
 */
function installNodeGlobals() {
  const g = globalThis as unknown as Globals;
  savedGlobals ??= { File: g.File, Blob: g.Blob };
  g.File = NodeFile;
  g.Blob = NodeBlob;
}

/** Store réinitialisé depuis le seed déterministe, horloge figée. */
export function setup(at: Date = NOW) {
  installNodeGlobals();
  setClock(() => at);
  resetAdapters();
  return resetStore({ now: at });
}

export function teardown() {
  setClock(null);
  if (savedGlobals) Object.assign(globalThis, savedGlobals);
  savedGlobals = null;
}

export interface CallOptions {
  body?: unknown;
  /** Corps brut (ex. multipart construit à la main). */
  raw?: { body: Uint8Array<ArrayBuffer>; contentType: string };
  user?: string;
  /** false = omettre l'en-tête anti-CSRF. */
  csrf?: boolean;
  headers?: Record<string, string>;
}

export interface CallResult<T> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export async function call<T = unknown>(
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<CallResult<T>> {
  const headers = new Headers(opts.headers);
  if (method !== "GET" && opts.csrf !== false) headers.set("x-kora-request", "1");
  if (opts.user) headers.set("cookie", `kora_uid=${opts.user}`);
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers.set("content-type", opts.raw.contentType);
    body = opts.raw.body;
  } else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const res = await handleApiRequest(
    new Request(`http://localhost/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
    }),
  );
  // `Response.text()` retire le BOM : décodage explicite pour pouvoir le vérifier.
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
  let parsed: unknown = text;
  if (
    (res.headers.get("content-type") ?? "").includes("application/json") &&
    !res.headers.get("content-disposition")
  ) {
    parsed = text ? JSON.parse(text) : undefined;
  }
  return { status: res.status, body: parsed as T, text, headers: res.headers };
}

/** Corps multipart/form-data construit octet par octet (indépendant de l'environnement de test). */
export function multipart(
  fields: Record<string, string>,
  file?: { name: string; type: string; content: Uint8Array | string },
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = "----KoraTestBoundary7MA4YWxkTrZu0gW";
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    chunks.push(
      enc.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
    );
    chunks.push(typeof file.content === "string" ? enc.encode(file.content) : file.content);
    chunks.push(enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export const USERS = {
  admin: "u_sophie",
  redacteur: "u_lucas",
  validateur: "u_claire",
  lecteur: "u_marc",
} as const;

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

type AdminError = { message: string; code?: string; status?: number };

export interface FakeSupabaseAuth {
  admin: AuthAdminApi;
  accounts: Map<string, AuthAccount>;
  invites: { email: string; redirectTo: string | undefined }[];
  addAccount(email: string, opts?: { confirmed?: boolean }): AuthAccount;
  /** Acceptation d'une invitation : l'adresse devient confirmée. */
  confirm(accountId: string): void;
  /** Jeton d'accès valide pour le compte (expiration en secondes epoch). */
  tokenFor(accountId: string, exp?: number): string;
  failNextInvite(error: AdminError): void;
}

/**
 * Mode supabase simulé (le dépôt reste en mémoire) : jetons et comptes Supabase Auth factices.
 * L'invitation imite GoTrue : `email_exists` pour un compte confirmé, renvoi sinon.
 */
export function useFakeSupabaseAuth(): FakeSupabaseAuth {
  let seq = 0;
  let nextInviteError: AdminError | null = null;
  const accounts = new Map<string, AuthAccount>();
  const tokens = new Map<string, { sub: string; exp: number }>();
  const invites: FakeSupabaseAuth["invites"] = [];
  const nowSec = Math.floor(NOW.getTime() / 1000);
  const create = (email: string, confirmed: boolean): AuthAccount => {
    const account: AuthAccount = {
      id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
      email: email.toLowerCase(),
      email_confirmed_at: confirmed ? NOW.toISOString() : null,
    };
    accounts.set(account.id, account);
    return account;
  };
  const admin: AuthAdminApi = {
    async getUserById(uid) {
      const account = accounts.get(uid);
      return account
        ? { data: { user: { ...account } }, error: null }
        : {
            data: { user: null },
            error: { message: "User not found", code: "user_not_found", status: 404 },
          };
    },
    async inviteUserByEmail(email, options) {
      invites.push({ email, redirectTo: options?.redirectTo });
      if (nextInviteError) {
        const error = nextInviteError;
        nextInviteError = null;
        return { data: { user: null }, error };
      }
      const existing = [...accounts.values()].find((a) => a.email === email.toLowerCase());
      if (existing?.email_confirmed_at) {
        return {
          data: { user: null },
          error: {
            message: "A user with this email address has already been registered",
            code: "email_exists",
            status: 422,
          },
        };
      }
      return { data: { user: { ...(existing ?? create(email, false)) } }, error: null };
    },
    async listUsers(params) {
      const perPage = params?.perPage ?? 50;
      const page = params?.page ?? 1;
      const users = [...accounts.values()].slice((page - 1) * perPage, page * perPage);
      return { data: { users: users.map((a) => ({ ...a })) }, error: null };
    },
  };
  setAuthModeForTests("supabase");
  setTokenVerifierForTests(async (token) => {
    const entry = tokens.get(token);
    const account = entry && accounts.get(entry.sub);
    if (!entry || !account) return null;
    return { sub: account.id, email: account.email ?? null, exp: entry.exp };
  });
  setAuthAdminForTests(admin);
  return {
    admin,
    accounts,
    invites,
    addAccount: (email, opts) => create(email, opts?.confirmed ?? true),
    confirm(accountId) {
      accounts.get(accountId)!.email_confirmed_at = NOW.toISOString();
    },
    tokenFor(accountId, exp = nowSec + 3000) {
      const token = `jwt.${accountId}.${tokens.size + 1}`;
      tokens.set(token, { sub: accountId, exp });
      return token;
    },
    failNextInvite(error) {
      nextInviteError = error;
    },
  };
}

/** À appeler après chaque test qui a forcé le mode supabase. */
export function resetAuthSeams() {
  setAuthModeForTests(null);
  setTokenVerifierForTests(null);
  setAuthAdminForTests(null);
}
