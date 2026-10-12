import type { Role, User } from "@/lib/api/types";
import { forbidden } from "../http";

export type Action =
  | "registry.write"
  | "registry.delete"
  | "collect"
  | "signal.write"
  | "article.write"
  | "article.decide"
  | "publish"
  | "import.write"
  | "linkedin.write"
  | "linkedin.decide"
  | "newsletter.write"
  | "newsletter.decide"
  | "grid.write"
  | "rule.write"
  | "users.manage";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrateur",
  redacteur: "Rédacteur",
  validateur: "Validateur",
  lecteur: "Lecteur",
};

const EDITORS: Role[] = ["admin", "redacteur"];
const VALIDATORS: Role[] = ["admin", "validateur"];
const ADMINS: Role[] = ["admin"];

/** Matrice des droits (§7) : le lecteur ne dispose d'aucune action d'écriture. */
const MATRIX: Record<Action, { roles: Role[]; message: string }> = {
  "registry.write": {
    roles: EDITORS,
    message: "La modification du registre (entreprises, sources) est réservée aux rédacteurs.",
  },
  "registry.delete": {
    roles: ADMINS,
    message: "La suppression d'éléments du registre est réservée aux administrateurs.",
  },
  collect: { roles: EDITORS, message: "Le lancement d'une collecte est réservé aux rédacteurs." },
  "signal.write": {
    roles: EDITORS,
    message:
      "La qualification des signaux (statut, rattachement, fusion) est réservée aux rédacteurs.",
  },
  "article.write": {
    roles: EDITORS,
    message:
      "La rédaction, la modification et la soumission d'articles sont réservées aux rédacteurs.",
  },
  "article.decide": {
    roles: VALIDATORS,
    message: "L'approbation et le rejet d'un contenu sont réservés aux validateurs.",
  },
  publish: {
    roles: VALIDATORS,
    message: "La publication et l'export vers un canal sont réservés aux validateurs.",
  },
  "import.write": {
    roles: EDITORS,
    message: "L'import et la conversion d'articles humains sont réservés aux rédacteurs.",
  },
  "linkedin.write": {
    roles: EDITORS,
    message: "La préparation des posts LinkedIn est réservée aux rédacteurs.",
  },
  "linkedin.decide": {
    roles: VALIDATORS,
    message: "L'approbation des posts LinkedIn est réservée aux validateurs.",
  },
  "newsletter.write": {
    roles: EDITORS,
    message: "La composition de la newsletter est réservée aux rédacteurs.",
  },
  "newsletter.decide": {
    roles: VALIDATORS,
    message: "L'approbation de la newsletter est réservée aux validateurs.",
  },
  "grid.write": {
    roles: ADMINS,
    message: "La modification des grilles de score est réservée aux administrateurs.",
  },
  "rule.write": {
    roles: ADMINS,
    message: "La modification du référentiel éditorial est réservée aux administrateurs.",
  },
  "users.manage": {
    roles: ADMINS,
    message: "La gestion des utilisateurs et de leurs rôles est réservée aux administrateurs.",
  },
};

export function can(user: Pick<User, "roles">, action: Action): boolean {
  return MATRIX[action].roles.some((r) => user.roles.includes(r));
}

export function assertCan(user: Pick<User, "roles">, action: Action): void {
  if (can(user, action)) return;
  const roles = user.roles.map((r) => ROLE_LABEL[r]).join(", ") || "aucun rôle";
  throw forbidden(`${MATRIX[action].message} Votre profil (${roles}) ne le permet pas.`);
}

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role];
}
