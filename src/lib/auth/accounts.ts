import { ApiError } from "@/lib/api/client";
import type { InvitationStatus } from "@/lib/api/types";

const ACCOUNT_ERRORS: Record<string, { title: string; fallback: string }> = {
  email_taken: {
    title: "Adresse e-mail déjà utilisée",
    fallback: "Un utilisateur KORA utilise déjà cette adresse e-mail.",
  },
  last_admin: {
    title: "Dernier administrateur",
    fallback: "KORA doit conserver au moins un administrateur.",
  },
  self_demotion: {
    title: "Votre rôle administrateur est conservé",
    fallback:
      "Vous ne pouvez pas retirer votre propre rôle d'administrateur : demandez-le à un autre administrateur.",
  },
  self_delete: {
    title: "Suppression de votre compte impossible",
    fallback: "Vous ne pouvez pas supprimer votre propre compte.",
  },
  validation_error: {
    title: "Informations incomplètes ou invalides",
    fallback: "Vérifiez le nom, l'adresse e-mail et les rôles saisis.",
  },
};

/** Titre et explication en français d'une erreur des routes `/users`. */
export function accountError(e: unknown, defaultTitle: string): { title: string; message: string } {
  if (e instanceof ApiError) {
    const known = ACCOUNT_ERRORS[e.code];
    const serverMessage = e.message && e.message !== e.code ? e.message : "";
    if (known) return { title: known.title, message: serverMessage || known.fallback };
    if (e.status === 403) {
      return {
        title: "Action réservée aux administrateurs",
        message: serverMessage || "Votre profil ne permet pas de gérer les comptes.",
      };
    }
    if (e.status === 404) {
      return {
        title: "Utilisateur introuvable",
        message: "Ce compte a peut-être déjà été supprimé : rechargez la liste.",
      };
    }
    return { title: defaultTitle, message: serverMessage || "Réessayez dans un instant." };
  }
  return {
    title: defaultTitle,
    message: e instanceof Error && e.message ? e.message : "Erreur inattendue.",
  };
}

/** Retour affiché après la création d'un compte ou le renvoi d'une invitation. */
export function invitationFeedback(
  status: InvitationStatus,
  email: string,
  serverMessage?: string,
): { tone: "success" | "warning"; text: string } {
  switch (status) {
    case "sent":
      return { tone: "success", text: `Invitation envoyée à ${email}.` };
    case "existing_account":
      return {
        tone: "success",
        text: `${email} possède déjà un compte de connexion : il est rattaché, la personne peut se connecter.`,
      };
    case "not_applicable":
      return { tone: "success", text: "Mode démonstration : aucune invitation n'est envoyée." };
    case "failed": {
      const reason = serverMessage?.trim().replace(/[.\s]+$/, "");
      return {
        tone: "warning",
        text: `L'invitation n'a pas pu être envoyée à ${email}${reason ? ` : ${reason}.` : "."} Réessayez avec « Renvoyer l'invitation ».`,
      };
    }
  }
}
