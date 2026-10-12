import type { CreatedUser, InvitationResult, InvitationStatus, Role } from "@/lib/api/types";
import { disconnectAppUser } from "@/integrations/lovable/appUserConnector";
import { deleteConnectionKeyForUser, getConnectionKeyForUser } from "../appUserConnections.server";
import { inviteAccount } from "../auth/admin";
import { authMode } from "../auth/mode";
import { toPublicUser, userIdForEmail } from "../auth/users";
import type { Ctx, Handler } from "../context";
import { assertCan, roleLabel } from "../domain/permissions";
import { conflict, json, noContent, notFound, unprocessable } from "../http";
import { audit } from "../services/journal";
import type { UserRecord } from "../store/records";
import { defined, parse, schemas } from "../validation";
import { GATEWAY_BASE_URL, LINKEDIN_CONNECTOR_ID } from "./connectors";

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

/** Origine publique de l'app (x-forwarded-host derrière le proxy local). */
function publicOrigin(ctx: Ctx): string {
  const forwarded = ctx.request.headers.get("x-forwarded-host");
  if (ctx.url.hostname === "localhost" && forwarded) return `https://${forwarded}`;
  return ctx.url.origin;
}

async function getUserOr404(ctx: Ctx): Promise<UserRecord> {
  const user = await ctx.repo.users.get(ctx.params["id"]!);
  if (!user) throw notFound("Utilisateur introuvable.");
  return user;
}

async function assertNotLastAdmin(ctx: Ctx, message: string): Promise<void> {
  const admins = (await ctx.repo.users.list()).filter((u) => u.roles.includes("admin"));
  if (admins.length <= 1) throw unprocessable("last_admin", message);
}

/** Invite l'adresse (mode supabase) et rattache le compte Supabase renvoyé à l'utilisateur. */
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
  const owner = (await ctx.repo.users.list()).find(
    (u) => u.authUserId === account.id && u.id !== user.id,
  );
  if (owner) {
    return {
      user,
      result: {
        invitation: "failed",
        message: `Ce compte est déjà rattaché à l'utilisateur ${owner.name}.`,
      },
    };
  }
  const linked: UserRecord = {
    ...user,
    authUserId: account.id,
    activatedAt: account.email_confirmed_at
      ? (user.authUserId === account.id && user.activatedAt) || ctx.now.toISOString()
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
};

export const updateUser: Handler = async (ctx) => {
  assertCan(ctx.user, "users.manage");
  const input = parse(schemas.updateUser, ctx.body);
  const target = await getUserOr404(ctx);
  if (input.roles && target.roles.includes("admin") && !input.roles.includes("admin")) {
    await assertNotLastAdmin(
      ctx,
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
    await audit(ctx, "user.update", "user", updated.id, `${updated.name} : ${changes.join(" ; ")}`);
  }
  return json(toPublicUser(updated));
};

/** Révocation (au mieux) puis suppression de la connexion LinkedIn de l'utilisateur. */
async function removeLinkedInConnection(userId: string): Promise<void> {
  const key = await getConnectionKeyForUser(userId, LINKEDIN_CONNECTOR_ID);
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
  const target = await getUserOr404(ctx);
  if (target.roles.includes("admin")) {
    await assertNotLastAdmin(ctx, "Impossible de supprimer le dernier administrateur.");
  }
  if (target.id === ctx.user.id) {
    throw unprocessable("self_delete", "Vous ne pouvez pas supprimer votre propre compte.");
  }
  await removeLinkedInConnection(target.id);
  await ctx.repo.users.remove(target.id);
  await audit(ctx, "user.delete", "user", target.id, `${target.name} (${target.email}) supprimé`);
  return noContent();
};

export const resendInvitation: Handler = async (ctx) => {
  assertCan(ctx.user, "users.manage");
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
};
