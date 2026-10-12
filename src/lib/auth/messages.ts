import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
} from "@supabase/supabase-js";

const NETWORK =
  "Le service de connexion est injoignable. Vérifiez votre connexion réseau puis réessayez.";
const RATE_LIMIT = "Trop de tentatives : patientez quelques minutes avant de réessayer.";

const WEAK_REASONS: Record<string, string> = {
  length: "il est trop court",
  characters: "il doit mêler minuscules, majuscules, chiffres et symboles",
  pwned: "il figure dans une fuite de données connue",
};

function authCode(error: unknown): string | undefined {
  return isAuthError(error) ? error.code : undefined;
}

function isRateLimited(error: unknown): boolean {
  const code = authCode(error);
  return (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    (isAuthError(error) && error.status === 429)
  );
}

/** Échec de `signInWithPassword`. */
export function signInErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return NETWORK;
  if (isRateLimited(error)) return RATE_LIMIT;
  switch (authCode(error)) {
    case "invalid_credentials":
      return "E-mail ou mot de passe incorrect.";
    case "email_not_confirmed":
      return "Votre adresse e-mail n'est pas encore confirmée : ouvrez le lien d'invitation reçu par e-mail.";
    case "user_banned":
      return "Ce compte est suspendu. Contactez un administrateur KORA.";
    case "validation_failed":
      return "Saisissez une adresse e-mail et un mot de passe valides.";
  }
  if (isAuthError(error) && error.status === 400) return "E-mail ou mot de passe incorrect.";
  return "La connexion a échoué. Réessayez dans un instant.";
}

/** Échec de `resetPasswordForEmail`. */
export function resetRequestErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return NETWORK;
  if (isRateLimited(error)) return RATE_LIMIT;
  if (authCode(error) === "email_address_invalid" || authCode(error) === "validation_failed") {
    return "Cette adresse e-mail n'est pas valide.";
  }
  return "L'e-mail de réinitialisation n'a pas pu être envoyé. Réessayez dans un instant.";
}

/** Échec de `updateUser({ password })`. */
export function passwordErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return NETWORK;
  if (isRateLimited(error)) return RATE_LIMIT;
  if (isAuthWeakPasswordError(error)) {
    const reasons = error.reasons.map((r) => WEAK_REASONS[r]).filter(Boolean);
    return reasons.length
      ? `Mot de passe trop faible : ${reasons.join(" ; ")}.`
      : "Mot de passe trop faible : choisissez-en un plus long et plus varié.";
  }
  switch (authCode(error)) {
    case "same_password":
      return "Le nouveau mot de passe doit être différent de l'actuel.";
    case "weak_password":
      return "Mot de passe trop faible : choisissez-en un plus long et plus varié.";
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "reauthentication_needed":
      return "Ce lien a expiré ou a déjà été utilisé : demandez-en un nouveau.";
  }
  if (isAuthSessionMissingError(error)) {
    return "Ce lien a expiré ou a déjà été utilisé : demandez-en un nouveau.";
  }
  return "Le mot de passe n'a pas pu être enregistré. Réessayez dans un instant.";
}

/** Lien d'invitation / de réinitialisation refusé par Supabase. */
export function callbackErrorMessage(code: string): string {
  if (code === "otp_expired" || code === "access_denied") {
    return "Ce lien a expiré ou a déjà été utilisé. Les liens envoyés par e-mail ne sont valables qu'une fois et pour une durée limitée.";
  }
  return "Ce lien n'est pas valide. Demandez-en un nouveau.";
}
