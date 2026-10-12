import type { AuthNotice } from "./types";

const KEY = "kora:auth-notice";

export const AUTH_NOTICES = {
  unauthenticated: {
    code: "unauthenticated",
    message: "Session absente ou expirée : reconnectez-vous.",
  },
  account_not_authorized: {
    code: "account_not_authorized",
    message:
      "Votre compte n'est pas autorisé sur KORA. Demandez à un administrateur de vous inviter.",
  },
} as const satisfies Record<AuthNotice["code"], AuthNotice>;

/** Conserve la raison d'une déconnexion forcée (survit à un rechargement de page). */
export function rememberAuthNotice(notice: AuthNotice): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(notice));
  } catch {
    // stockage indisponible (navigation privée stricte) : le message est simplement perdu
  }
}

/** Lit puis efface la raison mémorisée. */
export function takeAuthNotice(): AuthNotice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthNotice>;
    if (parsed.code === "unauthenticated" || parsed.code === "account_not_authorized") {
      return AUTH_NOTICES[parsed.code];
    }
    return null;
  } catch {
    return null;
  }
}
