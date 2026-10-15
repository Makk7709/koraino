import { HttpError } from "../http";

export type WordPressErrorCode =
  | "wordpress_not_configured"
  | "wordpress_auth_failed"
  | "wordpress_forbidden"
  | "wordpress_blocked"
  | "wordpress_rate_limited"
  | "wordpress_invalid"
  | "wordpress_unavailable"
  | "wordpress_role_too_high";

/** Configuration à corriger par un administrateur (et non panne du site) : 503. */
const CONFIGURATION_CODES: readonly WordPressErrorCode[] = [
  "wordpress_not_configured",
  "wordpress_role_too_high",
];

/**
 * Échec d'un échange avec le site WordPress, déjà traduit pour l'utilisateur : message en
 * français, jamais d'identifiant ni de mot de passe. `verifyBeforeRetry` : WordPress a peut-être
 * traité la requête malgré l'erreur (délai dépassé, coupure, 5xx, réponse illisible) ; seul un
 * envoi de création en tient compte. `remoteId` : contenu que WordPress a bien enregistré (réponse
 * 2xx d'écriture inexploitable par ailleurs).
 */
export class WordPressError extends HttpError {
  declare code: WordPressErrorCode;

  constructor(
    code: WordPressErrorCode,
    message: string,
    readonly verifyBeforeRetry = false,
    readonly remoteId: string | null = null,
  ) {
    super(CONFIGURATION_CODES.includes(code) ? 503 : 502, code, message);
    this.name = "WordPressError";
  }
}

/** Compte capable de publier : KORA n'écrit rien (un `draft` envoyé dépublierait un article). */
export function roleTooHigh(): WordPressError {
  return new WordPressError(
    "wordpress_role_too_high",
    "Le compte WordPress utilisé par KORA peut publier : par sécurité, KORA exige un compte de rôle Contributeur. Un administrateur doit changer le rôle du compte dans WordPress.",
  );
}

const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : (names[0] ?? "");

/** `invalidUrl` : WORDPRESS_URL est renseignée mais refusée (pas en https, identifiants, requête…). */
export function notConfigured(missing: string[], invalidUrl = false): WordPressError {
  const names = missing.length
    ? missing
    : ["WORDPRESS_URL", "WORDPRESS_USERNAME", "WORDPRESS_APP_PASSWORD"];
  const url = invalidUrl
    ? " WORDPRESS_URL doit être l'adresse du site en https:// (http:// seulement pour localhost)."
    : "";
  return new WordPressError(
    "wordpress_not_configured",
    `WordPress n'est pas configuré : un administrateur doit renseigner ${list(names)} dans les secrets de l'hébergement (voir Paramètres > WordPress).${url}`,
  );
}
