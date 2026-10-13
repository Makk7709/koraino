export const MIN_PASSWORD_LENGTH = 8;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return "Saisissez votre adresse e-mail.";
  if (!EMAIL.test(v))
    return "Cette adresse e-mail n'est pas valide (exemple : prenom.nom@inovallee.fr).";
  return null;
}

/** Attributs ARIA d'un champ décrit par `AuthField` (`${id}-hint` / `${id}-error`). */
export function fieldAria(id: string, error: string | null | undefined, hasHint = false) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  };
}

export function newPasswordProblem(value: string): string | null {
  if (!value) return "Choisissez un mot de passe.";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  return null;
}
