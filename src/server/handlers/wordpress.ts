import type { WordPressCheck, WordPressStatus } from "@/lib/api/types";
import { adapters } from "../adapters";
import type { Ctx, Handler } from "../context";
import { assertCan } from "../domain/permissions";
import { truncate } from "../domain/text";
import { conflict, json, notFound } from "../http";
import { audit } from "../services/journal";
import { articleDetail } from "../services/view";
import { parse, schemas } from "../validation";
import { WordPressError } from "../wordpress/errors";
import {
  configurationError,
  effectiveLink,
  ownedRemoteId,
  remoteToLocal,
  settleArticle,
  settleUnconfirmedCreation,
  STATUS_TEXT,
  withArticleLock,
} from "../wordpress/publish";
import { KORA_CATEGORIES } from "../wordpress/taxonomy";

/** Aucun appel au site : mode, site, variables manquantes (noms seulement) et correspondance. */
async function wordpressStatus(ctx: Ctx): Promise<WordPressStatus> {
  const client = adapters().wordpress;
  return {
    mode: client.mode,
    site: client.mode === "reel" ? client.site : null,
    missing: client.mode === "non_configure" ? [...client.missing] : [],
    settings: await ctx.repo.getWordPressSettings(),
    koraCategories: [...KORA_CATEGORIES],
  };
}

export const getWordPressStatus: Handler = async (ctx) => json(await wordpressStatus(ctx));

/** Test de connexion (compte, rôles, droit de publier) ; toujours 200, l'échec est dans `error`. */
export const checkWordPress: Handler = async (ctx) => {
  assertCan(ctx.user, "wordpress.manage");
  let result: WordPressCheck;
  try {
    const account = await adapters().wordpress.whoAmI();
    result = {
      ok: true,
      account: { id: account.id, name: account.name, roles: account.roles },
      canPublish: account.canPublish,
      error: null,
    };
  } catch (e) {
    if (!(e instanceof WordPressError)) throw e;
    result = {
      ok: false,
      account: null,
      canPublish: null,
      error: { code: e.code, message: e.message },
    };
  }
  return json(result);
};

export const listWordPressCategories: Handler = async (ctx) => {
  assertCan(ctx.user, "wordpress.manage");
  return json(await adapters().wordpress.listCategories());
};

const SETTINGS_LOCK = "wordpress-settings";
/** Couvre l'écriture de la correspondance et son entrée de journal. */
const SETTINGS_LOCK_MS = 30_000;

export const saveWordPressSettings: Handler = async (ctx) => {
  assertCan(ctx.user, "wordpress.manage");
  const input = parse(schemas.wordpressSettings, ctx.body);
  const token = await ctx.repo.acquireLock(SETTINGS_LOCK, SETTINGS_LOCK_MS);
  if (!token) {
    throw conflict(
      "wordpress_settings_in_progress",
      "Un autre enregistrement de la correspondance des catégories WordPress est en cours : rechargez la page, vérifiez la correspondance puis réessayez.",
    );
  }
  try {
    await ctx.repo.saveWordPressSettings(input);
    const pairs = Object.entries(input.categoryMap).map(([label, slug]) => `${label} → ${slug}`);
    await audit(
      ctx,
      "wordpress.settings",
      "publication",
      "wordpress",
      truncate(
        `Correspondance des catégories WordPress : ${pairs.length ? pairs.join(", ") : "aucune"} ; catégorie par défaut : ${input.defaultCategory ?? "aucune"}`,
        1000,
      ),
    );
  } finally {
    await ctx.repo.releaseLock(SETTINGS_LOCK, token);
  }
  return json(await wordpressStatus(ctx));
};

/** Relit l'état du brouillon sur WordPress et le règle localement (article `publie` si publié). */
export const refreshArticleWordPress: Handler = async (ctx) => {
  assertCan(ctx.user, "publish");
  const id = ctx.params["id"]!;
  if (!(await ctx.repo.articles.get(id))) throw notFound("Article introuvable.");
  const client = adapters().wordpress;
  if (client.mode === "non_configure") throw await configurationError(client);
  const noDraft = () =>
    conflict(
      "wordpress_no_draft",
      "Cet article n'a pas de brouillon sur le site WordPress configuré : envoyez-le d'abord vers WordPress.",
    );
  return withArticleLock(ctx, id, async () => {
    const rec = await ctx.repo.articles.get(id);
    if (!rec) throw notFound("Article introuvable.");
    const attempts = await ctx.repo.publications.list();
    // Un lien « supprimé » se relit aussi : le contenu a pu être restauré depuis la corbeille.
    const remoteId = ownedRemoteId(client, effectiveLink(client, rec, attempts));
    if (!remoteId) throw noDraft();
    const post = await client.getPost(remoteId);
    await settleUnconfirmedCreation(ctx, rec, attempts, remoteId, post);
    const status = remoteToLocal(post);
    const before = rec.wordpress.status;
    const next = await settleArticle(
      ctx,
      rec.id,
      { remoteId, site: client.site, status, lastSyncAt: ctx.now.toISOString() },
      post,
    );
    if (!next) throw notFound("Article introuvable.");
    await audit(
      ctx,
      "wordpress.sync",
      "article",
      rec.id,
      `Brouillon WordPress n° ${remoteId} : ${STATUS_TEXT[before]} → ${STATUS_TEXT[status]}${status === "publie" ? " (article publié)" : ""}`,
    );
    return json(await articleDetail(ctx.repo, next, ctx.now));
  });
};
