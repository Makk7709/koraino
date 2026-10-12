import type { PublicationAttempt, User } from "@/lib/api/types";

/**
 * Même règle que le serveur : l'auteur de la tentative ou un admin ; sans auteur connu
 * (tentative ancienne), un admin seulement. Profil non chargé : rien n'est désactivé.
 */
export function resolutionBlockedReason(
  attempt: PublicationAttempt,
  me: User | undefined,
): string | null {
  if (!me || me.roles.includes("admin")) return null;
  if (attempt.byUserId && attempt.byUserId === me.id) return null;
  return attempt.byUserId
    ? `Seul ${attempt.by}, qui a lancé cette publication, ou un administrateur peut indiquer si elle figure sur LinkedIn.`
    : "L'auteur de cette publication n'est pas connu : seul un administrateur peut indiquer si elle figure sur LinkedIn.";
}
