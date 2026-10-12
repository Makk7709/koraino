import type { AuthConfig } from "@/lib/api/types";
import { authMode } from "../auth/mode";
import {
  authenticate,
  authSessionCookie,
  clearAuthSessionCookie,
  MAX_SESSION_SECONDS,
} from "../auth/session";
import { toPublicUser } from "../auth/users";
import type { Handler, PublicHandler } from "../context";
import { forbidden, json, noContent, notFound, sessionCookie } from "../http";
import { audit } from "../services/journal";
import { parse, schemas } from "../validation";

export const getMe: Handler = async (ctx) => json(toPublicUser(ctx.user));

/** Démo : change l'utilisateur courant (cookie de session httpOnly). */
export const switchUser: Handler = async (ctx) => {
  if (authMode() !== "demo") {
    throw forbidden(
      "Le changement de profil n'existe qu'en démonstration : connectez-vous avec votre propre compte.",
      "demo_only",
    );
  }
  const { userId } = parse(schemas.switchUser, ctx.body);
  const user = await ctx.repo.users.get(userId);
  if (!user) throw notFound("Utilisateur inconnu.");
  if (user.id !== ctx.user.id) {
    await audit(
      { ...ctx, user },
      "user.switch",
      "user",
      user.id,
      `Session de démonstration : ${ctx.user.name} → ${user.name}`,
    );
  }
  return json(toPublicUser(user), { headers: { "set-cookie": sessionCookie(user.id) } });
};

export const listUsers: Handler = async (ctx) =>
  json((await ctx.repo.users.list()).map(toPublicUser));

export const listNotifications: Handler = async (ctx) => {
  const list = await ctx.repo.notifications.list();
  return json(list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50));
};

export const markNotificationsRead: Handler = async (ctx) => {
  for (const n of await ctx.repo.notifications.list()) {
    if (!n.read) await ctx.repo.notifications.update({ ...n, read: true });
  }
  return noContent();
};

/* ------------------------------------------------------------------ */
/* Authentification (routes publiques)                                 */
/* ------------------------------------------------------------------ */

export const getAuthConfig: PublicHandler = async () =>
  json({ mode: authMode() } satisfies AuthConfig);

/**
 * Ouvre la session serveur : vérifie le jeton Bearer, résout l'utilisateur et pose le cookie
 * `kora_session` pour la durée restante du jeton. En démonstration, renvoie l'utilisateur courant.
 */
export const openSession: PublicHandler = async (ctx) => {
  const { user, token, claims } = await authenticate(ctx.request, ctx.repo, ctx.now);
  if (!token || !claims) return json(toPublicUser(user));
  const remaining =
    claims.exp === null ? MAX_SESSION_SECONDS : claims.exp - Math.floor(ctx.now.getTime() / 1000);
  const maxAge = Math.min(MAX_SESSION_SECONDS, remaining);
  return json(toPublicUser(user), {
    headers: { "set-cookie": authSessionCookie(token, maxAge) },
  });
};

export const closeSession: PublicHandler = async () =>
  noContent({ "set-cookie": clearAuthSessionCookie() });
