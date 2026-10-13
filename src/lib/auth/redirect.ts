export const LOGIN_PATH = "/connexion";
export const NEW_PASSWORD_PATH = "/connexion/nouveau-mot-de-passe";

const PROBE_ORIGIN = "https://kora.invalid";

export function isAuthPage(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

/**
 * Destination après connexion : uniquement un chemin interne (`/…`, ni `//`, ni `\`,
 * ni caractère de contrôle — les navigateurs retirent tabulations et retours à la ligne,
 * ce qui transformerait `/\t/hote` en `//hote`). Les pages de connexion et l'API sont
 * écartées pour éviter les boucles.
 */
export function safeRedirect(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  if (isAuthPage(url.pathname) || url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/connexion?redirect=…` (sans paramètre pour la page d'accueil). */
export function loginHref(redirect?: string | null): string {
  const target = safeRedirect(redirect, "");
  if (!target || target === "/") return LOGIN_PATH;
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(target)}`;
}

/** Chemin courant du navigateur (`null` pendant le rendu serveur). */
export function currentBrowserPath(): string | null {
  if (typeof window === "undefined") return null;
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}
