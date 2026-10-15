import { usesDatabase } from "../database";

export const WORDPRESS_VARIABLES = [
  "WORDPRESS_URL",
  "WORDPRESS_USERNAME",
  "WORDPRESS_APP_PASSWORD",
] as const;

export interface WordPressCredentials {
  /** Origine du site (avec le sous-dossier d'installation éventuel), sans barre finale. */
  site: string;
  username: string;
  /** Mot de passe d'application, espaces retirés. Secret : ne jamais journaliser ni renvoyer. */
  appPassword: string;
}

export type WordPressConfig =
  | { mode: "reel"; credentials: WordPressCredentials; missing: []; invalidUrl: false }
  | { mode: "simule"; credentials: null; missing: []; invalidUrl: false }
  | { mode: "non_configure"; credentials: null; missing: string[]; invalidUrl: boolean };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Adresse du site acceptée : https://, ou http:// pour localhost / 127.0.0.1 (développement,
 * tests). Ni identifiants, ni requête, ni fragment. Renvoie null si l'adresse est refusée.
 */
export function normalizeSiteUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Configuration lue à chaque appel (jamais au chargement du module). Mode `simule` : aucune
 * variable définie, sous Vitest ou sans base (démonstration locale) ; `non_configure` : tout autre
 * cas incomplet ou invalide, dont la production sans configuration.
 */
export function readWordPressConfig(): WordPressConfig {
  const env = process.env;
  const url = env["WORDPRESS_URL"]?.trim() ?? "";
  const username = env["WORDPRESS_USERNAME"]?.trim() ?? "";
  const appPassword = (env["WORDPRESS_APP_PASSWORD"] ?? "").replace(/\s+/g, "");
  if (!url && !username && !appPassword && (env["VITEST"] || !usesDatabase())) {
    return { mode: "simule", credentials: null, missing: [], invalidUrl: false };
  }
  const site = url ? normalizeSiteUrl(url) : null;
  const missing = [
    ...(site ? [] : ["WORDPRESS_URL"]),
    ...(username ? [] : ["WORDPRESS_USERNAME"]),
    ...(appPassword ? [] : ["WORDPRESS_APP_PASSWORD"]),
  ];
  if (!site || missing.length) {
    return { mode: "non_configure", credentials: null, missing, invalidUrl: !!url && !site };
  }
  return {
    mode: "reel",
    credentials: { site, username, appPassword },
    missing: [],
    invalidUrl: false,
  };
}
