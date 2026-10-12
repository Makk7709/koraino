import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ApiError, api } from "@/lib/api/client";
import { parseAuthCallback, type AuthCallbackInfo } from "./callback";
import { passwordErrorMessage, resetRequestErrorMessage, signInErrorMessage } from "./messages";
import { getAuthMode } from "./mode";
import { AUTH_NOTICES, takeAuthNotice } from "./notice";
import { LOGIN_PATH, NEW_PASSWORD_PATH } from "./redirect";
import type { AuthMode, User } from "@/lib/api/types";
import type { AuthNotice } from "./types";

export interface AuthState {
  status: "loading" | "ready";
  mode: AuthMode | null;
  session: Session | null;
  /** Vérification serveur (`POST /api/auth/session`) de la session courante. */
  verification: "idle" | "pending" | "ok" | "error";
  /** Utilisateur KORA renvoyé par le serveur pour la session courante. */
  user: User | null;
  /** Raison de la dernière déconnexion forcée (401 / 403). */
  notice: AuthNotice | null;
}

export type SessionCheck =
  | { ok: true; user: User }
  | {
      ok: false;
      reason: "unauthenticated" | "account_not_authorized" | "unavailable";
      message: string;
    };

export type AuthActionResult = { ok: true } | { ok: false; message: string };

const INITIAL: AuthState = {
  status: "loading",
  mode: null,
  session: null,
  verification: "idle",
  user: null,
  notice: null,
};

const SERVER_UNAVAILABLE =
  "Le serveur KORA n'a pas pu valider votre session. Réessayez dans un instant.";
const NOT_CONFIGURED = "Le service de connexion n'est pas disponible pour le moment.";

let state: AuthState = INITIAL;
const listeners = new Set<() => void>();
let started = false;
let listening = false;
let callbackInfo: AuthCallbackInfo | null = null;
let callbackRedirectDone = false;
/** Utilisateur dont la vérification serveur a abouti (succès ou serveur injoignable). */
let settledUserId: string | null = null;
let lastCheck: { token: string; promise: Promise<SessionCheck> } | null = null;
let closing: Promise<void> | null = null;

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function applySession(session: Session | null) {
  if (!session) {
    settledUserId = null;
    setState({ status: "ready", session: null, verification: "idle", user: null });
    return;
  }
  const known = settledUserId === session.user.id && state.session?.user.id === session.user.id;
  setState({
    status: "ready",
    session,
    verification: known ? state.verification : "pending",
    user: known ? state.user : null,
  });
}

/** Efface le cookie `__Host-kora_session` (requêtes simultanées regroupées). */
function closeServerSession(): Promise<void> {
  closing ??= api
    .closeServerSession()
    .catch(() => undefined)
    .finally(() => {
      closing = null;
    });
  return closing;
}

async function discardSession(notice: AuthNotice | null) {
  settledUserId = null;
  setState({ notice });
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // session locale déjà absente
  }
  applySession(null);
}

async function settleCheck(session: Session, check: SessionCheck) {
  const current = state.session?.user.id === session.user.id;
  if (check.ok) {
    settledUserId = session.user.id;
    if (current) setState({ verification: "ok", user: check.user, notice: null });
    return;
  }
  if (check.reason === "unavailable") {
    settledUserId = session.user.id;
    if (current && state.verification === "pending") setState({ verification: "error" });
    return;
  }
  // Un refus visant un jeton déjà remplacé (rafraîchissement entre-temps) est ignoré.
  if (state.session?.access_token !== session.access_token) return;
  await discardSession(AUTH_NOTICES[check.reason]);
}

/**
 * Fait valider la session par le serveur (qui pose aussi le cookie `__Host-kora_session`).
 * Un même jeton n'est vérifié qu'une fois (sauf serveur injoignable) ; 401 / 403
 * déconnectent la session Supabase.
 */
function verifySession(session: Session): Promise<SessionCheck> {
  const token = session.access_token;
  if (lastCheck?.token === token) return lastCheck.promise;
  const promise = api
    .openServerSession(token)
    .then(
      (user): SessionCheck => ({ ok: true, user }),
      (e: unknown): SessionCheck => {
        if (e instanceof ApiError && e.status === 403) {
          return {
            ok: false,
            reason: "account_not_authorized",
            message: AUTH_NOTICES.account_not_authorized.message,
          };
        }
        if (e instanceof ApiError && e.status === 401) {
          return {
            ok: false,
            reason: "unauthenticated",
            message: AUTH_NOTICES.unauthenticated.message,
          };
        }
        return { ok: false, reason: "unavailable", message: SERVER_UNAVAILABLE };
      },
    )
    .then(async (check) => {
      if (!check.ok && check.reason === "unavailable" && lastCheck?.token === token) {
        lastCheck = null;
      }
      await settleCheck(session, check);
      return check;
    });
  lastCheck = { token, promise };
  return promise;
}

function onAuthEvent(event: AuthChangeEvent, session: Session | null) {
  if (event === "SIGNED_OUT" || !session) {
    applySession(null);
    if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") void closeServerSession();
    return;
  }
  applySession(session);
  void verifySession(session);
}

async function resolveMode(refresh: boolean) {
  const mode = await getAuthMode({ refresh });
  if (mode === "demo") {
    setState({ status: "ready", mode });
    return;
  }
  if (listening) return;
  listening = true;
  setState({ status: "loading", mode });
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      // Différé : appeler le client Supabase depuis ce rappel peut l'interbloquer.
      setTimeout(() => onAuthEvent(event, session), 0);
    });
  } catch {
    setState({ status: "ready", session: null });
  }
}

function captureCallback(): AuthCallbackInfo {
  callbackInfo ??=
    typeof window === "undefined"
      ? { type: null, error: null }
      : parseAuthCallback(window.location.href);
  return callbackInfo;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  captureCallback();
  const notice = takeAuthNotice();
  if (notice) setState({ notice });
  void resolveMode(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => INITIAL;

/** État d'authentification (toujours `loading` pendant le rendu serveur). */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Relit le mode serveur si le précédent appel avait échoué (repli `demo`). */
export function refreshAuthMode(): Promise<void> {
  return resolveMode(true);
}

/** Paramètres du lien d'invitation / de réinitialisation présents au chargement de la page. */
export function getAuthCallbackInfo(): AuthCallbackInfo {
  return captureCallback();
}

/**
 * Vrai une seule fois quand un lien e-mail a atterri ailleurs que sur la page « nouveau mot
 * de passe » (URL de redirection refusée par Supabase : repli sur l'URL du site).
 */
export function takeMisroutedCallback(pathname: string): boolean {
  if (callbackRedirectDone || pathname === NEW_PASSWORD_PATH) return false;
  const info = captureCallback();
  if (!info.error && info.type !== "invite" && info.type !== "recovery") return false;
  callbackRedirectDone = true;
  return true;
}

export function dismissAuthNotice(): void {
  if (state.notice) setState({ notice: null });
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthActionResult> {
  let session: Session | null;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) return { ok: false, message: signInErrorMessage(error) };
    session = data.session;
  } catch {
    return { ok: false, message: NOT_CONFIGURED };
  }
  setState({ notice: null });
  applySession(session);
  const check = await verifySession(session);
  if (check.ok) return { ok: true };
  // Le formulaire affiche lui-même le motif : pas de bandeau en double.
  await discardSession(null);
  return { ok: false, message: check.message };
}

export async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${NEW_PASSWORD_PATH}`,
    });
    return error ? { ok: false, message: resetRequestErrorMessage(error) } : { ok: true };
  } catch {
    return { ok: false, message: NOT_CONFIGURED };
  }
}

/**
 * Définit le mot de passe puis ferme les autres sessions du compte (ouvertes p. ex. par un
 * tiers qui connaissait le mot de passe précédent) ; un échec de cette fermeture ne bloque pas.
 */
export async function updatePassword(password: string): Promise<AuthActionResult> {
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, message: passwordErrorMessage(error) };
  } catch {
    return { ok: false, message: NOT_CONFIGURED };
  }
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  return { ok: true };
}

/** Déconnexion volontaire : Supabase, cookie serveur, puis rechargement sur `/connexion`. */
export async function signOut(): Promise<void> {
  settledUserId = null;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: "local" });
  } catch {
    // le rechargement suivant repart d'un état propre
  }
  await closeServerSession();
  window.location.assign(LOGIN_PATH);
}

export function resetAuthStoreForTests(): void {
  state = INITIAL;
  started = false;
  listening = false;
  callbackInfo = null;
  callbackRedirectDone = false;
  settledUserId = null;
  lastCheck = null;
  closing = null;
}
