import type { PublicationAttempt, WordPressRemoteStatus } from "@/lib/api/types";
import { adapters } from "../adapters";
import type {
  RemotePost,
  WordPressAccount,
  WordPressClient,
  WordPressDraftPayload,
} from "../adapters/channels";
import type { Ctx } from "../context";
import { checkPublishable, idempotencyKey } from "../domain/workflow";
import { conflict, HttpError, json, notFound } from "../http";
import { audit, notify } from "../services/journal";
import { toPublication } from "../services/view";
import type { ArticleRecord, PublicationRecord, WordPressLink } from "../store/records";
import { wordpressSettingsOf } from "../store/settings";
import { notConfigured, roleTooHigh, WordPressError } from "./errors";
import { articleMarker, articleToken, neutralizeShortcodes, toWordPressHtml } from "./html";
import { resolveTaxonomy, type Taxonomy } from "./taxonomy";

/** Doit couvrir l'envoi le plus lent : lectures, puis une écriture de 15 s au plus. */
const LOCK_TTL_MS = 120_000;
/** Passé ce délai sous verrou, aucune écriture ne commence : le verrou pourrait expirer pendant l'appel. */
const WRITE_DEADLINE_MS = 90_000;
/** Écart toléré entre l'horloge de KORA et celle du site pour retrouver un brouillon interrompu. */
const RECOVERY_MARGIN_MS = 2 * 60_000;
/**
 * Fin de la fenêtre de reprise après l'envoi interrompu : WordPress a pu finir l'écriture après
 * le délai du client. Un brouillon modifié plus tard (retouché depuis) n'est pas repris.
 */
const RECOVERY_WINDOW_MS = 10 * 60_000;
/** Droits du compte gardés en mémoire : un compte promu Éditeur est refusé 3 min après au plus. */
const ROLE_CACHE_MS = 3 * 60_000;
/** Code de la tentative posée juste avant l'écriture ; s'il subsiste, l'envoi a été interrompu. */
const CONFIRMATION_PENDING = "wordpress_confirmation_pending";

const NOT_PUBLISHED = "Aucune publication : la mise en ligne se fait dans WordPress.";

export const STATUS_TEXT: Record<WordPressRemoteStatus, string> = {
  aucun: "aucun",
  brouillon: "brouillon",
  en_attente: "en attente de relecture",
  programme: "programmé",
  publie: "publié",
  supprime: "supprimé",
};

export function remoteToLocal(post: RemotePost | null): WordPressRemoteStatus {
  switch (post?.status) {
    case "draft":
      return "brouillon";
    case "pending":
      return "en_attente";
    case "future":
      return "programme";
    case "publish":
    case "private":
      return "publie";
    default:
      return "supprime";
  }
}

/** Lien après une lecture : `settleArticle` conserve la date du dernier envoi de KORA. */
const linkTo = (client: WordPressClient, post: RemotePost, at: string): WordPressLink => ({
  remoteId: post.id,
  site: client.site,
  status: remoteToLocal(post),
  lastSyncAt: at,
});

/** Lien après une écriture de KORA (ou la reprise de sa création) : date de référence de W-03. */
const sentLink = (client: WordPressClient, post: RemotePost, at: string): WordPressLink => ({
  ...linkTo(client, post, at),
  sentModifiedGmt: post.modifiedGmt,
});

export interface PublishOptions {
  /** Remplacer les retouches faites dans WordPress depuis le dernier envoi (confirmé par l'utilisateur). */
  overwriteRemoteChanges: boolean;
}

const REMOTE_MODIFIED =
  "Le brouillon a été modifié dans WordPress depuis le dernier envoi de KORA. Reprenez ces retouches dans KORA, ou confirmez l'écrasement.";

/**
 * Identifiant produit par CE site (jamais un identifiant simulé ni celui d'un autre site,
 * préproduction comprise), même marqué supprimé : il est relu avant tout nouveau brouillon.
 */
export function ownedRemoteId(client: WordPressClient, link: WordPressLink): string | null {
  return link.remoteId && client.ownsRemote(link.remoteId, link.site) ? link.remoteId : null;
}

/** Brouillon courant (rejeu) : identifiant de ce site, non supprimé. */
export function currentDraftId(client: WordPressClient, link: WordPressLink): string | null {
  return link.status !== "supprime" ? ownedRemoteId(client, link) : null;
}

/** Succès rejouable : même clé, et son brouillon est toujours le brouillon courant de l'article. */
export function replayableSuccess(
  client: WordPressClient,
  attempts: PublicationAttempt[],
  key: string,
  rec: ArticleRecord,
): PublicationAttempt | undefined {
  const current = currentDraftId(client, rec.wordpress);
  if (!current) return undefined;
  return [...attempts]
    .reverse()
    .find((p) => p.idempotencyKey === key && p.status === "succes" && p.remoteId === current);
}

/**
 * Règlement : relit l'article et n'écrit que le lien WordPress, sans écraser les changements
 * concurrents (approbations, versions). Publié côté WordPress : l'article passe `publie`. Un
 * lien sans `sentModifiedGmt` (simple lecture) garde celui du même brouillon.
 */
export async function settleArticle(
  ctx: Ctx,
  articleId: string,
  link: WordPressLink,
  post: RemotePost | null,
): Promise<ArticleRecord | null> {
  const current = await ctx.repo.articles.get(articleId);
  if (!current) return null;
  const at = ctx.now.toISOString();
  const sent =
    current.wordpress.remoteId === link.remoteId ? current.wordpress.sentModifiedGmt : undefined;
  const next: ArticleRecord = {
    ...current,
    wordpress:
      link.sentModifiedGmt === undefined && sent !== undefined
        ? { ...link, sentModifiedGmt: sent }
        : link,
    updatedAt: at,
  };
  if (link.status === "publie") {
    next.status = "publie";
    next.publishedAt = post?.dateGmt ?? current.publishedAt ?? at;
  }
  await ctx.repo.articles.update(next);
  return next;
}

export async function settleSignal(ctx: Ctx, signalId: string | null, at: string): Promise<void> {
  if (!signalId) return;
  const signal = await ctx.repo.signals.get(signalId);
  if (signal && signal.status !== "traite" && signal.status !== "rejete") {
    await ctx.repo.signals.update({ ...signal, status: "traite", updatedAt: at });
  }
}

/**
 * Avant toute écriture : le compte ne doit pas pouvoir publier (avec un tel compte, un `draft`
 * envoyé sur un contenu publié entre-temps le dépublierait). Droits illisibles : envoi poursuivi.
 */
async function contributorAccount(client: WordPressClient): Promise<WordPressAccount> {
  const me = await client.whoAmI({ maxAgeMs: ROLE_CACHE_MS });
  if (me.canPublish === true) throw roleTooHigh();
  if (me.canPublish === null) {
    console.warn(
      "[wordpress] droits du compte KORA illisibles (capabilities absentes de /users/me) : rôle Contributeur non vérifié, envoi poursuivi.",
    );
  }
  return me;
}

/** Erreur du client non configuré (avec les variables manquantes). */
export async function configurationError(client: WordPressClient): Promise<WordPressError> {
  try {
    await client.whoAmI();
  } catch (e) {
    if (e instanceof WordPressError) return e;
    throw e;
  }
  return notConfigured(client.missing);
}

/**
 * Un seul envoi ou rafraîchissement à la fois par article (et non par version : la v1 et la v2
 * visent le même brouillon). Verrou détenu : 409 `publication_in_progress`.
 */
export async function withArticleLock<T>(
  ctx: Ctx,
  articleId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `wordpress-publish:${articleId}`;
  const lock = await ctx.repo.acquireLock(key, LOCK_TTL_MS);
  if (!lock) {
    throw conflict(
      "publication_in_progress",
      "Un envoi vers WordPress est déjà en cours pour cet article. Patientez quelques secondes puis actualisez.",
    );
  }
  try {
    return await fn();
  } finally {
    // Un échec de libération ne doit pas masquer le résultat : le verrou expirera seul.
    await ctx.repo.releaseLock(key, lock).catch((e: unknown) => {
      console.error(`[wordpress] verrou ${key} non libéré`, e);
    });
  }
}

type AttemptBase = Pick<
  PublicationAttempt,
  | "idempotencyKey"
  | "articleId"
  | "linkedinPostId"
  | "newsletterId"
  | "channel"
  | "version"
  | "mode"
  | "at"
  | "by"
  | "byUserId"
>;

function attemptBase(ctx: Ctx, rec: ArticleRecord, version: number): AttemptBase {
  return {
    idempotencyKey: idempotencyKey(rec.id, version, "wordpress"),
    articleId: rec.id,
    linkedinPostId: null,
    newsletterId: null,
    channel: "wordpress",
    version,
    mode: "brouillon_distant",
    at: ctx.now.toISOString(),
    by: ctx.user.name,
    byUserId: ctx.user.id,
  };
}

/**
 * Refus avant toute écriture (rien n'a été envoyé) : tentative `echec` avec le code, cumulée
 * avec la précédente si elle est identique et la plus récente.
 */
async function refuse(
  ctx: Ctx,
  rec: ArticleRecord,
  version: number,
  error: HttpError,
  attempts: PublicationAttempt[],
): Promise<HttpError> {
  const base = attemptBase(ctx, rec, version);
  const latest = [...attempts].reverse().find((p) => p.idempotencyKey === base.idempotencyKey);
  const repeat = latest?.status === "echec" && latest.code === error.code ? latest : null;
  const attempt: PublicationAttempt = repeat
    ? { ...repeat, ...base, id: repeat.id, attempts: repeat.attempts + 1, message: error.message }
    : {
        ...base,
        id: ctx.repo.nextId("pub"),
        status: "echec",
        code: error.code,
        message: error.message,
        attempts: 1,
        remoteId: null,
      };
  if (repeat) await ctx.repo.publications.update(attempt);
  else await ctx.repo.publications.insert(attempt);
  await audit(
    ctx,
    "publication.failed",
    "publication",
    attempt.id,
    `${rec.title} — ${error.message}`,
  );
  const details = typeof error.details === "object" && error.details ? error.details : {};
  return new HttpError(error.status, error.code, error.message, {
    ...details,
    attempt: toPublication(attempt),
  });
}

/**
 * Création restée « à vérifier » avec un identifiant (réponse 2xx inexploitable) : réglée dès
 * qu'une lecture du contenu aboutit. Statut connu = créé ; absent ou à la corbeille = échec.
 */
export async function settleUnconfirmedCreation(
  ctx: Ctx,
  rec: ArticleRecord,
  attempts: PublicationRecord[],
  remoteId: string,
  post: RemotePost | null,
): Promise<void> {
  const open = attempts.filter(
    (p) =>
      p.articleId === rec.id &&
      p.channel === "wordpress" &&
      p.status === "verification_requise" &&
      p.remoteId === remoteId &&
      p.code !== CONFIRMATION_PENDING,
  );
  for (const marker of open) {
    const next: PublicationRecord =
      post && post.status !== "trash"
        ? {
            ...marker,
            status: "succes",
            code: null,
            message: `Brouillon WordPress n° ${remoteId} confirmé : statut « ${STATUS_TEXT[remoteToLocal(post)]} » relu sur WordPress.`,
          }
        : {
            ...marker,
            status: "echec",
            code: "wordpress_absence_confirmed",
            message: `Le contenu n° ${remoteId}, enregistré malgré la réponse inattendue de WordPress, n'existe plus (supprimé ou à la corbeille).`,
          };
    await ctx.repo.publications.update(next);
    await audit(
      ctx,
      next.status === "succes" ? "publication.recovered" : "publication.absence_confirmed",
      "publication",
      next.id,
      `${rec.title} — ${next.message}`,
    );
  }
}

/**
 * Identifiants déjà attribués à un AUTRE article (lien ou tentative) sur ce site ; un identifiant
 * numérique sans site connu (antérieur à ce suivi) est écarté aussi, par prudence.
 */
async function takenRemoteIds(
  ctx: Ctx,
  client: WordPressClient,
  articleId: string,
  attempts: PublicationRecord[],
): Promise<Set<string>> {
  const here = (id: string, site: string | null | undefined) =>
    client.ownsRemote(id, site) || (!site && /^\d+$/.test(id));
  const taken = new Set<string>();
  for (const a of await ctx.repo.articles.list()) {
    const { remoteId, site } = a.wordpress;
    if (a.id !== articleId && remoteId && here(remoteId, site)) taken.add(remoteId);
  }
  for (const p of attempts) {
    if (p.articleId !== articleId && p.channel === "wordpress" && p.remoteId && here(p.remoteId, p.site)) {
      taken.add(p.remoteId);
    }
  }
  return taken;
}

/**
 * Envois interrompus (tentative restée `verification_requise`) : une mise à jour se renvoie
 * sans risque ; une création n'est recherchée que sur le site où elle a été envoyée, par le
 * jeton de l'article, dans la fenêtre qui suit l'envoi. N'est repris qu'un brouillon du compte
 * KORA dont le contenu brut porte le marqueur de CET article et qu'aucun autre article ne
 * détient : un seul = repris, aucun = absence confirmée, plusieurs = 409 avec la liste.
 */
async function recoverInterrupted(
  ctx: Ctx,
  client: WordPressClient,
  rec: ArticleRecord,
  attempts: PublicationRecord[],
  notes: string[],
): Promise<RemotePost | null> {
  const pending = attempts.filter(
    (p) =>
      p.articleId === rec.id && p.channel === "wordpress" && p.status === "verification_requise",
  );
  // Avec un autre code : création enregistrée mais inexploitable, réglée à la relecture du contenu.
  for (const update of pending.filter((p) => p.remoteId && p.code === CONFIRMATION_PENDING)) {
    await ctx.repo.publications.update({
      ...update,
      status: "echec",
      code: "wordpress_update_unconfirmed",
      message: `Mise à jour du brouillon WordPress n° ${update.remoteId} interrompue avant confirmation : elle est renvoyée (même brouillon, aucun doublon possible).`,
    });
  }
  const creations = pending.filter((p) => !p.remoteId);
  for (const marker of creations.filter((p) => p.site === undefined || p.site !== client.site)) {
    const next: PublicationRecord = {
      ...marker,
      status: "echec",
      code: "wordpress_recovery_skipped",
      message:
        marker.site === undefined
          ? "Création interrompue avant le suivi du site WordPress : elle n'est pas recherchée. Vérifiez dans WordPress qu'aucun doublon n'existe."
          : `Création interrompue sur un autre site WordPress (${marker.site ?? "démonstration"}) : elle n'est pas recherchée sur ce site.`,
    };
    await ctx.repo.publications.update(next);
    await audit(ctx, "publication.failed", "publication", next.id, `${rec.title} — ${next.message}`);
  }
  const here = creations.filter((p) => p.site !== undefined && p.site === client.site);
  if (!here.length) return null;

  const sent = here.map((p) => Date.parse(p.at));
  const since = new Date(Math.min(...sent) - RECOVERY_MARGIN_MS).toISOString();
  const until = new Date(Math.max(...sent) + RECOVERY_WINDOW_MS).toISOString();
  const proof = articleMarker(rec.id);
  const [found, taken] = await Promise.all([
    client.findOwnDrafts(articleToken(rec.id), since, until),
    takenRemoteIds(ctx, client, rec.id, attempts),
  ]);
  // Contenu brut illisible : rien n'est prouvé, rien n'est repris.
  const candidates = found.filter((p) => p.content?.includes(proof) && !taken.has(p.id));
  const unproven = found.length - candidates.length;
  if (candidates.length > 1) {
    throw conflict(
      "publication_verification_required",
      "Plusieurs brouillons de cet article existent sur WordPress après des envois interrompus : supprimez les doublons dans WordPress puis renvoyez.",
      {
        candidates: candidates.map((p) => ({
          id: p.id,
          title: p.title,
          date: p.dateGmt ?? p.modifiedGmt,
          editUrl: client.editUrl(p.id),
        })),
        attempt: toPublication(here.at(-1)!),
      },
    );
  }

  const [adopted] = candidates;
  for (const marker of here) {
    const next: PublicationRecord = adopted
      ? {
          ...marker,
          status: "succes",
          code: "wordpress_recovered",
          remoteId: adopted.id,
          message: `Brouillon WordPress n° ${adopted.id} retrouvé après une interruption : KORA le reprend.`,
        }
      : {
          ...marker,
          status: "echec",
          code: "wordpress_absence_confirmed",
          message: unproven
            ? "Aucun brouillon attribuable avec certitude à cet article sur WordPress après l'interruption (contenu illisible ou déjà lié à un autre article) : un nouveau brouillon est créé."
            : "Aucun brouillon retrouvé sur WordPress après l'interruption : un nouveau brouillon est créé.",
        };
    await ctx.repo.publications.update(next);
    await audit(
      ctx,
      adopted ? "publication.recovered" : "publication.absence_confirmed",
      "publication",
      next.id,
      `${rec.title} — ${next.message}`,
    );
  }
  if (!adopted) return null;
  await settleArticle(ctx, rec.id, sentLink(client, adopted, ctx.now.toISOString()), adopted);
  notes.push(`Brouillon retrouvé après une interruption (n° ${adopted.id}).`);
  return adopted;
}

/**
 * Brouillon déjà lié à l'article : mis à jour s'il est encore un brouillon du compte KORA ;
 * publié ou programmé = 409 (KORA n'y touche plus) ; sinon un nouveau brouillon est créé.
 */
async function existingDraft(
  ctx: Ctx,
  client: WordPressClient,
  me: WordPressAccount,
  rec: ArticleRecord,
  attempts: PublicationAttempt[],
  notes: string[],
  options: PublishOptions,
): Promise<RemotePost | null> {
  const link = rec.wordpress;
  const id = link.remoteId;
  if (!id) return null;
  if (!client.ownsRemote(id, link.site)) {
    notes.push(
      /^wp-\d+$/.test(id)
        ? `L'ancien brouillon ${id} était simulé (démonstration) : il n'est pas réutilisé.`
        : `Le brouillon n° ${id} provient d'un autre site WordPress${link.site ? ` (${link.site})` : ""} : il n'est pas réutilisé.`,
    );
    return null;
  }
  let post: RemotePost | null;
  try {
    post = await client.getPost(id);
  } catch (e) {
    if (!(e instanceof WordPressError) || e.code !== "wordpress_forbidden") throw e;
    notes.push(
      `Le brouillon n° ${id} n'est plus accessible au compte KORA : il n'est pas modifié, un nouveau brouillon est créé.`,
    );
    return null;
  }
  await settleUnconfirmedCreation(ctx, rec, attempts, id, post);
  if (!post || post.status === "trash") {
    notes.push(
      post
        ? `Le brouillon n° ${id} est dans la corbeille de WordPress : un nouveau brouillon est créé.`
        : `Le brouillon n° ${id} n'existe plus sur WordPress : un nouveau brouillon est créé.`,
    );
    return null;
  }
  if (post.status === "publish" || post.status === "future" || post.status === "private") {
    await settleArticle(ctx, rec.id, linkTo(client, post, ctx.now.toISOString()), post);
    throw await refuse(
      ctx,
      rec,
      rec.currentVersion,
      conflict(
        "wordpress_remote_published",
        "Ce contenu a déjà été publié ou programmé sur WordPress : KORA ne le modifie plus. Faites la mise à jour dans WordPress.",
      ),
      attempts,
    );
  }
  if (post.authorId !== me.id) {
    notes.push(
      `Le brouillon n° ${id} appartient à un autre compte WordPress : KORA n'y touche pas et crée un nouveau brouillon.`,
    );
    return null;
  }
  // Lien antérieur à ce suivi (aucune date mémorisée) : pas de comparaison possible, pas de blocage.
  const sent = Date.parse(link.sentModifiedGmt ?? "");
  const remote = Date.parse(post.modifiedGmt ?? "");
  if (!Number.isNaN(sent) && !Number.isNaN(remote) && remote !== sent) {
    if (!options.overwriteRemoteChanges) {
      throw await refuse(
        ctx,
        rec,
        rec.currentVersion,
        conflict("wordpress_remote_modified", REMOTE_MODIFIED, {
          editUrl: client.editUrl(id),
          remoteModifiedAt: post.modifiedGmt,
        }),
        attempts,
      );
    }
    notes.push(
      `Les retouches faites dans WordPress sur le brouillon n° ${id} ont été remplacées (écrasement confirmé).`,
    );
  }
  return post;
}

/**
 * Échec de l'écriture. Création au résultat incertain (délai, coupure, 5xx, réponse illisible) :
 * la tentative reste `verification_requise` et le prochain envoi recherche le brouillon. Une mise
 * à jour se renvoie sans risque : `echec`.
 */
async function failSend(
  ctx: Ctx,
  client: WordPressClient,
  rec: ArticleRecord,
  marker: PublicationRecord,
  update: boolean,
  error: unknown,
): Promise<unknown> {
  const known = error instanceof WordPressError ? error : null;
  const unknown = !update && (known?.verifyBeforeRetry ?? true);
  // Création enregistrée malgré une réponse inexploitable : liée, puis relue avant toute écriture.
  const created = !update ? (known?.remoteId ?? null) : null;
  const reason = known?.message ?? "Erreur interne pendant l'envoi à WordPress.";
  const message = created
    ? `${reason} Le brouillon n° ${created} est lié à l'article : KORA le relira avant tout nouvel envoi (aucun doublon).`
    : unknown
      ? `${reason} Le brouillon a peut-être été créé : au prochain envoi, KORA le recherchera sur WordPress avant d'en créer un autre.`
      : update
        ? `${reason} Mise à jour non confirmée : vous pouvez renvoyer sans risque de doublon.`
        : `${reason} Aucun brouillon n'a été créé.`;
  const attempt: PublicationRecord = {
    ...marker,
    status: unknown ? "verification_requise" : "echec",
    code: known?.code ?? "wordpress_internal_error",
    remoteId: created ?? marker.remoteId,
    message,
  };
  await ctx.repo.publications.update(attempt);
  if (created) {
    await settleArticle(
      ctx,
      rec.id,
      { remoteId: created, site: client.site, status: "brouillon", lastSyncAt: ctx.now.toISOString() },
      null,
    );
  }
  await audit(
    ctx,
    unknown ? "publication.unconfirmed" : "publication.failed",
    "publication",
    attempt.id,
    `${rec.title} — ${message}`,
  );
  if (!known) return error;
  return new HttpError(known.status, known.code, message, { attempt: toPublication(attempt) });
}

/** Sous verrou : relecture, reprise, préparation, écriture du brouillon et règlement. */
async function sendUnderLock(
  ctx: Ctx,
  client: WordPressClient,
  articleId: string,
  version: number,
  options: PublishOptions,
): Promise<Response> {
  const started = Date.now();
  const [rec, attempts, stored] = await Promise.all([
    ctx.repo.articles.get(articleId),
    ctx.repo.publications.list(),
    ctx.repo.getSettings(),
  ]);
  if (!rec) throw notFound("Article introuvable.");
  const key = idempotencyKey(rec.id, version, "wordpress");
  // Une demande concurrente a pu aboutir entre la première lecture et le verrou.
  const settled = replayableSuccess(client, attempts, key, rec);
  if (settled) return json(toPublication(settled));
  const approved =
    rec.currentVersion === version &&
    checkPublishable({
      approvals: rec.approvals,
      channel: "wordpress",
      version,
      factChecks: rec.factChecks,
    }).ok;
  if (!approved) {
    throw conflict(
      "article_changed",
      "L'article a été modifié pendant la préparation de l'envoi : actualisez la page puis renvoyez.",
    );
  }
  const content = rec.versions.find((v) => v.n === version)!;
  const at = ctx.now.toISOString();
  const notes: string[] = [];

  let target: RemotePost | null;
  let taxonomy: Taxonomy;
  try {
    const me = await contributorAccount(client);
    target =
      (await recoverInterrupted(ctx, client, rec, attempts, notes)) ??
      (await existingDraft(ctx, client, me, rec, attempts, notes, options));
    taxonomy = await resolveTaxonomy(client, content, wordpressSettingsOf(stored), target !== null);
    if (Date.now() - started > WRITE_DEADLINE_MS) {
      throw new WordPressError(
        "wordpress_unavailable",
        "WordPress a répondu trop lentement pendant la préparation : rien n'a été envoyé, réessayez dans quelques instants.",
      );
    }
  } catch (e) {
    if (e instanceof WordPressError) throw await refuse(ctx, rec, version, e, attempts);
    throw e;
  }
  notes.push(...taxonomy.notes);

  const payload: WordPressDraftPayload = {
    // Titre laissé intact : WordPress n'y exécute pas les shortcodes et l'éditeur afficherait l'entité.
    title: content.title,
    // Marqueur renvoyé à chaque écriture : il prouve l'appartenance du brouillon lors d'une reprise.
    content: [toWordPressHtml(content.chapo, content.body), articleMarker(rec.id)]
      .filter(Boolean)
      .join("\n"),
    excerpt: neutralizeShortcodes(content.excerpt),
    categories: taxonomy.categories,
    tags: taxonomy.tags,
  };
  // Enregistrée AVANT l'écriture : si le Worker meurt ensuite, le prochain envoi vérifie d'abord.
  const marker: PublicationRecord = {
    ...attemptBase(ctx, rec, version),
    site: client.site,
    id: ctx.repo.nextId("pub"),
    status: "verification_requise",
    code: CONFIRMATION_PENDING,
    message: target
      ? `Mise à jour du brouillon WordPress n° ${target.id} envoyée, confirmation en attente.`
      : "Création du brouillon WordPress envoyée, confirmation en attente.",
    attempts: 1,
    remoteId: target?.id ?? null,
  };
  await ctx.repo.publications.insert(marker);

  let post: RemotePost;
  try {
    post = target
      ? await client.updateDraft(target.id, payload, target.status === "pending" ? "pending" : "draft")
      : await client.createDraft(payload);
  } catch (e) {
    throw await failSend(ctx, client, rec, marker, target !== null, e);
  }

  const message = [
    `Brouillon WordPress n° ${post.id} ${target ? "mis à jour" : "créé"} (version ${version}). ${NOT_PUBLISHED}`,
    ...notes,
    ...(client.mode === "simule"
      ? ["Mode démonstration : brouillon simulé, aucun site contacté."]
      : []),
  ].join(" ");
  const attempt: PublicationRecord = {
    ...marker,
    status: "succes",
    code: null,
    remoteId: post.id,
    message,
  };
  await ctx.repo.publications.update(attempt);
  await settleArticle(ctx, rec.id, sentLink(client, post, at), post);
  await settleSignal(ctx, rec.signalId, at);
  await audit(ctx, "publication.success", "publication", attempt.id, `${rec.title} — ${message}`);
  await notify(ctx.repo, ctx.now, {
    kind: "publication",
    title: "Brouillon WordPress prêt",
    body: `${rec.title} (version ${version})`,
    link: `/articles?id=${rec.id}`,
  });
  return json(toPublication(attempt), { status: 201 });
}

/**
 * Envoi d'un brouillon WordPress pour la version courante (approbation déjà contrôlée par
 * l'appelant). Statut toujours `draft` (ou `pending` conservé) : la mise en ligne reste humaine,
 * dans WordPress.
 */
export async function publishWordPress(
  ctx: Ctx,
  rec: ArticleRecord,
  options: PublishOptions = { overwriteRemoteChanges: false },
): Promise<Response> {
  const client = adapters().wordpress;
  const version = rec.currentVersion;
  if (client.mode === "non_configure") {
    const attempts = await ctx.repo.publications.list();
    throw await refuse(ctx, rec, version, await configurationError(client), attempts);
  }
  return withArticleLock(ctx, rec.id, () =>
    sendUnderLock(ctx, client, rec.id, version, options),
  );
}
