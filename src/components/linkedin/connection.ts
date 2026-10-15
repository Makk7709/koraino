import type { LinkedInConnection } from "@/lib/api/types";

export const LINKEDIN_UNAVAILABLE = "linkedin_unavailable";

export const POPUP_BLOCKED =
  "Votre navigateur a bloqué la fenêtre de connexion LinkedIn : autorisez les fenêtres surgissantes pour ce site, puis réessayez.";
export const NO_CODE = "LinkedIn n'a renvoyé aucun code de connexion : réessayez.";
export const OAUTH_FAILED = "La connexion LinkedIn a échoué : réessayez.";

/** Motifs d'échec renvoyés par la page de retour ; tout autre motif reste générique. */
export const OAUTH_FAILURES: Record<string, string> = {
  offline_access_disabled:
    "LinkedIn a accepté la connexion, mais aucune clé de connexion n'a été délivrée : l'accès hors ligne du connecteur LinkedIn doit être activé dans les réglages de la plateforme. Prévenez un administrateur.",
  access_denied: "Connexion LinkedIn annulée : l'autorisation n'a pas été accordée.",
};

/**
 * Une clé de connexion est enregistrée : la publication part du compte relié, même si LinkedIn
 * ne répond pas ou exige une reconnexion (elle échoue alors au lieu d'exporter).
 */
export const hasLinkedAccount = (c: LinkedInConnection | undefined): boolean =>
  !!c && (c.connected || !!c.reconnectRequired || c.error === LINKEDIN_UNAVAILABLE);
