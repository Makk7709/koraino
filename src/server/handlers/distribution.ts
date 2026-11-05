import { expectNewsletter, revisionOf } from "../store/newsletter-mutations";
import { z } from "zod";
import type { Approval, LinkedInStatus, PublicationAttempt } from "@/lib/api/types";
import { publishWithConnectionKey, type LinkedInPostOutcome } from "../linkedin/publish";
import { adapters } from "../adapters";
import {
  ConnectionKeyUnavailableError,
  getConnectionKeyForUser,
} from "../appUserConnections.server";
import { LINKEDIN_CONNECTOR_ID } from "./connectors";
import type { Ctx, Handler } from "../context";
import { COSTS } from "../domain/budget";
import { estimatedTextAiCost } from "../services/ai-estimate";
import { renderNewsletterHtml, renderNewsletterText } from "../domain/newsletter";
import { assertCan } from "../domain/permissions";
import { isoDay } from "../domain/dates";
import { truncate } from "../domain/text";
import {
  checkPublishable,
  idempotencyKey,
  invalidateApproval,
  MODIFIED_AFTER_APPROVAL,
} from "../domain/workflow";
import {
  badRequest,
  conflict,
  fileResponse,
  forbidden,
  HttpError,
  json,
  notFound,
  unprocessable,
} from "../http";
import type {
  ArticleRecord,
  LinkedInPostRecord,
  NewsletterRecord,
  SignalRecord,
} from "../store/records";
import { audit, notify } from "../services/journal";
import { GENERATION_LOCK_TTL_MS, WRITE_LOCK_TTL_MS, withLock } from "../services/locks";
import {
  addItem,
  createEdition,
  commitEdition,
  removeItems,
  renumber,
  touchEdition,
} from "../services/newsletters";
import { assertQuota, paidCall } from "../services/usage";
import { toLinkedIn, toNewsletter, toPublication } from "../services/view";
import { parse, schemas } from "../validation";

function newApproval(ctx: Ctx, channel: Approval["channel"], version: number): Approval {
  return {
    id: ctx.repo.nextId("apv"),
    version,
    channel,
    approvedBy: ctx.user.name,
    approvedAt: ctx.now.toISOString(),
    scheduledAt: null,
    valid: true,
    invalidatedAt: null,
    invalidatedReason: null,
  };
}

/* ------------------------------------------------------------------ */
/* LinkedIn (WF4) — export uniquement au pilote                        */
/* ------------------------------------------------------------------ */

async function getPostOr404(ctx: Ctx): Promise<LinkedInPostRecord> {
  const p = await ctx.repo.linkedin.get(ctx.params["id"]!);
  if (!p) throw notFound("Post LinkedIn introuvable.");
  return p;
}

export const listLinkedIn: Handler = async (ctx) => {
  const list = await ctx.repo.linkedin.list();
  return json(
    list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(toLinkedIn),
  );
};

export const createLinkedIn: Handler = async (ctx) => {
  assertCan(ctx.user, "linkedin.write");
  const input = parse(schemas.createLinkedIn, ctx.body);
  const article = input.articleId ? await ctx.repo.articles.get(input.articleId) : undefined;
  if (input.articleId && !article) throw notFound("Article introuvable.");
  const signalId = input.signalId ?? article?.signalId ?? null;
  const signal = signalId ? await ctx.repo.signals.get(signalId) : undefined;
  if (input.signalId && !signal) throw notFound("Signal introuvable.");
  return withLock(
    ctx.repo,
    `linkedin-create:${article ? article.id : signal!.id}`,
    {
      ttlMs: GENERATION_LOCK_TTL_MS,
      busy: () =>
        conflict(
          "generation_in_progress",
          "Un post LinkedIn est déjà en cours de génération pour ce contenu : patientez quelques secondes.",
        ),
    },
    () => generateLinkedIn(ctx, article, signal),
  );
};

async function generateLinkedIn(
  ctx: Ctx,
  article: ArticleRecord | undefined,
  signal: SignalRecord | undefined,
): Promise<Response> {
  const existing = (await ctx.repo.linkedin.list()).find(
    (p) =>
      p.status !== "exporte" &&
      p.status !== "publie" &&
      (article ? p.articleId === article.id : !!signal && p.signalId === signal.id && !p.articleId),
  );
  if (existing) {
    throw conflict("post_exists", "Un post LinkedIn est déjà en préparation pour ce contenu.", {
      postId: existing.id,
    });
  }
  await assertQuota(ctx.repo, ctx.now, "linkedin_posts");
  const companyId = article?.companyId ?? signal?.companyId ?? null;
  const company = companyId ? await ctx.repo.companies.get(companyId) : undefined;
  const version = article?.versions.find((v) => v.n === article.currentVersion);
  const title = article?.title ?? signal?.title ?? "";
  const variants = await paidCall(
    ctx,
    {
      kind: "generation_linkedin",
      estimate: estimatedTextAiCost(COSTS.linkedin),
      units: 1,
      label: `Post LinkedIn : ${title}`,
    },
    async () => {
      const input = {
        title,
        lead: version?.chapo || article?.excerpt || signal?.summary || title,
        companyName: company?.name ?? null,
        themes: signal?.themes ?? company?.themes ?? [],
        tags: signal?.tags ?? version?.tags ?? [],
      };
      const base = adapters().textModel.linkedinVariants(input);
      return (await adapters().ai?.enhanceLinkedInVariants(input, base)) ?? base;
    },
  );
  const id = ctx.repo.nextId("li");
  const at = ctx.now.toISOString();
  const rec: LinkedInPostRecord = {
    id,
    articleId: article?.id ?? null,
    signalId: signal?.id ?? null,
    companyId,
    title,
    variants: variants.map((v, i) => ({ ...v, id: `${id}_v${i + 1}` })),
    selectedVariantId: `${id}_v1`,
    version: 1,
    status: "brouillon",
    approval: null,
    createdAt: at,
    updatedAt: at,
    createdBy: ctx.user.name,
  };
  await ctx.repo.linkedin.insert(rec);
  await audit(
    ctx,
    "linkedin.create",
    "linkedin",
    id,
    `${variants.length} variante(s) générée(s) — ${title}`,
  );
  return json(toLinkedIn(rec), { status: 201 });
}

export const updateLinkedIn: Handler = async (ctx) => {
  assertCan(ctx.user, "linkedin.write");
  const rec = await getPostOr404(ctx);
  const input = parse(schemas.updateLinkedIn, ctx.body);
  if (rec.status === "publie") throw conflict("invalid_state", "Ce post a déjà été publié.");
  const variants = input.variants ?? rec.variants;
  const selected =
    input.selectedVariantId ??
    (variants.some((v) => v.id === rec.selectedVariantId)
      ? rec.selectedVariantId
      : variants[0]!.id);
  if (!variants.some((v) => v.id === selected)) {
    throw unprocessable("variant_not_found", "La variante sélectionnée n'existe pas.");
  }
  if (new Set(variants.map((v) => v.id)).size !== variants.length) {
    throw unprocessable("duplicate_variant", "Chaque variante doit avoir un identifiant unique.");
  }
  const changed =
    selected !== rec.selectedVariantId || JSON.stringify(variants) !== JSON.stringify(rec.variants);
  if (!changed) return json(toLinkedIn(rec));
  const at = ctx.now.toISOString();
  const status: LinkedInStatus =
    rec.status === "approuve" || rec.status === "exporte" ? "a_valider" : rec.status;
  const next: LinkedInPostRecord = {
    ...rec,
    variants,
    selectedVariantId: selected,
    version: rec.version + 1,
    approval: invalidateApproval(rec.approval, at, MODIFIED_AFTER_APPROVAL),
    status,
    updatedAt: at,
  };
  await ctx.repo.linkedin.update(next);
  await audit(
    ctx,
    "linkedin.update",
    "linkedin",
    rec.id,
    `Version ${next.version}${rec.approval?.valid ? ` — approbation invalidée : ${MODIFIED_AFTER_APPROVAL.toLowerCase()}` : ""}`,
  );
  return json(toLinkedIn(next));
};

export const submitLinkedIn: Handler = async (ctx) => {
  assertCan(ctx.user, "linkedin.write");
  const rec = await getPostOr404(ctx);
  if (rec.status === "a_valider") return json(toLinkedIn(rec));
  if (rec.status !== "brouillon")
    throw conflict("invalid_state", "Seul un brouillon peut être soumis à validation.");
  const next: LinkedInPostRecord = {
    ...rec,
    status: "a_valider",
    updatedAt: ctx.now.toISOString(),
  };
  await ctx.repo.linkedin.update(next);
  await audit(
    ctx,
    "linkedin.submit",
    "linkedin",
    rec.id,
    `Version ${rec.version} soumise à validation`,
  );
  await notify(ctx.repo, ctx.now, {
    kind: "approbation",
    title: "Post LinkedIn à valider",
    body: rec.title,
    link: `/linkedin?id=${rec.id}`,
  });
  return json(toLinkedIn(next));
};

export const approveLinkedIn: Handler = async (ctx) => {
  assertCan(ctx.user, "linkedin.decide");
  const rec = await getPostOr404(ctx);
  const { version } = parse(schemas.versionOnly, ctx.body);
  if (version !== rec.version) {
    throw conflict(
      "version_mismatch",
      `Vous avez relu la version ${version}, la version courante est la ${rec.version}.`,
      {
        currentVersion: rec.version,
      },
    );
  }
  if (rec.status !== "a_valider" && rec.status !== "approuve") {
    throw conflict("invalid_state", "Ce post doit être soumis à validation avant approbation.");
  }
  const next: LinkedInPostRecord = {
    ...rec,
    approval: newApproval(ctx, "linkedin", version),
    status: "approuve",
    updatedAt: ctx.now.toISOString(),
  };
  await ctx.repo.linkedin.update(next);
  await audit(
    ctx,
    "linkedin.approve",
    "linkedin",
    rec.id,
    `Version ${version} approuvée pour LinkedIn`,
  );
  return json(toLinkedIn(next));
};

/**
 * `reconnect_required` / `api_error` / `published` (avec `url` publique quand l'identifiant
 * est une URN de post, `verifyBeforeRetry` quand le post existe peut-être déjà) : voir
 * `src/server/linkedin/publish.ts`.
 */
export type LinkedInPublishResult = { kind: "not_connected" } | LinkedInPostOutcome;

/**
 * Publie un post via le compte LinkedIn relié de l'utilisateur (connecteur
 * App User). Renvoie `not_connected` quand aucune clé n'est stockée — l'appelant
 * retombe alors sur l'export manuel historique.
 */
export async function publishViaUserAccount(
  userId: string,
  commentary: string,
): Promise<LinkedInPublishResult> {
  const key = await getConnectionKeyForUser(userId, LINKEDIN_CONNECTOR_ID);
  if (!key) return { kind: "not_connected" };
  return publishWithConnectionKey(key, commentary);
}

/** Doit couvrir l'appel LinkedIn le plus lent : au-delà, une autre requête pourrait republier. */
const PUBLISH_LOCK_TTL_MS = 120_000;

let userPublisher = publishViaUserAccount;

/** Remplace la publication via le compte relié (tests) ; `null` rétablit l'appel réel. */
export function setLinkedInUserPublisherForTests(fn: typeof publishViaUserAccount | null): void {
  userPublisher = fn ?? publishViaUserAccount;
}

/** Corps optionnel : verdict humain sur une publication restée sans confirmation. */
const publishLinkedInBody = z.object({
  resolution: z.enum(["published", "not_published"]).optional(),
});

/**
 * Code de la tentative enregistrée juste avant l'appel LinkedIn. S'il subsiste, la
 * publication est soit encore en vol (verrou détenu), soit interrompue au résultat inconnu.
 */
const CONFIRMATION_PENDING = "linkedin_confirmation_pending";

const findUnconfirmed = (attempts: PublicationAttempt[], key: string) =>
  attempts.find((p) => p.idempotencyKey === key && p.status === "verification_requise");

/** Un export ne clôt pas la version : elle reste publiable depuis un compte relié ensuite. */
const findSuccess = (
  attempts: PublicationAttempt[],
  key: string,
  mode: PublicationAttempt["mode"],
) => attempts.find((p) => p.idempotencyKey === key && p.status === "succes" && p.mode === mode);

const verificationRequired = (pending: PublicationAttempt) =>
  conflict(
    "publication_verification_required",
    "Une publication précédente n'a pas pu être confirmée. Vérifiez sur LinkedIn si le post a bien été publié, puis indiquez-le à KORA.",
    { attempt: toPublication(pending) },
  );

const nothingToResolve = () =>
  conflict(
    "verification_not_pending",
    "Aucune publication de cette version n'attend de vérification : actualisez la page.",
  );

/**
 * « Non publié » republie depuis le compte relié de la personne qui répond : seul l'auteur de la
 * tentative (ou un admin) tranche. Sans auteur connu (tentative ancienne), admin uniquement.
 */
function assertMayResolve(ctx: Ctx, pending: PublicationAttempt): void {
  if (ctx.user.roles.includes("admin")) return;
  if (pending.byUserId && pending.byUserId === ctx.user.id) return;
  throw forbidden(
    pending.byUserId
      ? `Seul ${pending.by}, qui a lancé cette publication, ou un administrateur peut indiquer si elle figure sur LinkedIn.`
      : "L'auteur de cette publication n'est pas connu : seul un administrateur peut indiquer si elle figure sur LinkedIn.",
    "resolution_forbidden",
  );
}

/**
 * Statut final écrit sur la version relue sous verrou : un changement concurrent (approbation,
 * rattachement) est conservé. Si une nouvelle version a été enregistrée pendant l'appel, le
 * post n'est pas touché : c'est la version publiée qui porte le résultat, la suivante reste à valider.
 */
async function settlePost(
  ctx: Ctx,
  published: LinkedInPostRecord,
  status: LinkedInStatus,
  at: string,
): Promise<void> {
  const current = await ctx.repo.linkedin.get(published.id);
  if (!current || current.version !== published.version) return;
  await ctx.repo.linkedin.update({ ...current, status, updatedAt: at });
}

/**
 * Diffusion LinkedIn : publication réelle via le compte relié, sinon export (idempotent ; une
 * version exportée reste publiable une fois le compte relié).
 * Un verrou par post et version sérialise les demandes simultanées (double clic, onglets) ;
 * une tentative `verification_requise` posée avant l'appel bloque toute republication tant
 * qu'un humain n'a pas indiqué si le post est bien sur LinkedIn (`resolution`).
 */
export const publishLinkedIn: Handler = async (ctx) => {
  assertCan(ctx.user, "publish");
  const rec = await getPostOr404(ctx);
  const { resolution } = parse(publishLinkedInBody, ctx.body);
  const key = idempotencyKey(rec.id, rec.version, "linkedin");
  const at = ctx.now.toISOString();
  const attempts = await ctx.repo.publications.list();
  const done = findSuccess(attempts, key, "publication");
  if (done) return json(toPublication(done));
  const unconfirmed = findUnconfirmed(attempts, key);
  // Un marqueur sans résultat peut appartenir à une publication en vol : le verrou tranche.
  if (unconfirmed && !resolution && unconfirmed.code !== CONFIRMATION_PENDING) {
    throw verificationRequired(unconfirmed);
  }
  if (!unconfirmed && resolution) throw nothingToResolve();

  const check = checkPublishable({
    approvals: rec.approval ? [rec.approval] : [],
    channel: "linkedin",
    version: rec.version,
  });
  const base = {
    idempotencyKey: key,
    articleId: rec.articleId,
    linkedinPostId: rec.id,
    newsletterId: null,
    channel: "linkedin" as const,
    version: rec.version,
    remoteId: null,
    mode: "export" as const,
    at,
    by: ctx.user.name,
    byUserId: ctx.user.id,
  };
  if (!check.ok) {
    const previous = attempts.find(
      (p) => p.idempotencyKey === key && p.status === "bloque" && p.code === check.code,
    );
    const attempt: PublicationAttempt = previous
      ? {
          ...previous,
          attempts: previous.attempts + 1,
          at,
          by: ctx.user.name,
          byUserId: ctx.user.id,
        }
      : {
          ...base,
          id: ctx.repo.nextId("pub"),
          status: "bloque",
          code: check.code,
          message: check.message,
          attempts: 1,
        };
    if (previous) await ctx.repo.publications.update(attempt);
    else await ctx.repo.publications.insert(attempt);
    await audit(
      ctx,
      "publication.blocked",
      "publication",
      attempt.id,
      `LinkedIn « ${rec.title} » — ${check.message}`,
    );
    throw unprocessable(check.code, check.message, { attempt: toPublication(attempt) });
  }

  const lockKey = `linkedin-publish:${rec.id}:v${rec.version}`;
  const lock = await ctx.repo.acquireLock(lockKey, PUBLISH_LOCK_TTL_MS);
  if (!lock) {
    throw conflict(
      "publication_in_progress",
      "Une publication de ce post est déjà en cours. Patientez quelques secondes puis actualisez.",
    );
  }
  try {
    // Une demande concurrente a pu aboutir (ou échouer) entre la première lecture et le verrou.
    const fresh = await ctx.repo.publications.list();
    const settled = findSuccess(fresh, key, "publication");
    if (settled) return json(toPublication(settled));
    const exported = findSuccess(fresh, key, "export");
    const pending = findUnconfirmed(fresh, key);
    if (pending && !resolution) throw verificationRequired(pending);
    if (!pending && resolution) throw nothingToResolve();
    if (pending) assertMayResolve(ctx, pending);

    if (pending && resolution === "published") {
      const confirmed: PublicationAttempt = {
        ...pending,
        status: "succes",
        code: "linkedin_confirmed_by_user",
        message: `Confirmé publié sur LinkedIn par ${ctx.user.name}.`,
        remoteId: null,
      };
      await ctx.repo.publications.update(confirmed);
      await settlePost(ctx, rec, "publie", at);
      await audit(
        ctx,
        "publication.confirmed",
        "publication",
        confirmed.id,
        `LinkedIn « ${rec.title} » : présence du post confirmée (version ${rec.version})`,
      );
      return json(toPublication(confirmed));
    }
    if (pending) {
      const absent: PublicationAttempt = {
        ...pending,
        status: "echec",
        code: "linkedin_absence_confirmed",
        message: `Absence confirmée par ${ctx.user.name} : le post n'était pas sur LinkedIn.`,
      };
      await ctx.repo.publications.update(absent);
      await audit(
        ctx,
        "publication.absence_confirmed",
        "publication",
        absent.id,
        `LinkedIn « ${rec.title} » : absence du post confirmée, nouvelle publication (version ${rec.version})`,
      );
    }

    const linkedin = adapters().linkedin;
    const variant = rec.variants.find((v) => v.id === rec.selectedVariantId) ?? rec.variants[0]!;
    const hashtags = variant.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    const commentary = [variant.text, "", hashtags].join("\n");
    // Enregistrée AVANT l'appel : si le Worker meurt ensuite, elle bloque toute republication.
    const marker: PublicationAttempt = {
      ...base,
      id: ctx.repo.nextId("pub"),
      status: "verification_requise",
      code: CONFIRMATION_PENDING,
      message: "Publication LinkedIn envoyée, confirmation en attente.",
      attempts: 1,
      mode: "publication",
    };
    await ctx.repo.publications.insert(marker);

    let result: LinkedInPublishResult;
    try {
      result = await userPublisher(ctx.user.id, commentary);
    } catch (e) {
      // `publishWithConnectionKey` ne lève pas : une exception survient avant tout envoi.
      if (e instanceof ConnectionKeyUnavailableError) {
        const failed: PublicationAttempt = {
          ...marker,
          status: "echec",
          code: e.code,
          message: e.message,
        };
        await ctx.repo.publications.update(failed);
        await audit(
          ctx,
          "publication.failed",
          "publication",
          failed.id,
          `LinkedIn « ${rec.title} » — ${e.message}`,
        );
        throw new HttpError(e.status, e.code, e.message, { attempt: toPublication(failed) });
      }
      await ctx.repo.publications.update({
        ...marker,
        status: "echec",
        code: "linkedin_internal_error",
        message: "Erreur interne avant l'envoi à LinkedIn : rien n'a été publié, réessayez.",
      });
      throw e;
    }

    if (result.kind === "published") {
      const attempt: PublicationAttempt = {
        ...marker,
        status: "succes",
        code: null,
        message: `Post publié sur LinkedIn via le compte relié${result.url ? ` : ${result.url}` : "."}`,
        remoteId: result.remoteId,
      };
      await ctx.repo.publications.update(attempt);
      await settlePost(ctx, rec, "publie", at);
      await audit(
        ctx,
        "publication.success",
        "publication",
        attempt.id,
        `LinkedIn « ${rec.title} » publié (version ${rec.version})`,
      );
      return json(toPublication(attempt), { status: 201 });
    }

    if (result.kind === "reconnect_required" || result.kind === "api_error") {
      const code =
        result.kind === "reconnect_required" ? "linkedin_reconnect_required" : "linkedin_api_error";
      const unknown = result.kind === "api_error" && !!result.verifyBeforeRetry;
      const attempt: PublicationAttempt = {
        ...marker,
        status: unknown ? "verification_requise" : "echec",
        code,
        message: result.message,
      };
      await ctx.repo.publications.update(attempt);
      await audit(
        ctx,
        unknown ? "publication.unconfirmed" : "publication.failed",
        "publication",
        attempt.id,
        `LinkedIn « ${rec.title} » — ${result.message}`,
      );
      throw unprocessable(code, result.message, { attempt: toPublication(attempt) });
    }

    // Compte non relié : export manuel, une seule fois par version.
    if (exported) {
      await ctx.repo.publications.remove(marker.id);
      return json(toPublication(exported));
    }
    const attempt: PublicationAttempt = {
      ...marker,
      status: "succes",
      code: linkedin.apiAvailable ? null : "linkedin_api_unavailable",
      message: linkedin.apiAvailable ? "Post publié." : linkedin.unavailableReason,
      mode: "export",
    };
    await ctx.repo.publications.update(attempt);
    await settlePost(ctx, rec, "exporte", at);
    await audit(
      ctx,
      "publication.success",
      "publication",
      attempt.id,
      `LinkedIn « ${rec.title} » exporté (version ${rec.version})`,
    );
    return json(toPublication(attempt), { status: 201 });
  } finally {
    // Un échec de libération ne doit pas masquer le résultat : le verrou expirera seul.
    await ctx.repo.releaseLock(lockKey, lock).catch((e: unknown) => {
      console.error(`[linkedin] verrou ${lockKey} non libéré`, e);
    });
  }
};

export const exportLinkedIn: Handler = async (ctx) => {
  const rec = await getPostOr404(ctx);
  const variant = rec.variants.find((v) => v.id === rec.selectedVariantId) ?? rec.variants[0]!;
  const approved = !!rec.approval?.valid && rec.approval.version === rec.version;
  const hashtags = variant.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const body = [
    ...(approved ? [] : ["[APERÇU — version non approuvée, ne pas publier]", ""]),
    variant.text,
    "",
    hashtags,
    "",
  ].join("\n");
  return fileResponse(body, {
    filename: `linkedin-${rec.id}-v${rec.version}.txt`,
    contentType: "text/plain; charset=utf-8",
  });
};

/* ------------------------------------------------------------------ */
/* Newsletter (WF5) — export HTML/texte, jamais d'envoi                */
/* ------------------------------------------------------------------ */

async function getEditionOr404(ctx: Ctx): Promise<NewsletterRecord> {
  const n = await ctx.repo.newsletters.get(ctx.params["id"]!);
  if (!n) throw notFound("Édition introuvable.");
  return n;
}

function assertEditable(rec: NewsletterRecord) {
  if (rec.status === "exportee") {
    throw conflict(
      "invalid_state",
      "Cette édition a déjà été exportée : elle n'est plus modifiable.",
    );
  }
}

export const listNewsletters: Handler = async (ctx) => {
  const list = await ctx.repo.newsletters.list();
  return json(
    list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(toNewsletter),
  );
};

export const getNewsletter: Handler = async (ctx) => json(toNewsletter(await getEditionOr404(ctx)));

export const createNewsletter: Handler = async (ctx) => {
  assertCan(ctx.user, "newsletter.write");
  const input = parse(schemas.createNewsletter, ctx.body);
  const rec = await createEdition(ctx, {
    ...(input.title ? { title: input.title } : {}),
    ...(input.weekOf ? { weekOf: input.weekOf } : {}),
  });
  return json(toNewsletter(rec), { status: 201 });
};

export const updateNewsletter: Handler = async (ctx) => {
  assertCan(ctx.user, "newsletter.write");
  const rec = await getEditionOr404(ctx);
  assertEditable(rec);
  const input = parse(schemas.updateNewsletter, ctx.body);
  expectNewsletter(rec, input);
  let items = rec.items;
  if (input.items) {
    const byId = new Map(input.items.map((i) => [i.id, i]));
    const unknown = [...byId.keys()].filter((id) => !rec.items.some((i) => i.id === id));
    if (unknown.length)
      throw unprocessable("item_not_found", "Élément inconnu dans cette édition.", {
        itemIds: unknown,
      });
    items = renumber(
      rec.items.map((i) => {
        const patch = byId.get(i.id);
        return patch ? { ...i, summary: patch.summary, order: patch.order } : i;
      }),
    );
  }
  const draft: NewsletterRecord = {
    ...rec,
    title: input.title ?? rec.title,
    intro: input.intro ?? rec.intro,
    items,
  };
  const changed =
    draft.title !== rec.title ||
    draft.intro !== rec.intro ||
    JSON.stringify(draft.items) !== JSON.stringify(rec.items);
  if (!changed) return json(toNewsletter(rec));
  const next = touchEdition(draft, ctx.now);
  const fields = [
    input.title !== undefined && "titre",
    input.intro !== undefined && "introduction",
    input.items && "sujets (ordre, résumés)",
  ]
    .filter(Boolean)
    .join(", ");
  await commitEdition(
    ctx,
    rec,
    next,
    "newsletter.update",
    `Version ${next.version} : ${fields}${rec.approval?.valid ? ` — approbation invalidée : ${MODIFIED_AFTER_APPROVAL.toLowerCase()}` : ""}`,
  );
  return json(toNewsletter(next));
};

export const addNewsletterItem: Handler = async (ctx) => {
  assertCan(ctx.user, "newsletter.write");
  const rec = await getEditionOr404(ctx);
  assertEditable(rec);
  const input = parse(schemas.newsletterItem, ctx.body);
  expectNewsletter(rec, input);
  const next = await addItem(ctx, rec, input);
  return json(toNewsletter(next), { status: 201 });
};

export const removeNewsletterItem: Handler = async (ctx) => {
  assertCan(ctx.user, "newsletter.write");
  const rec = await getEditionOr404(ctx);
  expectNewsletter(rec, parse(schemas.newsletterExpectation, ctx.body));
  const itemId = ctx.params["itemId"];
  if (!rec.items.some((i) => i.id === itemId))
    throw notFound("Élément introuvable dans cette édition.");
  assertEditable(rec);
  return json(toNewsletter(await removeItems(ctx, rec, (i) => i.id === itemId)));
};

export const approveNewsletter: Handler = async (ctx) => {
  assertCan(ctx.user, "newsletter.decide");
  const rec = await getEditionOr404(ctx);
  assertEditable(rec);
  const input = parse(schemas.newsletterExpectation, ctx.body);
  expectNewsletter(rec, input);
  const { version } = input;
  if (rec.status === "approuvee") return json(toNewsletter(rec));
  if (!rec.items.length)
    throw unprocessable("newsletter_empty", "Impossible d'approuver une édition sans sujet.");
  const next: NewsletterRecord = {
    ...rec,
    revision: revisionOf(rec) + 1,
    approval: newApproval(ctx, "newsletter", version),
    status: "approuvee",
    updatedAt: ctx.now.toISOString(),
  };
  await commitEdition(
    ctx,
    rec,
    next,
    "newsletter.approve",
    `Version ${version} approuvée (${rec.items.length} sujets)`,
  );
  return json(toNewsletter(next));
};

const isApproved = (rec: NewsletterRecord) =>
  !!rec.approval?.valid && rec.approval.version === rec.version;

/**
 * Consigne l'export de la version approuvée (idempotent) : tentative de publication, statut
 * « exportée », audit. Requête d'écriture distincte du téléchargement, qui reste sans effet.
 */
export const recordNewsletterExport: Handler = async (ctx) => {
  assertCan(ctx.user, "publish");
  const rec = await getEditionOr404(ctx);
  expectNewsletter(rec, parse(schemas.newsletterExpectation, ctx.body), true);
  if (!isApproved(rec)) {
    throw conflict(
      "approval_missing",
      `La version ${rec.version} doit être approuvée avant d'être exportée.`,
    );
  }
  const key = idempotencyKey(rec.id, rec.version, "newsletter");
  const at = ctx.now.toISOString();
  const attempt: PublicationAttempt = {
    id: ctx.repo.nextId("pub"),
    idempotencyKey: key,
    articleId: null,
    linkedinPostId: null,
    newsletterId: rec.id,
    channel: "newsletter",
    version: rec.version,
    status: "succes",
    code: null,
    message:
      "Édition exportée (HTML et texte) : l'envoi reste manuel, KORA n'envoie jamais la newsletter.",
    attempts: 1,
    remoteId: null,
    mode: "export",
    at,
    by: ctx.user.name,
    byUserId: ctx.user.id,
  };
  const next: NewsletterRecord = {
    ...rec,
    revision: revisionOf(rec) + 1,
    status: "exportee",
    updatedAt: at,
  };
  const committed = await commitEdition(
    ctx,
    rec,
    next,
    "publication.success",
    `Newsletter « ${rec.title} » exportée (version ${rec.version})`,
    attempt,
  );
  return json(toNewsletter(committed));
};

/** Téléchargement HTML ou texte, sans effet (aperçu signalé si la version n'est pas approuvée). */
export const exportNewsletter: Handler = async (ctx) => {
  const rec = await getEditionOr404(ctx);
  if (ctx.query.has("version") || ctx.query.has("revision")) {
    expectNewsletter(
      rec,
      parse(schemas.newsletterExpectation, {
        version: Number(ctx.query.get("version")),
        revision: ctx.query.has("revision") ? Number(ctx.query.get("revision")) : undefined,
      }),
    );
  }
  const format = ctx.query.get("format") ?? "html";
  if (format !== "html" && format !== "txt")
    throw badRequest("invalid_format", "Format attendu : html ou txt.");
  const approved = isApproved(rec);
  const dto = toNewsletter(rec);
  const name = `newsletter-${isoDay(new Date(rec.weekOf))}-v${rec.version}`;
  return format === "html"
    ? fileResponse(renderNewsletterHtml(dto, approved), {
        filename: `${name}.html`,
        contentType: "text/html; charset=utf-8",
      })
    : fileResponse(renderNewsletterText(dto, approved), {
        filename: `${name}.txt`,
        contentType: "text/plain; charset=utf-8",
      });
};

/* ------------------------------------------------------------------ */
/* Référentiel éditorial (WF6)                                         */
/* ------------------------------------------------------------------ */

export const getEditorialDna: Handler = async (ctx) => {
  const [rules, examples, proposals] = await Promise.all([
    ctx.repo.rules.list(),
    ctx.repo.examples.list(),
    ctx.repo.ruleProposals.list(),
  ]);
  return json({
    rules: rules.sort((a, b) => a.id.localeCompare(b.id)).map(({ history: _h, ...r }) => r),
    examples,
    proposals: proposals
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
      .map(({ signature: _s, ...p }) => p),
  });
};

export const createRule: Handler = async (ctx) => {
  assertCan(ctx.user, "rule.write");
  const input = parse(schemas.createRule, ctx.body);
  const at = ctx.now.toISOString();
  const rec = {
    id: ctx.repo.nextId("rule"),
    kind: input.kind,
    text: input.text,
    active: true,
    version: 1,
    updatedAt: at,
    updatedBy: ctx.user.name,
    history: [
      { version: 1, text: input.text, active: true, updatedAt: at, updatedBy: ctx.user.name },
    ],
  };
  await ctx.repo.rules.insert(rec);
  await audit(ctx, "rule.create", "rule", rec.id, `${rec.kind} : ${truncate(rec.text, 120)}`);
  const { history: _h, ...dto } = rec;
  return json(dto, { status: 201 });
};

export const updateRule: Handler = async (ctx) => {
  assertCan(ctx.user, "rule.write");
  const rec = await ctx.repo.rules.get(ctx.params["id"]!);
  if (!rec) throw notFound("Règle introuvable.");
  const input = parse(schemas.updateRule, ctx.body);
  const text = input.text ?? rec.text;
  const active = input.active ?? rec.active;
  if (text === rec.text && active === rec.active) {
    const { history: _h, ...dto } = rec;
    return json(dto);
  }
  const at = ctx.now.toISOString();
  const next = {
    ...rec,
    text,
    active,
    version: rec.version + 1,
    updatedAt: at,
    updatedBy: ctx.user.name,
    history: [
      ...rec.history,
      { version: rec.version + 1, text, active, updatedAt: at, updatedBy: ctx.user.name },
    ],
  };
  await ctx.repo.rules.update(next);
  await audit(
    ctx,
    "rule.update",
    "rule",
    rec.id,
    `Version ${next.version}${text !== rec.text ? ` : « ${truncate(text, 100)} »` : ""}${active !== rec.active ? (active ? " — réactivée" : " — désactivée") : ""}`,
  );
  const { history: _h, ...dto } = next;
  return json(dto);
};

/** Décision humaine sur une proposition WF6 : rien n'est appliqué sans acceptation explicite. */
export const decideRuleProposal: Handler = (ctx) => {
  assertCan(ctx.user, "rule.write");
  const { decision } = parse(schemas.ruleDecision, ctx.body);
  return withLock(
    ctx.repo,
    `rule-proposal:${ctx.params["id"]}`,
    {
      ttlMs: WRITE_LOCK_TTL_MS,
      busy: () => conflict("already_decided", "Cette proposition est déjà en cours de traitement."),
    },
    () => decideProposal(ctx, decision),
  );
};

async function decideProposal(ctx: Ctx, decision: "acceptee" | "refusee"): Promise<Response> {
  const rec = await ctx.repo.ruleProposals.get(ctx.params["id"]!);
  if (!rec) throw notFound("Proposition introuvable.");
  if (rec.status !== "proposee")
    throw conflict("already_decided", "Cette proposition a déjà été traitée.");
  const at = ctx.now.toISOString();
  if (decision === "acceptee") {
    const rule = rec.ruleId ? await ctx.repo.rules.get(rec.ruleId) : undefined;
    if (rule) {
      const version = rule.version + 1;
      await ctx.repo.rules.update({
        ...rule,
        text: rec.proposedText,
        active: true,
        version,
        updatedAt: at,
        updatedBy: ctx.user.name,
        history: [
          ...rule.history,
          {
            version,
            text: rec.proposedText,
            active: true,
            updatedAt: at,
            updatedBy: ctx.user.name,
          },
        ],
      });
    } else {
      await ctx.repo.rules.insert({
        id: ctx.repo.nextId("rule"),
        kind: rec.kind,
        text: rec.proposedText,
        active: true,
        version: 1,
        updatedAt: at,
        updatedBy: ctx.user.name,
        history: [
          {
            version: 1,
            text: rec.proposedText,
            active: true,
            updatedAt: at,
            updatedBy: ctx.user.name,
          },
        ],
      });
    }
  }
  const next = { ...rec, status: decision, decidedBy: ctx.user.name };
  await ctx.repo.ruleProposals.update(next);
  await audit(
    ctx,
    "rule.proposal",
    "rule",
    rec.ruleId ?? rec.id,
    `Proposition « ${truncate(rec.proposedText, 100)} » ${decision === "acceptee" ? "acceptée" : "refusée"} (${rec.basedOnCorrections} corrections)`,
  );
  const { signature: _s, ...dto } = next;
  return json(dto);
}
