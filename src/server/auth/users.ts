import { createHash } from "node:crypto";
import type { User } from "@/lib/api/types";
import { forbidden } from "../http";
import { audit } from "../services/journal";
import type { UserRecord } from "../store/records";
import type { Repository } from "../store/repository";
import { getAuthAccount } from "./admin";
import type { TokenClaims } from "./token";

/** Seule forme d'utilisateur renvoyée par l'API : les champs d'authentification restent internes. */
export function toPublicUser(u: UserRecord): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    team: u.team,
    roles: u.roles,
    avatarUrl: u.avatarUrl,
    hasAccount: !!u.authUserId && !!u.activatedAt,
  };
}

/**
 * Identifiant déterministe : deux créations simultanées pour la même adresse se heurtent à la
 * clé primaire au lieu de produire deux utilisateurs (pas de transactions en base).
 */
export function userIdForEmail(email: string): string {
  return `u_${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16)}`;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.split(/[._+-]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") : local;
}

/** `KORA_ADMIN_EMAILS` : adresses autorisées à s'amorcer administrateur (séparées par des virgules). */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env["KORA_ADMIN_EMAILS"] ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const accountNotAuthorized = () =>
  forbidden(
    "Votre compte n'est pas autorisé sur KORA. Demandez à un administrateur de vous inviter.",
    "account_not_authorized",
  );

/** Administrateur rattaché à un compte Supabase et déjà connecté au moins une fois. */
export function isActiveAdmin(u: UserRecord): boolean {
  return u.roles.includes("admin") && !!u.authUserId && !!u.activatedAt;
}

/**
 * Utilisateur KORA d'un compte Supabase vérifié : compte rattaché, sinon amorçage d'un
 * administrateur listé dans `KORA_ADMIN_EMAILS` (adresse confirmée) tant qu'aucun
 * administrateur actif n'existe, sinon 403.
 */
export async function resolveKoraUser(
  repo: Repository,
  claims: TokenClaims,
  now: Date,
): Promise<UserRecord> {
  const users = await repo.users.list();
  const linked = users.find((u) => u.authUserId === claims.sub);
  if (linked) return linked.activatedAt ? linked : markActivated(repo, linked, now);
  if (!claims.email || !adminEmails().has(claims.email)) throw accountNotAuthorized();
  // Sinon un administrateur listé, supprimé ou rétrogradé, se rétablirait à la requête suivante.
  if (users.some(isActiveAdmin)) throw accountNotAuthorized();
  return bootstrapAdmin(repo, claims.sub, now);
}

/**
 * Relu juste avant l'écriture : seul `activatedAt` change, une modification concurrente (rôles
 * retirés…) est conservée ; un utilisateur supprimé ou rattaché ailleurs entre-temps est refusé.
 */
async function markActivated(repo: Repository, user: UserRecord, now: Date): Promise<UserRecord> {
  const current = await repo.users.get(user.id);
  if (!current || current.authUserId !== user.authUserId) throw accountNotAuthorized();
  if (current.activatedAt) return current;
  const activated = { ...current, activatedAt: now.toISOString() };
  try {
    await repo.users.update(activated);
  } catch (error) {
    console.error("[auth] activation du compte non enregistrée :", error);
  }
  return activated;
}

async function bootstrapAdmin(repo: Repository, sub: string, now: Date): Promise<UserRecord> {
  const account = await getAuthAccount(sub);
  const email = account?.email?.toLowerCase();
  if (!account?.email_confirmed_at || !email || !adminEmails().has(email)) {
    throw accountNotAuthorized();
  }
  const users = await repo.users.list();
  const already = users.find((u) => u.authUserId === sub);
  if (already) return already;
  if (users.some(isActiveAdmin)) throw accountNotAuthorized();

  const at = now.toISOString();
  const existing = users.find((u) => u.email.toLowerCase() === email);
  let user: UserRecord;
  if (existing) {
    if (existing.authUserId) {
      console.warn(`[auth] ${existing.id} est déjà rattaché à un autre compte Supabase`);
      throw accountNotAuthorized();
    }
    const roles = existing.roles.includes("admin")
      ? existing.roles
      : ["admin" as const, ...existing.roles];
    user = { ...existing, roles, authUserId: sub, activatedAt: at };
    await repo.users.update(user);
  } else {
    user = {
      id: userIdForEmail(email),
      name: nameFromEmail(email),
      email,
      team: "Administration",
      roles: ["admin"],
      avatarUrl: null,
      authUserId: sub,
      activatedAt: at,
    };
    try {
      await repo.users.insert(user);
    } catch (error) {
      const winner = await repo.users.get(user.id);
      if (winner?.authUserId === sub) return winner;
      throw error;
    }
  }
  const saved = await repo.users.get(user.id);
  if (saved?.authUserId !== sub) throw accountNotAuthorized();
  await audit(
    { repo, user: saved, now },
    "user.bootstrap",
    "user",
    saved.id,
    `Administrateur initial (KORA_ADMIN_EMAILS) rattaché au compte ${email}`,
  );
  return saved;
}
