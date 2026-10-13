import type { CreatedUser, InvitationResult, InvitationStatus, Role } from "@/lib/api/types";
import { disconnectAppUser } from "@/integrations/lovable/appUserConnector";
import { deleteConnectionKeyForUser } from "../appUserConnections.server";
import { inviteAccount } from "../auth/admin";
import { authMode } from "../auth/mode";
import { isActiveAdmin, toPublicUser, userIdForEmail } from "../auth/users";
import type { Ctx, Handler } from "../context";
import { assertCan, roleLabel } from "../domain/permissions";
import { conflict, json, noContent, notFound, unprocessable } from "../http";
import { discardPendingConnect } from "../linkedin/pendingConnect";
import { publicOrigin } from "../publicUrl";
import { audit } from "../services/journal";
import type { UserRecord } from "../store/records";
import { defined, parse, schemas } from "../validation";
import { GATEWAY_BASE_URL, LINKEDIN_CONNECTOR_ID, readConnectionKey } from "./connectors";

/* ------------------------------------------------------------------ */
/* Gestion des utilisateurs (administrateurs)                          */
/* ------------------------------------------------------------------ */

const INVITATION_LABEL: Record<InvitationStatus, string> = {
  sent: "invitation envoyée",
  existing_account: "compte existant rattaché",
  not_applicable: "sans invitation (démonstration)",
  failed: "invitation en échec",
};

const rolesText = (roles: Role[]) => roles.map(roleLabel).join(", ");

const USERS_LOCK = "users:admins";
/** Couvre aussi les invitations faites sous verrou (pagination et envoi Supabase Auth). */
const USERS_LOCK_TTL_MS = 60_000;

async function getUserOr404(ctx: Ctx): Promise<UserRecord> {
  const user = await ctx.repo.users.get(ctx.params["id"]!);
  if (!user) throw notFound("Utilisateur introuvable.");
  return user;
}

/**
 * Création, modification, suppression et invitation sous verrou : sans transactions en base,
 * deux administrateurs qui se rétrogradent l'un l'autre passeraient chacun le contrôle
 * « dernier administrateur », et une invitation réécrirait une modification faite pendant son
 * appel réseau. Les droits de l'auteur sont relus sous le verrou.
 */
async function withUsersLock(ctx: Ctx, fn: () => Promise<Response>): Promise<Response> {
  const token = await ctx.repo.acquireLock(USERS_LOCK, USERS_LOCK_TTL_MS);
  if (!token) {
    throw conflict(
      "users_busy",
      "Une autre modification des utilisateurs est en cours : réessayez dans quelques secondes.",
    );
  }
  try {
    assertCan((await ctx.repo.users.get(ctx.user.id)) ?? { roles: [] }, "users.manage");
    return await fn();
  } finally {
    await ctx.repo.releaseLock(USERS_LOCK, token).catch((e: unknown) => {
      console.error(`[users] verrou ${USERS_LOCK} non libéré`, e);
    });
  }
}

/**
 * Il doit rester un autre administrateur que la cible. En mode supabase, seuls comptent les
 * administrateurs actifs : un administrateur sans compte ne peut pas se connecter.
 */
async function assertNotLastAdmin(ctx: Ctx, target: UserRecord, message: string): Promise<void> {
  const counts =
    authMode() === "supabase" ? isActiveAdmin : (u: UserRecord) => u.roles.includes("admin");
  const others = (await ctx.repo.users.list()).filter((u) => u.id !== target.id && counts(u));
  if (!others.length) throw unprocessable("last_admin", message);
}

/**
 * Invite l'adresse (mode supabase) et rattache le compte Supabase renvoyé à l'utilisateur,
 * relu après l'appel réseau : seuls `authUserId` et `activatedAt` sont écrits, une modification
 * faite entre-temps (rôles, nom, équipe) est conservée.
 */
async function invite(
  ctx: Ctx,
  user: UserRecord,
): Promise<{ user: UserRecord; result: InvitationResult }> {
  if (authMode() !== "supabase") return { user, result: { invitation: "not_applicable" } };
  let outcome: Awaited<ReturnType<typeof inviteAccount>>;
  try {
    outcome = await inviteAccount(
      user.email,
      `${publicOrigin(ctx)}/connexion/nouveau-mot-de-passe`,
    );
  } catch (error) {
    console.error("[users] invitation impossible :", error);
    outcome = {
      invitation: "failed",
      message: "Service d'authentification indisponible : renvoyez l'invitation plus tard.",
    };
  }
  if (outcome.invitation === "failed") {
    return { user, result: { invitation: "failed", message: outcome.message } };
  }
  const { account } = outcome;
  const users = await ctx.repo.users.list();
  const owner = users.find((u) => u.authUserId === account.id && u.id !== user.id);
  if (owner) {
    return {
      user,
      result: {
        invitation: "failed",
        message: `Ce compte est déjà rattaché à l'utilisateur ${owner.name}.`,
      },
    };
  }
  const current = users.find((u) => u.id === user.id);
  if (!current) {
    return {
      user,
      result: { invitation: "failed", message: "Utilisateur supprimé pendant l'invitation." },
    };
  }
  const linked: UserRecord = {
    ...current,
    authUserId: account.id,
    activatedAt: account.email_confirmed_at
      ? (current.authUserId === account.id && current.activatedAt) || ctx.now.toISOString()
      : null,
  };
  await ctx.repo.users.update(linked);
  return { user: linked, result: { invitation: outcome.invitation } };
}

export const createUser: Handler = async (ctx) => {
  assertCan(ctx.user, "users.manage");
  const input = parse(schemas.createUser, ctx.body);
  const emailTaken = () =>
    conflict("email_taken", "Un utilisateur utilise déjà cette adresse e-mail.");
  return withUsersLock(ctx, async () => {
    if ((await ctx.repo.users.list()).some((u) => u.email.toLowerCase() === input.email)) {
      throw emailTaken();
    }
    const created: UserRecord = {
      id: userIdForEmail(input.email),
      name: input.name,
      email: input.email,
      team: input.team ?? "",
      roles: input.roles,
      avatarUrl: null,
      authUserId: null,
      activatedAt: null,
    };
    try {
      await ctx.repo.users.insert(created);
    } catch (error) {
      if (await ctx.repo.users.get(created.id)) throw emailTaken();
      throw error;
    }
    const { user, result } = await invite(ctx, created);
    await audit(
      ctx,
      "user.create",
      "user",
      user.id,
      `${user.name} (${user.email}) — ${rolesText(user.roles)} ; ${INVITATION_LABEL[result.invitation]}`,
    );
    return json({ user: toPublicUser(user), ...result } satisfies CreatedUser, { status: 201 });
  });
};

export const updateUser: Handler = async (ctx) => {
  assertCan(ctx.user, "users.manage");
  const input = parse(schemas.updateUser, ctx.body);
  return withUsersLock(ctx, async () => {
    const target = await getUserOr404(ctx);
    if (input.roles && target.roles.includes("admin") && !input.roles.includes("admin")) {
      await assertNotLastAdmin(
        ctx,
        target,
        "Impossible de retirer le rôle administrateur : c'est le dernier administrateur.",
      );
      if (target.id === ctx.user.id) {
        throw unprocessable(
          "self_demotion",
          "Vous ne pouvez pas retirer votre propre rôle administrateur : demandez-le à un autre administrateur.",
        );
      }
    }
    const updated: UserRecord = {
      ...target,
      ...defined({ name: input.name, team: input.team, roles: input.roles }),
    };
    const changes = [
      updated.name !== target.name ? `nom « ${target.name} » → « ${updated.name} »` : null,
      updated.team !== target.team ? `équipe « ${target.team} » → « ${updated.team} »` : null,
      rolesText(updated.roles) !== rolesText(target.roles)
        ? `rôles ${rolesText(target.roles)} → ${rolesText(updated.roles)}`
        : null,
    ].filter(Boolean);
    if (changes.length) {
      await ctx.repo.users.update(updated);
      await audit(
        ctx,
        "user.update",
        "user",
        updated.id,
        `${updated.name} : ${changes.join(" ; ")}`,
      );
    }
    return json(toPublicUser(updated));
  });
};

/** Révocation (au mieux) puis suppression de la connexion LinkedIn de l'utilisateur. */
async function removeLinkedInConnection(userId: string): Promise<void> {
  const { key } = await readConnectionKey(userId);
  if (key) {
    try {
      await disconnectAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey: key,
        connectorId: LINKEDIN_CONNECTOR_ID,
      });
    } catch (error) {
      console.error("[users] révocation LinkedIn impossible :", error);
    }
  }
  await deleteConnectionKeyForUser(userId, LINKEDIN_CONNECTOR_ID);
}

/** Le compte Supabase n'est pas supprimé : sans utilisateur KORA rattaché, il n'ouvre plus rien. */
export const deleteUser: Handler = async (ctx) => {
  assertCan(ctx.user, "users.manage");
  return withUsersLock(ctx, async () => {
    const target = await getUserOr404(ctx);
    if (target.roles.includes("admin")) {
      await assertNotLastAdmin(ctx, target, "Impossible de supprimer le dernier administrateur.");
    }
    if (target.id === ctx.user.id) {
      throw unprocessable("self_delete", "Vous ne pouvez pas supprimer votre propre compte.");
    }
    await removeLinkedInConnection(target.id);
    await discardPendingConnect(ctx.repo, target.id);
    await ctx.repo.users.remove(target.id);
    await audit(ctx, "user.delete", "user", target.id, `${target.name} (${target.email}) supprimé`);
    return noContent();
  });
};

export const resendInvitation: Handler = async (ctx) => {
  assertCan(ctx.user, "users.manage");
  return withUsersLock(ctx, async () => {
    const target = await getUserOr404(ctx);
    const { result } = await invite(ctx, target);
    if (result.invitation !== "not_applicable") {
      await audit(
        ctx,
        "user.invite",
        "user",
        target.id,
        `${target.name} (${target.email}) — ${INVITATION_LABEL[result.invitation]}`,
      );
    }
    return json(result satisfies InvitationResult);
  });
};
