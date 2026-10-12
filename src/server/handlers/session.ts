import type { Handler } from "../context";
import { json, noContent, notFound, sessionCookie } from "../http";
import { audit } from "../services/journal";
import { parse, schemas } from "../validation";

export const getMe: Handler = async (ctx) => json(ctx.user);

/** Démo : change l'utilisateur courant (cookie de session httpOnly). */
export const switchUser: Handler = async (ctx) => {
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
  return json(user, { headers: { "set-cookie": sessionCookie(user.id) } });
};

export const listUsers: Handler = async (ctx) => json(await ctx.repo.users.list());

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
